/**
 * The link to We Three (the Tasks app): Stashr reads its lead sheets and writes every "sent" mark back, so the sheets in both
 * places agree. You type the We Three mobile number and MPIN once on the Stashr website; Stashr signs in, keeps only the
 * refresh token (sealed with CRYPTO_SECRET_KEY) and uses it from then on. The server list comes from the Stashr registry ("wethree").
 */
const crypto = require("crypto");
const Registry = require("../models/registry");
const WaLink = require("../models/waLink");
const WaSheet = require("../models/waSheet");
const WaRecipient = require("../models/waRecipient");
const WaSend = require("../models/waSend");

const TIMEOUT_MS = 20000;
const PAGE = 100;
const MAX_PAGES = 60;
const access = new Map();      // owner -> { token, at }; short-lived, kept in memory only
const NO_WHATSAPP_NOTE = "No WhatsApp (skipped)";

/* ───────── sealing the refresh token ───────── */
const keyOf = () => crypto.scryptSync(String(process.env.CRYPTO_SECRET_KEY || "dev-key"), "stashr-wa-link", 32);
function seal(text) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", keyOf(), iv);
    const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
    return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function unseal(blob) {
    const [iv, tag, enc] = String(blob).split(".").map((x) => Buffer.from(x, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", keyOf(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

/* ───────── talking to We Three ───────── */
async function basesOf() {
    if (process.env.WA_THREE_URL) return [process.env.WA_THREE_URL.replace(/\/+$/, "")];
    const row = await Registry.findOne({ app: "wethree" }).lean();
    return ((row && row.urls) || []).map((u) => String(u).replace(/\/+$/, "")).filter(Boolean);
}

async function http(method, path, { token, body } = {}) {
    const bases = await basesOf();
    if (!bases.length) { const e = new Error("We Three has no server address in the Stashr registry."); e.status = 503; throw e; }
    let last;
    for (const base of bases) {
        try {
            const res = await fetch(base + path, {
                method, signal: AbortSignal.timeout(TIMEOUT_MS),
                headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
            const text = await res.text();
            let json = {};
            try { json = text ? JSON.parse(text) : {}; } catch (e) { json = {}; }
            if (res.status >= 502 && res.status <= 504) { last = new Error(`We Three answered HTTP ${res.status}`); continue; }
            return { status: res.status, json };
        } catch (e) { last = e; }
    }
    const e = new Error("Could not reach We Three: " + (last && last.message)); e.status = 502; throw e;
}

async function accessFor(owner, force = false) {
    const cached = access.get(String(owner));
    if (!force && cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.token;
    const link = await WaLink.findOne({ owner }).lean();
    if (!link) { const e = new Error("Connect your We Three account first."); e.status = 409; throw e; }
    const r = await http("POST", "/auth/refresh", { body: { refreshToken: unseal(link.sealed) } });
    if (r.status !== 200 || !r.json.accessToken) { const e = new Error("We Three did not accept the saved sign-in. Connect again."); e.status = 409; throw e; }
    if (r.json.refreshToken && r.json.refreshToken !== unseal(link.sealed)) await WaLink.updateOne({ _id: link._id }, { $set: { sealed: seal(r.json.refreshToken) } });
    access.set(String(owner), { token: r.json.accessToken, at: Date.now() });
    return r.json.accessToken;
}

/** A call to We Three as the linked account. One retry with a fresh sign-in when the token has expired. */
async function call(owner, method, path, body) {
    let r = await http(method, path, { token: await accessFor(owner), body });
    if (r.status === 401) r = await http(method, path, { token: await accessFor(owner, true), body });
    return r;
}

/* ───────── the link ───────── */
async function connect(owner, mobile, mpin) {
    const m = String(mobile || "").replace(/\D/g, "").slice(-10);
    if (m.length !== 10 || String(mpin || "").length < 4) { const e = new Error("Enter the 10-digit mobile number and the MPIN."); e.status = 400; throw e; }
    const r = await http("POST", "/auth/login", { body: { mobileNumber: m, mpin: String(mpin) } });
    if (r.status !== 200 || !r.json.refreshToken) { const e = new Error(r.json && r.json.error ? r.json.error : "We Three did not accept that mobile number and MPIN."); e.status = r.status === 429 ? 429 : 401; throw e; }
    await WaLink.findOneAndUpdate({ owner }, { $set: { mobile: m, name: (r.json.user && r.json.user.name) || "", sealed: seal(r.json.refreshToken), connectedAt: new Date() } }, { upsert: true });
    access.set(String(owner), { token: r.json.accessToken, at: Date.now() });
    return { mobile: m, name: (r.json.user && r.json.user.name) || "" };
}

async function disconnect(owner) { access.delete(String(owner)); await WaLink.deleteOne({ owner }); }
const statusOf = async (owner) => { const l = await WaLink.findOne({ owner }).lean(); return l ? { connected: true, mobile: l.mobile, name: l.name, since: l.connectedAt } : { connected: false }; };

async function origins(owner) {
    const r = await call(owner, "GET", "/leads/origins");
    if (r.status !== 200) { const e = new Error(r.json.error || `We Three answered HTTP ${r.status}`); e.status = 502; throw e; }
    return (r.json.origins || []).map((o) => ({ name: String(o.name), count: Number(o.count) || 0, sent: Number(o.sent) || 0 }));
}

/**
 * Brings one We Three sheet in as a Stashr sheet of the same name: every lead that is not archived, has no WhatsApp mark yet and
 * has a mobile number. Importing again adds only new leads. `normalizePhone` is passed in to avoid a circular require.
 */
async function importSheet(owner, origin, normalizePhone) {
    const name = String(origin || "").trim().slice(0, 80);
    if (!name) { const e = new Error("Choose a sheet."); e.status = 400; throw e; }
    let sheet = await WaSheet.findOne({ owner, name });
    if (!sheet) sheet = await WaSheet.create({ owner, name, source: "leads", weThree: true });
    else if (!sheet.weThree) await WaSheet.updateOne({ _id: sheet._id }, { $set: { weThree: true } });
    const last = await WaRecipient.findOne({ owner, sheet: sheet._id }).sort({ order: -1 }).select("order").lean();
    let order = (last && last.order) || 0, seen = 0, skippedSent = 0, invalid = 0, added = 0, dup = 0;
    const doneInThree = [];                                       // leads already marked in We Three: never messaged from here
    for (let page = 1; page <= MAX_PAGES; page++) {
        const r = await call(owner, "GET", `/leads?page=${page}&limit=${PAGE}&status=all&origin=${encodeURIComponent(name)}`);
        if (r.status !== 200) { const e = new Error(r.json.error || `We Three answered HTTP ${r.status}`); e.status = 502; throw e; }
        const leads = r.json.leads || [];
        const rows = [];
        for (const l of leads) {
            seen++;
            if (l.archived) continue;
            if (l.whatsappSentAt) { skippedSent++; doneInThree.push(String(l.id)); continue; }
            const phone = normalizePhone(l.phone);
            if (!phone) { invalid++; continue; }
            rows.push({ owner, sheet: sheet._id, name: String(l.name || "").slice(0, 120), phone, externalId: String(l.id), order: ++order });
        }
        if (rows.length) {
            try { added += (await WaRecipient.insertMany(rows, { ordered: false })).length; }
            catch (e) { if (!(e && (e.code === 11000 || e.writeErrors))) throw e; const ok = (e.insertedDocs || []).length || (e.result && e.result.insertedCount) || 0; added += ok; dup += rows.length - ok; }
        }
        if (!leads.length || page >= (r.json.totalPages || 1)) break;
    }
    // A person imported earlier who has been messaged in We Three since (by hand, or by the app) is not messaged again from here.
    let closed = 0;
    if (doneInThree.length) {
        const out = await WaRecipient.updateMany({ owner, sheet: sheet._id, externalId: { $in: doneInThree }, status: "pending" },
            { $set: { status: "skipped", error: "Already messaged in We Three", markedAt: new Date(0) } });
        closed = out.modifiedCount || 0;
    }
    return { sheetId: sheet._id, name, seen, added, duplicates: dup, alreadySent: skippedSent, invalid, closed };
}

const CHUNK = 2000;                                           // We Three takes up to 2000 contacts per import
const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const cleanFail = (r, what) => { const e = new Error((r.json && r.json.error) || `We Three answered HTTP ${r.status} (${what})`); e.status = 502; return e; };

/**
 * Makes a Stashr sheet exist in We Three too. The sheet's name becomes a We Three list; the people who are not there yet are added
 * to it; then each person is matched to its We Three lead by number, so the "sent" marks go back to the right lead (the same way a
 * sheet imported from We Three works). A number We Three already has under another list stays there: it is counted in `notLinked`.
 * Safe to run again: only the people without a We Three lead are sent.
 */
async function pushSheet(owner, sheetId) {
    const sheet = await WaSheet.findOne({ _id: sheetId, owner });
    if (!sheet) { const e = new Error("Sheet not found."); e.status = 404; throw e; }
    if (!(await WaLink.exists({ owner }))) { const e = new Error("Connect We Three first."); e.status = 409; throw e; }
    const made = await call(owner, "POST", "/leads/lists", { name: sheet.name });
    if (made.status !== 200 && made.status !== 201) throw cleanFail(made, "list");
    const todo = await WaRecipient.find({ owner, sheet: sheet._id, externalId: "" }).sort({ order: 1 }).select("name phone").lean();
    let added = 0, existing = 0, invalid = 0;
    for (let i = 0; i < todo.length; i += CHUNK) {
        const r = await call(owner, "POST", "/leads/import", { list: sheet.name, contacts: todo.slice(i, i + CHUNK).map((p) => ({ name: p.name, phone: p.phone })) });
        if (r.status !== 200 && r.status !== 201) throw cleanFail(r, "import");
        added += Number(r.json.added) || 0; existing += Number(r.json.existing) || 0; invalid += Number(r.json.invalid) || 0;
    }
    const linked = await linkLeads(owner, sheet);
    if (!sheet.weThree) await WaSheet.updateOne({ _id: sheet._id }, { $set: { weThree: true } });
    const notLinked = await WaRecipient.countDocuments({ owner, sheet: sheet._id, externalId: "" });
    // People who were already messaged in Stashr get their mark in We Three now (done before answering, so it cannot overlap another sweep).
    if (linked && await WaRecipient.exists({ owner, sheet: sheet._id, externalId: { $ne: "" }, markedAt: { $exists: false }, status: { $in: ["sent", "skipped"] } })) await writeBack(owner, 50);
    return { sheetId: sheet._id, name: sheet.name, sent: todo.length, added, existing, invalid, linked, notLinked };
}

/** Gives every person of the sheet who has no We Three lead yet the id of the lead with the same number (the last 10 digits). */
async function linkLeads(owner, sheet) {
    const open = await WaRecipient.find({ owner, sheet: sheet._id, externalId: "" }).select("phone status").lean();
    if (!open.length) return 0;
    const byPhone = new Map(open.map((p) => [last10(p.phone), p]));
    const ops = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const r = await call(owner, "GET", `/leads?page=${page}&limit=${PAGE}&status=all&origin=${encodeURIComponent(sheet.name)}`);
        if (r.status !== 200) throw cleanFail(r, "leads");
        for (const l of r.json.leads || []) {
            const p = byPhone.get(last10(l.phone));
            if (!p) continue;
            const set = { externalId: String(l.id) };
            if (l.whatsappSentAt && p.status === "pending") Object.assign(set, { status: "skipped", error: "Already messaged in We Three", markedAt: new Date(0) });
            ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: set } } });
            byPhone.delete(last10(l.phone));
        }
        if (!(r.json.leads || []).length || page >= (r.json.totalPages || 1)) break;
    }
    if (ops.length) await WaRecipient.bulkWrite(ops, { ordered: false });
    return ops.length;
}

const lastSync = new Map();                                    // owner -> time of the last two-way sweep
/**
 * Keeps the sheets that live in both places the same: people added in Stashr go to We Three, and leads added to the same list in
 * We Three come to Stashr. Runs at most every 10 minutes per account; one failing sheet does not stop the others.
 */
async function syncLinked(owner, normalizePhone, now = Date.now(), force = false) {
    if (!force && now - (lastSync.get(String(owner)) || 0) < 10 * 60 * 1000) return { skipped: true };
    lastSync.set(String(owner), now);
    if (!(await WaLink.exists({ owner }))) return { skipped: true };
    const out = { pushed: 0, pulled: 0, errors: 0 };
    for (const sheet of await WaSheet.find({ owner, weThree: true }).select("_id name").lean()) {
        try {
            if (await WaRecipient.exists({ owner, sheet: sheet._id, externalId: "" })) out.pushed += (await pushSheet(owner, sheet._id)).sent;
            out.pulled += (await importSheet(owner, sheet.name, normalizePhone)).added;
        } catch (e) { out.errors++; console.log("[wa] We Three sync failed for", sheet.name + ":", e.message); }
    }
    return out;
}

/** Writes one lead's WhatsApp mark to We Three. Returns true when We Three accepted it. */
async function markLead(owner, externalId, templateName) {
    const r = await call(owner, "PATCH", `/leads/${encodeURIComponent(externalId)}`, { whatsappSent: true, whatsappTemplateName: String(templateName || "Stashr").slice(0, 80) });
    return r.status === 200;
}

/**
 * Every person who was messaged (or skipped as not on WhatsApp) and came from We Three gets the mark there. A failed write is
 * remembered on the person and tried again on the next sweep, so the two systems end up agreeing.
 */
async function writeBack(owner, limit = 10) {
    if (!(await WaLink.exists({ owner }))) return 0;
    const people = await WaRecipient.find({ owner, externalId: { $ne: "" }, markedAt: { $exists: false }, status: { $in: ["sent", "skipped"] } }).limit(limit).lean();
    let done = 0;
    for (const p of people) {
        try {
            const label = p.status === "sent" ? "Stashr" : NO_WHATSAPP_NOTE;
            if (p.status === "skipped" && !/not on whatsapp|isn't on whatsapp|invalid/i.test(p.error || "")) { await WaRecipient.updateOne({ _id: p._id }, { $set: { markedAt: new Date(0), markError: "" } }); continue; }   // a duplicate: nothing to mark
            if (await markLead(owner, p.externalId, label)) { await WaRecipient.updateOne({ _id: p._id }, { $set: { markedAt: new Date(), markError: "" } }); done++; }
            else await WaRecipient.updateOne({ _id: p._id }, { $set: { markError: "We Three did not accept the mark" } });
        } catch (e) { await WaRecipient.updateOne({ _id: p._id }, { $set: { markError: String(e.message).slice(0, 120) } }); }
    }
    return done;
}

module.exports = { seal, unseal, connect, disconnect, statusOf, origins, importSheet, pushSheet, syncLinked, markLead, writeBack, call, NO_WHATSAPP_NOTE };
