const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { sealJSON, unsealJSON, generateDataKey, wrapDataKey, unwrapDataKey, sealJSONWithKey, unsealJSONWithKey } = require("./EncDecManager");

// How many devices can be signed in at once; the oldest session is dropped first.
const MAX_SESSIONS = 10;
const TOKEN_TTL = "30d";

const entrySchema = new mongoose.Schema({
    // "e2e"  : `data` is an AES-256-GCM blob encrypted on the device (server can't read it)
    // "gcm"  : legacy server-encrypted entry (password/iv/tag), written by old clients
    // absent : oldest legacy entries, server AES-256-CBC (password/iv)
    enc: { type: String },
    data: { type: String },

    // Legacy fields
    password: { type: String },
    iv: { type: String },
    tag: { type: String },
    platform: { type: String },
    platEmail: { type: String },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const schema = new mongoose.Schema({
    name: { type: String, trim: true },
    email: { type: String, trim: true, index: true },
    password: { type: String },

    // Legacy field: older accounts stored a hash of the confirmation password.
    cpassword: { type: String },

    // Envelope encryption: one random 256-bit key per account, generated on
    // first use and wrapped (encrypted) with CRYPTO_SECRET_KEY for storage.
    // Vault/project items are encrypted with the unwrapped key, not with
    // CRYPTO_SECRET_KEY directly — see EncDecManager.js.
    dataKey: { type: String },

    tokens: [
        {
            token: { type: String },
            createdAt: { type: Date, default: Date.now },
            client: { type: String },
            device: { type: String },   // short label such as "Chrome on Windows"
            ip: { type: String },
            lastUsedAt: { type: Date }
        }
    ],

    twoFactor: {
        enabled: { type: Boolean, default: false },
        secret: { type: String },          // sealed with the server key
        pendingSecret: { type: String },   // sealed, during setup
        lastStep: { type: Number, default: -1 },
        recoveryCodes: [{ type: String }]  // sha256 hashes
    },

    // Forgot-password: only a salted hash of the 6-digit code, its expiry and the try / send counters.
    passwordReset: {
        codeHash: { type: String }, salt: { type: String }, expiresAt: { type: Date }, attempts: { type: Number, default: 0 },
        sentAt: { type: Date }, windowStart: { type: Date }, sentCount: { type: Number, default: 0 }
    },

    passwords: [entrySchema],

    // Project/infra tracker entries. Same shape and same end-to-end scheme as
    // `passwords` above — each entry is an opaque AES-256-GCM blob the server
    // cannot read.
    projects: [entrySchema],

    // Render dashboard connections; API keys are encrypted using the account data key.
    renderAccounts: [entrySchema],

    // GitHub connections for the Projects page; tokens are sealed with the account data key.
    githubAccounts: [entrySchema],

    // Vercel / Netlify / Railway / Cloudflare tokens for deploying from Projects; sealed with the account data key.
    hostAccounts: [entrySchema],

    // Encrypted audit trail for Render operations; never stores environment-variable values.
    renderAudit: [entrySchema],

    // Encrypted operational configuration and bounded monitoring history.
    // Telegram credentials, group definitions, metric snapshots and incident details
    // are sealed with the user's data key before persistence.
    renderOps: [entrySchema],
    renderMetricHistory: [entrySchema],

    // Google accounts connected from Smart home for the TV's movies (Google Drive). The name is historical: the Photos
    // feature that first stored these is gone, but the sealed connections are still what the movie sync reads.
    photoConnections: [entrySchema],

    // Per-person feature switches set in the admin panel: { featureKey: true | false }. See utils/features.js.
    featureOverrides: { type: mongoose.Schema.Types.Mixed, default: {} },
    renderIncidents: [entrySchema],

    // Live-services dashboard: sealed settings (consent, limits, per-service switches) and a bounded usage history.
    usageSettings: [entrySchema],
    renderHoursBudget: [entrySchema],
    // Admin setting: which apps get Stashr's main server URL in their Render env (sealed).
    stashrPropagation: [entrySchema],
    // Public status page: { slug, enabled, title, serviceIds, snapshot }. The snapshot is public; nothing else here is.
    publicStatus: { type: mongoose.Schema.Types.Mixed, default: null },
    usageHistory: [entrySchema],

    // Telegram bot connection (sealed: bot token, chat id, PIN hash, digest settings) and the public id of its
    // webhook URL, used to find the account when Telegram calls in. The id is random and carries no secret.
    telegram: [entrySchema],
    telegramHookId: { type: String, index: true, sparse: true }
}, { timestamps: true });


// HASHING THE PASSWORD
schema.pre("save", async function ()
{
    if (this.isModified("password"))
    {
        this.password = await bcrypt.hash(this.password, 12);
    }
});


// GENERATING AUTH TOKEN
schema.methods.generateAuthToken = async function (client = "web")
{
    const token = jwt.sign({ _id: this._id, jti: crypto.randomBytes(12).toString("hex") }, process.env.SECRET_KEY, { expiresIn: TOKEN_TTL });
    // Atomic push: a whole-document save() races with other writers (monitor, usage history, other logins)
    // and fails with a VersionError on the tokens array, which made sign-in return a 500.
    const entry = { token, client, createdAt: new Date() };
    await this.constructor.updateOne({ _id: this._id }, { $push: { tokens: { $each: [entry], $slice: -MAX_SESSIONS } } });
    this.tokens = (this.tokens || []).concat(entry).slice(-MAX_SESSIONS);
    return token;
};

// Legacy: add a server-encrypted entry (old clients only)
schema.methods.addNewPassword = async function (userPass, iv, platform, platEmail, tag)
{
    const now = new Date();
    this.passwords.push({ enc: tag ? "gcm" : undefined, password: userPass, iv, tag, platform, platEmail, createdAt: now, updatedAt: now });
    await this.save();
    return true;
};

// Returns this account's raw 256-bit data key, generating and storing a
// wrapped one on first use. Never returned to the client, never logged.
schema.methods.getDataKey = async function ()
{
    if (!this.dataKey)
    {
        this.dataKey = wrapDataKey(generateDataKey());
        await this.save();
    }
    return unwrapDataKey(this.dataKey);
};

const publicEntry = (entry, dataKey) =>
{
    // "udk": current format — fields are JSON, encrypted with this account's
    // own data key (itself wrapped with the server key). The server unwraps
    // the data key then decrypts here, so the client just gets plain fields.
    if (entry.enc === "udk")
    {
        let fields = {};
        try { fields = unsealJSONWithKey(dataKey, entry.data); } catch (e) { fields = { broken: true }; }
        return { ...fields, _id: entry._id, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
    }
    // "srv": previous format — fields are JSON, encrypted directly with the
    // global server key. Kept readable for accounts not yet migrated to "udk".
    if (entry.enc === "srv")
    {
        let fields = {};
        try { fields = unsealJSON(entry.data); } catch (e) { fields = { broken: true }; }
        return { ...fields, _id: entry._id, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
    }
    if (entry.enc === "e2e")
    {
        // Old end-to-end blobs from before the switch to server-side encryption.
        // The server never had the key, so these can no longer be read.
        return { _id: entry._id, enc: "e2e", data: entry.data, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
    }
    return {
        _id: entry._id,
        enc: entry.enc || "cbc",
        platform: entry.platform,
        platEmail: entry.platEmail,
        // Ciphertext + iv are kept for older web builds that decrypt by value.
        password: entry.password,
        iv: entry.iv,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
    };
};

// New writes always use the per-account data key ("udk"), not the global server key.
const sealEntry = (dataKey, fields) => sealJSONWithKey(dataKey, fields);

// Public view of the account: never send hashes, 2FA secrets or session tokens to a client.
// `dataKey` is this account's unwrapped data key (from getDataKey()) — required to read "udk" entries.
schema.methods.toPublic = function (dataKey)
{
    return {
        _id: this._id,
        name: this.name,
        email: this.email,
        twoFactorEnabled: Boolean(this.twoFactor && this.twoFactor.enabled),
        recoveryCodesLeft: this.twoFactor && this.twoFactor.enabled ? (this.twoFactor.recoveryCodes || []).length : 0,
        sessions: (this.tokens || []).length,
        passwords: (this.passwords || []).map((e) => publicEntry(e, dataKey)),
        projects: (this.projects || []).map((e) => publicEntry(e, dataKey))
    };
};

// Bounded monitoring histories: by far the largest parts of the account document (written every few minutes by the
// monitor). Requests that do not read them load the account without them.
schema.statics.HISTORY_FIELDS = ["renderMetricHistory", "renderIncidents", "renderAudit", "usageHistory"];
// Everything else that is big and only some pages read (Google connections, host/Render/GitHub connections, Telegram, usage
// settings). Sign-in and the post-login profile load never need these, so they are not pulled from MongoDB there.
schema.statics.BULK_FIELDS = [
    "photoConnections",
    "renderAccounts", "githubAccounts", "hostAccounts", "renderOps", "usageSettings", "telegram"
];
// Fields of the photo library that used to live on the account. They are no longer part of the schema, and are removed from the
// database (utils/photoCleanup.js) and never copied from an old database (db/legacy.js).
schema.statics.PHOTO_FIELDS = ["photoConnections"];
schema.statics.REMOVED_PHOTO_FIELDS = ["photoMedia", "photoAlbums", "photoFolders", "photoBackupJobs", "photoSettings", "photoShares"];
schema.statics.publicEntry = publicEntry;
schema.statics.sealEntry = sealEntry;

const User = mongoose.model("user-data", schema);
module.exports = User;
