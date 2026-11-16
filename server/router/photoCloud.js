/*
 * Google Drive connection for the TV's movies (Smart home -> Movies from Google Drive).
 * The Photos feature (Photo Cloud: backup, albums, people, sharing, Google Photos import) was removed; the Google
 * connection it used to store is still what the movie sync reads, so only the sign-in routes remain here.
 */
const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const router = express.Router();
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");

const { clean, decode, updateEntry, pushEntry } = require("../utils/photoStore");
const { normEmail, pickPrimary } = require("../utils/photoAccounts");
const clientUrl = () => (process.env.PHOTO_CLOUD_CLIENT_URL || process.env.CLIENT_ORIGINS || "http://localhost:3000").split(",")[0].replace(/\/$/, "");
const MOVIE_READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const MOVIE_FULL_SCOPE = "https://www.googleapis.com/auth/drive";

/* Movies only: connect a Google account straight from Smart home, with no Photo Cloud feature needed. It reuses the
   redirect address already registered with Google (the callback below), and asks for Drive access only. */
router.get("/home/movies/google/start", authenticate, async (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_PHOTO_REDIRECT_URI || `${process.env.SELF_URL || "http://localhost:8000"}/photo-cloud/google/callback`;
    if (!clientId || !process.env.SECRET_KEY) return res.status(503).json({ error: "Google OAuth is not configured on this server yet." });
    const full = String(req.query.full || "") === "1";
    const state = jwt.sign({ uid: String(req.rootUser._id), kind: "movies", full, label: clean(req.query.label || "Google Drive (movies)", 80), returnTo: "/smart-home" }, process.env.SECRET_KEY, { expiresIn: "10m" });
    const scope = ["openid", "email", full ? MOVIE_FULL_SCOPE : MOVIE_READ_SCOPE].join(" ");
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", scope, state });
    return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
});

router.get("/photo-cloud/google/callback", async (req, res) => {
    let errorReturn = "/smart-home";
    const back = (result, returnTo = "/smart-home") => { const safePath = typeof returnTo === "string" && returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\") ? returnTo.slice(0, 200) : "/smart-home"; return res.redirect(`${clientUrl()}${safePath}${safePath.includes("?") ? "&" : "?"}google=${result}`); };
    try {
        const claims = jwt.verify(String(req.query.state || ""), process.env.SECRET_KEY);
        errorReturn = claims.returnTo || errorReturn;
        if (claims.kind !== "movies") return back("error", errorReturn);
        if (!req.query.code) return back("cancelled", claims.returnTo);
        const redirectUri = process.env.GOOGLE_PHOTO_REDIRECT_URI || `${process.env.SELF_URL || "http://localhost:8000"}/photo-cloud/google/callback`;
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: String(req.query.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET || "", redirect_uri: redirectUri, grant_type: "authorization_code" }) });
        const tokens = await tokenResponse.json();
        if (!tokenResponse.ok || !tokens.access_token) throw new Error("Google token exchange failed");
        const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
        const profile = await profileResponse.json();
        if (!profileResponse.ok || !profile.email) throw new Error("Google account details could not be verified");
        const grantedScopes = String(tokens.scope || "").split(/\s+/).filter(Boolean);
        const ok = claims.full ? grantedScopes.includes(MOVIE_FULL_SCOPE) : grantedScopes.some((x) => x === MOVIE_FULL_SCOPE || x === MOVIE_READ_SCOPE);
        if (!ok) return back("missing_scope", claims.returnTo);
        const user = await User.findById(claims.uid);
        if (!user) throw new Error("Account not found");
        const key = await user.getDataKey();
        const sameAccount = decode(user.photoConnections, key).filter((item) => normEmail(item.email) === normEmail(profile.email));
        const existing = pickPrimary(sameAccount, new Map());
        const connection = { ...(existing || {}), id: existing?.id || crypto.randomUUID(), label: clean(claims.label || existing?.label || profile.name || "Google account", 80), email: clean(profile.email, 160), provider: "Google Drive", status: "connected", eligible: existing?.eligible !== false, priority: existing?.priority || (user.photoConnections || []).length + 1, lastScan: existing?.lastScan || null, oauthMode: "connected", accessToken: tokens.access_token, refreshToken: tokens.refresh_token || existing?.refreshToken || "", tokenType: tokens.token_type, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000, scopes: grantedScopes };
        if (existing?._eid) await updateEntry(user, "photoConnections", connection, key);
        else await pushEntry(user, "photoConnections", connection, key);
        return back("connected", claims.returnTo);
    } catch (error) { return back("error", errorReturn); }
});

module.exports = router;
