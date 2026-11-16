/**
 * ggnHome Admin panel, managed inside Stashr. Nothing opens ggnhome.com: Stashr's server signs in to the ggnHome admin API
 * (mobile/email + the OTP ggnHome sends), keeps the access token sealed with CRYPTO_SECRET_KEY, and forwards the admin
 * calls the Stashr page makes. The forwarded paths are limited to ggnHome's admin API.
 *
 *   GET    /ggnadmin/status           { connected, mobile, name, expiresAt }
 *   POST   /ggnadmin/otp              { mobileNumber | email }       ggnHome sends the code
 *   POST   /ggnadmin/login            { mobileNumber | email, otp }  signs in (admin accounts only)
 *   POST   /ggnadmin/logout
 *   ANY    /ggnadmin/api/<path>       forwarded to ggnHome as /<path> (only /api/admin/... and /admin/...)
 */
const crypto = require("crypto");
const express = require("express");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const GgnAdminLink = require("../models/ggnAdminLink");
const ggn = require("../utils/ggnhomeApi");

const router = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: "Too many requests. Slow down." });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: "Too many sign-in attempts. Try again later." });

const keyOf = () => crypto.scryptSync(String(process.env.CRYPTO_SECRET_KEY || "dev-key"), "stashr-ggn-admin", 32);
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
/** The expiry (exp, seconds) inside a JWT, without checking it: ggnHome checks it. */
function expiryOf(token) {
    try { const p = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8")); return p.exp ? new Date(p.exp * 1000) : null; }
    catch (e) { return null; }
}
const fail = (res, status, error) => res.status(status).json({ error });
const messageOf = (r, fallback) => (r.json && (r.json.message || (typeof r.json.error === "string" && r.json.error))) || fallback;

/** Only ggnHome's admin API can be reached through this page. */
const ALLOWED = /^\/(api\/admin|admin)\/[A-Za-z0-9_\-\/.%]*$/;
const BLOCKED = /^\/admin\/login\//;

router.get("/ggnadmin/status", authenticate, async (req, res) => {
    const l = await GgnAdminLink.findOne({ owner: req.rootUser._id }).lean();
    if (!l) return res.json({ connected: false });
    const expired = l.expiresAt && l.expiresAt.getTime() < Date.now();
    return res.json({ connected: !expired, expired: !!expired, mobile: l.mobile, name: l.name, expiresAt: l.expiresAt });
});

router.post("/ggnadmin/otp", authenticate, loginLimiter, async (req, res) => {
    const b = req.body || {};
    const body = b.email ? { email: String(b.email).trim().toLowerCase() } : { mobileNumber: String(b.mobileNumber || "").replace(/\D/g, "").slice(-10) };
    if (!body.email && body.mobileNumber.length !== 10) return fail(res, 400, "Enter the admin's 10-digit mobile number or email.");
    try {
        const r = await ggn.http("POST", "/admin/login/request-otp", { body });
        if (r.status >= 200 && r.status < 300) return res.json({ ok: true, message: messageOf(r, "Code sent.") });
        return fail(res, r.status >= 400 && r.status < 500 ? r.status : 502, messageOf(r, `ggnHome answered HTTP ${r.status}`));
    } catch (e) { return fail(res, e.status || 502, e.message); }
});

router.post("/ggnadmin/login", authenticate, loginLimiter, async (req, res) => {
    const b = req.body || {};
    const body = b.email ? { email: String(b.email).trim().toLowerCase() } : { mobileNumber: String(b.mobileNumber || "").replace(/\D/g, "").slice(-10) };
    body.otp = String(b.otp || "").trim();
    if (!body.otp) return fail(res, 400, "Enter the code.");
    try {
        const r = await ggn.http("POST", "/admin/login/verify-otp", { body });
        const token = r.json && r.json.accessToken;
        if (r.status !== 200 || !token) return fail(res, r.status >= 400 && r.status < 500 ? r.status : 502, messageOf(r, "ggnHome did not accept that code."));
        const user = r.json.user || {};
        if (user.role !== "admin") return fail(res, 403, "That ggnHome account is not an admin.");
        await GgnAdminLink.findOneAndUpdate({ owner: req.rootUser._id },
            { $set: { mobile: user.mobileNumber || body.mobileNumber || "", name: user.name || "", sealed: seal(token), expiresAt: expiryOf(token), connectedAt: new Date() } }, { upsert: true });
        return res.json({ ok: true, name: user.name || "", mobile: user.mobileNumber || "" });
    } catch (e) { return fail(res, e.status || 502, e.message); }
});

router.post("/ggnadmin/logout", authenticate, async (req, res) => {
    await GgnAdminLink.deleteOne({ owner: req.rootUser._id });
    res.json({ ok: true });
});

router.all(/^\/ggnadmin\/api(\/.*)$/, authenticate, limiter, async (req, res) => {
    const path = req.params[0] + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
    const bare = req.params[0];
    if (!ALLOWED.test(bare) || bare.includes("..") || BLOCKED.test(bare)) return fail(res, 400, "That ggnHome path is not available here.");
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return fail(res, 405, "Method not allowed.");
    const l = await GgnAdminLink.findOne({ owner: req.rootUser._id });
    if (!l) return fail(res, 409, "Sign in to the ggnHome admin first.");
    try {
        const r = await ggn.http(req.method, path, { body: ["GET", "DELETE"].includes(req.method) ? undefined : req.body, headers: { Authorization: `Bearer ${unseal(l.sealed)}` } });
        if (r.status === 401) { await GgnAdminLink.deleteOne({ _id: l._id }); return fail(res, 409, "The ggnHome admin sign-in ended. Sign in again."); }
        res.set("Cache-Control", "no-store");
        return res.status(r.status).json(r.json);
    } catch (e) { return fail(res, e.status || 502, e.message); }
});

module.exports = router;
