/**
 * Firebase Cloud Messaging (HTTP v1 API, no extra library): the server asks a family phone ("Stashr Location") to report its location right now.
 * The message carries no location and no personal data, only { type: "locate" }; the phone then takes a fix and uploads it
 * the normal way. Nothing here runs unless a Firebase service-account key is in the environment.
 *
 * The key (the JSON file Firebase gives under Project settings > Service accounts) goes in ONE environment variable, as the
 * JSON text or as base64 of it. Accepted names: FIREBASE_SERVICE_ACCOUNT, STASHR_FIREBASE_KEY (any letter case).
 */
const ENV_NAMES = ["FIREBASE_SERVICE_ACCOUNT", "STASHR_FIREBASE_KEY"];

/** Reads the service-account JSON from the environment (plain JSON or base64). Returns null when missing or unreadable. */
function readKey(env = process.env) {
    const names = Object.keys(env);
    for (const want of ENV_NAMES) {
        const name = names.find((n) => n.toUpperCase() === want);
        const raw = name ? String(env[name] || "").trim() : "";
        if (!raw) continue;
        for (const text of [raw, safeBase64(raw)]) {
            if (!text) continue;
            try {
                const key = JSON.parse(text);
                if (key && key.client_email && key.private_key) return { ...key, private_key: String(key.private_key).replace(/\\n/g, "\n") };
            } catch { /* try the next form */ }
        }
    }
    return null;
}

function safeBase64(s) {
    try { return Buffer.from(s, "base64").toString("utf8"); } catch { return ""; }
}

const crypto = require("crypto");

let fetchImpl = (...a) => fetch(...a);      // replaceable in tests
let nowImpl = () => Date.now();
let cached = null;                          // { token, exp, who }

const b64u = (x) => Buffer.from(x).toString("base64url");

/** A Google access token for the service account (signed JWT exchanged at Google, valid for an hour, kept until a minute before it ends). */
async function accessToken(key) {
    const now = nowImpl();
    if (cached && cached.who === key.client_email && cached.exp - 60_000 > now) return cached.token;
    const iat = Math.floor(now / 1000);
    const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = b64u(JSON.stringify({ iss: key.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }));
    const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${claim}`), key.private_key).toString("base64url");
    const res = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }).toString(),
        signal: AbortSignal.timeout(10_000)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw Object.assign(new Error(json.error_description || json.error || `token HTTP ${res.status}`), { code: "auth" });
    cached = { token: json.access_token, exp: now + (Number(json.expires_in) || 3600) * 1000, who: key.client_email };
    return cached.token;
}

/** True when a Firebase key is configured and readable. */
function enabled() { return Boolean(readKey()); }

// FCM answers 404 UNREGISTERED when the app was removed, 400 INVALID_ARGUMENT for a malformed token.
const DEAD = /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT|registration-token/i;

/**
 * Sends the "report your location now" wake-up (FCM HTTP v1, no library). Returns { ok } or { ok: false, dead, reason } where dead =
 * the token is no good any more and should be forgotten (the app was uninstalled, or it got a newer token).
 */
async function sendLocate(token, type = "locate") {
    return sendData(token, { type: type === "now" ? "now" : "locate" }, "300s");
}

/**
 * Sends one small data message (no personal data) to one phone. `ttl` is how long Firebase may hold it for a phone that is off or
 * out of signal: a lock request uses a short one so a phone is never locked minutes after you pressed the button.
 */
async function sendData(token, data, ttl = "300s") {
    const key = readKey();
    if (!key) return { ok: false, reason: "not_configured" };
    if (!token || typeof token !== "string") return { ok: false, reason: "no_token" };
    try {
        const bearer = await accessToken(key);
        const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(key.project_id)}/messages:send`, {
            method: "POST",
            headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                message: {
                    token,
                    data,
                    // High priority wakes a sleeping phone (Doze); the short TTL means an unreachable phone is not woken hours later.
                    android: { priority: "HIGH", ttl }
                }
            }),
            signal: AbortSignal.timeout(10_000)
        });
        if (res.ok) return { ok: true };
        const text = await res.text().catch(() => "");
        if (res.status === 401) cached = null;
        return { ok: false, dead: DEAD.test(text) && res.status !== 401 && res.status !== 403, reason: `HTTP ${res.status} ${text}`.slice(0, 160) };
    } catch (e) {
        return { ok: false, reason: String((e && e.message) || e).slice(0, 120) };
    }
}

/** Test hook: replace fetch / the clock and forget the cached access token. */
function _reset({ fetch: f, now } = {}) { fetchImpl = f || ((...a) => fetch(...a)); nowImpl = now || (() => Date.now()); cached = null; }

module.exports = { readKey, enabled, sendLocate, sendData, _reset, ENV_NAMES };
