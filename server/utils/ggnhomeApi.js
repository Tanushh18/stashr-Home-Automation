/**
 * Stashr -> the ggnHome server, server to server. The server list comes from the Stashr registry ("ggnhome"), or GGNHOME_URL.
 * The SMS console calls use the shared SMS_KEY in X-Console-Key (the same key the SMS Service app uses), so no browser ever
 * sees it and no ggnHome page has to be opened.
 */
const Registry = require("../models/registry");

const TIMEOUT_MS = 70000; // the free Render server can take a minute to wake up

async function basesOf() {
    if (process.env.GGNHOME_URL) return [process.env.GGNHOME_URL.replace(/\/+$/, "")];
    const row = await Registry.findOne({ app: "ggnhome" }).lean();
    const urls = ((row && row.urls) || []).map((u) => String(u).replace(/\/+$/, "")).filter(Boolean);
    return urls.length ? urls : require("./registryDefaults").DEFAULTS.ggnhome;
}

/** One call to ggnHome. `headers` are added (e.g. X-Console-Key or Authorization). Resolves { status, json }. */
async function http(method, path, { body, headers } = {}) {
    const bases = await basesOf();
    let last;
    for (const base of bases) {
        try {
            const res = await fetch(base + path, {
                method, signal: AbortSignal.timeout(TIMEOUT_MS),
                headers: { "Content-Type": "application/json", Accept: "application/json", ...(headers || {}) },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
            const text = await res.text();
            let json = {};
            try { json = text ? JSON.parse(text) : {}; } catch (e) { json = {}; }
            if (res.status >= 502 && res.status <= 504) { last = new Error(`ggnHome answered HTTP ${res.status}`); continue; }
            return { status: res.status, json };
        } catch (e) { last = e; }
    }
    const e = new Error("Could not reach ggnHome: " + (last && last.message)); e.status = 502; throw e;
}

/** An SMS console call (X-Console-Key = SMS_KEY). */
function sms(method, path, body) {
    const key = process.env.SMS_KEY || process.env.SMS_DEVICE_KEY;
    if (!key) { const e = new Error("SMS_KEY is not set on the Stashr server, so ggnHome SMS cannot be managed yet."); e.status = 503; return Promise.reject(e); }
    return http(method, "/api/sms-console" + path, { body, headers: { "X-Console-Key": key } });
}

module.exports = { http, sms, basesOf };
