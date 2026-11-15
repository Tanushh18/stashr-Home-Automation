/**
 * SMS sender: Shine One's text messages to the people of the We Three lead sheets. The sending itself (the queue, the limits,
 * the phones running the SMS Service app) stays on the We Three server; Stashr is where it is managed. Every call goes to
 * We Three's SMS console with the We Three login Stashr already holds for the WhatsApp sender (that account must be a
 * We Three admin), so no extra key is needed.
 *
 *   GET    /sms/overview              settings, limits, sheets with their messages and counts, phones
 *   PUT    /sms/settings              pause, mode, limits, sending times, days
 *   PUT    /sms/sheets                one sheet: { sheet, texts[], auto, onlyNew }
 *   PATCH  /sms/devices/:deviceId     a phone: { name, role, enabled }
 *   GET    /sms/log                   the latest messages
 *   POST   /sms/test                  { phoneNumber, message }
 */
const express = require("express");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const WaLink = require("../models/waLink");
const waLeads = require("../utils/waLeads");

const router = express.Router();
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many changes. Slow down." });

const SETTING_KEYS = ["paused", "mode", "dailyLimit", "hourlyLimit", "gapMinSec", "gapMaxSec", "lunchQuota", "lunchStart", "lunchEnd", "nightStart", "nightEnd", "days"];
const pick = (src, keys) => Object.fromEntries(keys.filter((k) => src && src[k] !== undefined).map((k) => [k, src[k]]));

/** One call to We Three's SMS console; its answer (or a clear error) goes back to the browser. */
async function relay(req, res, method, path, body) {
    const owner = req.rootUser._id;
    try {
        if (!(await WaLink.exists({ owner }))) return res.status(409).json({ error: "Connect We Three first (WhatsApp sender → We Three sheets)." });
        const r = await waLeads.call(owner, method, "/sms-console" + path, body);
        if (r.status >= 200 && r.status < 300) return res.json(r.json || {});
        const e = r.json && r.json.error;
        const msg = (e && (e.message || (typeof e === "string" ? e : ""))) || (r.json && r.json.message) || `We Three answered HTTP ${r.status}`;
        if (r.status === 403) return res.status(403).json({ error: "The We Three account linked to Stashr is not an admin there, so it cannot manage SMS." });
        if (r.status === 401 && /console key/i.test(msg)) return res.status(502).json({ error: "This We Three server cannot be managed from Stashr yet. Update We Three first." });
        return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({ error: msg });
    } catch (err) {
        return res.status(err.status && err.status < 600 ? err.status : 502).json({ error: err.message || "Could not reach We Three." });
    }
}

router.get("/sms/overview", authenticate, (req, res) => { res.set("Cache-Control", "no-store"); return relay(req, res, "GET", "/overview"); });
router.put("/sms/settings", authenticate, writeLimiter, (req, res) => relay(req, res, "PUT", "/settings", pick(req.body, SETTING_KEYS)));
router.put("/sms/sheets", authenticate, writeLimiter, (req, res) => {
    const b = req.body || {};
    if (!String(b.sheet || "").trim()) return res.status(400).json({ error: "Which sheet?" });
    const body = { sheet: String(b.sheet).trim().slice(0, 120) };
    if (Array.isArray(b.texts)) body.texts = b.texts.slice(0, 50).map((t) => String(t || ""));
    if (typeof b.auto === "boolean") body.auto = b.auto;
    if (b.onlyNew !== undefined) body.onlyNew = Boolean(b.onlyNew);
    return relay(req, res, "PUT", "/sheets", body);
});
router.patch("/sms/devices/:deviceId", authenticate, writeLimiter, (req, res) =>
    relay(req, res, "PATCH", `/devices/${encodeURIComponent(String(req.params.deviceId).slice(0, 64))}`, pick(req.body, ["name", "role", "enabled"])));
router.get("/sms/log", authenticate, (req, res) => relay(req, res, "GET", `/log?limit=${Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)}`));
router.post("/sms/test", authenticate, writeLimiter, (req, res) => {
    const b = req.body || {};
    return relay(req, res, "POST", "/test", { phoneNumber: String(b.phoneNumber || "").slice(0, 20), message: String(b.message || "").slice(0, 300) });
});

module.exports = router;
