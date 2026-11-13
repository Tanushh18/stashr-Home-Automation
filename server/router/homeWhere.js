/*
 * Stashr Location: a tiny Android app for family phones that shares only the phone's location with this server.
 * The phone joins with ONE fixed code that the Smart home page shows (it can be replaced there), so nobody types the
 * Stashr password on it, and the phone never sees anything of the vault.
 *
 *   Signed-in user                                  Phone (token in "Authorization: Bearer sh_...")
 *   GET  /home/location-code   the code (also /home/hub-code for the tablet)              POST /home/agent/link       code + name in, token out
 *   POST /home/location-code/rotate  a new one       POST /home/agent/location   a fix in; where it is, the next check, notices out
 *   GET  /home/where           everyone's whereabouts POST /home/agent/unlink      the phone disconnects itself
 */
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const HomeDevice = require("../models/homeDevice");
const HomeSettings = require("../models/homeSettings");
const home = require("../utils/home");
const automation = require("../utils/homeAutomation");
const { record } = require("../utils/homeEvents");
const route = require("../utils/homeRoute");
const phonePush = require("../utils/phonePush");
const houseMap = require("../utils/homeMap");
const roomLive = require("../utils/roomLive");
const placeTrail = require("../utils/placeTrail");
const placeFixes = require("../utils/placeFixes");
const homeRouter = require("./home");
const insights = () => require("./homeInsights");

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "Too many changes. Slow down." });
const agentLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many requests." });
const linkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many tries. Wait a few minutes." });
const fail = (res, error, fallback) => res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : fallback });

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Two fixed codes: one links family phones (Stashr Location), the other links the home tablet (Stashr Hub). A tablet
// can see the dashboard and the slideshow photos, so its code is never the one that is handed to the family.
async function codeOf(owner, field = "locationCode") {
    const s = await automation.settingsOf(owner);
    if (s[field]) return s[field];
    await HomeSettings.updateOne({ owner, $or: [{ [field]: "" }, { [field]: { $exists: false } }] }, { $set: { [field]: newCode() } });
    return (await automation.settingsOf(owner))[field];
}

router.get("/home/location-code", authenticate, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json({ code: await codeOf(req.rootUser._id) }); }
    catch (e) { return fail(res, e, "Could not load the code."); }
});

router.post("/home/location-code/rotate", authenticate, writeLimiter, async (req, res) => {
    try {
        await codeOf(req.rootUser._id);
        const code = newCode();
        await HomeSettings.updateOne({ owner: req.rootUser._id }, { $set: { locationCode: code } });
        return res.json({ code });
    } catch (e) { return fail(res, e, "Could not make a new code."); }
});

router.get("/home/hub-code", authenticate, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json({ code: await codeOf(req.rootUser._id, "hubCode") }); }
    catch (e) { return fail(res, e, "Could not load the code."); }
});

router.post("/home/hub-code/rotate", authenticate, writeLimiter, async (req, res) => {
    try {
        await codeOf(req.rootUser._id, "hubCode");
        const code = newCode();
        await HomeSettings.updateOne({ owner: req.rootUser._id }, { $set: { hubCode: code } });
        return res.json({ code });
    } catch (e) { return fail(res, e, "Could not make a new code."); }
});

// The phone types the fixed code and its owner's name: it gets its own token, which can only send its location.
router.post("/home/agent/link", linkLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const code = normCode(b.code);
        if (code.length !== 8) return res.status(400).json({ error: "Type the 8-letter code shown on the Stashr Smart home page." });
        const kindWanted = b.kind === "tv" ? "tv" : b.kind === "hub" ? "hub" : "phone";
        const tablet = kindWanted !== "phone";   // a tablet or a TV: both use the home-device code
        const s = await HomeSettings.findOne(tablet ? { hubCode: code } : { locationCode: code }).lean();
        if (!s) return res.status(400).json({ error: "That code is not right. Check it on the Stashr Smart home page." });
        const name = String(b.name || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60);
        if (name.length < 2) return res.status(400).json({ error: tablet ? "Give the tablet a name (at least 2 letters)." : "Type your name (at least 2 letters)." });
        const owner = s.owner;
        if (await HomeDevice.countDocuments({ owner, parent: { $exists: false } }) >= 20) return res.status(400).json({ error: "This Stashr home already has the most devices it can hold." });
        if (await HomeDevice.exists({ owner, kind: kindWanted, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })) return res.status(409).json({ error: tablet ? "A tablet or TV with that name is already linked. Pick another name." : "Someone with that name is already linked. Add your surname or pick another name." });
        forgetDevices(owner);
        const token = home.newToken();
        const device = await HomeDevice.create(tablet
            ? { owner, name, kind: kindWanted, tokenHash: home.hashToken(token), tokenHint: token.slice(-4) }
            : { owner, name, kind: "phone", person: name, tokenHash: home.hashToken(token), tokenHint: token.slice(-4), status: { agent: "stashr-where" } });
        await record({ owner, device: device._id, deviceName: name, kind: "paired", text: tablet ? `${name} joined Stashr Home (${kindWanted === "tv" ? "TV" : "tablet"})` : `${name} linked their phone (Stashr Location)` });
        return res.status(201).json({ token, deviceId: String(device._id), name, device: { id: String(device._id), name, kind: kindWanted } });
    } catch (e) { return fail(res, e, "Could not link."); }
});

/** A Firebase registration token as the phone sends it (letters, digits, - _ : and a few more), or "". */
const cleanFcm = (v) => (typeof v === "string" && /^[A-Za-z0-9_:\-.]{50,4096}$/.test(v) ? v : "");
const num = (v) => (v === undefined || v === null || v === "" ? NaN : Number(v));

// Short-lived memory so a phone's upload does not re-read every device of the home each time (a tablet's Wi-Fi book is big).
const devCache = new Map();     // owner -> { at, list }
const DEV_TTL = 20 * 1000;
async function devicesOf(owner, now) {
    const hit = devCache.get(String(owner));
    if (hit && now - hit.at < DEV_TTL) return hit.list;
    const list = await HomeDevice.find({ owner }).lean();
    devCache.set(String(owner), { at: now, list });
    if (devCache.size > 200) devCache.delete(devCache.keys().next().value);
    return list;
}
const forgetDevices = (owner) => devCache.delete(String(owner));

// Every family phone's last 24 hours are kept (placeFixes; the database deletes each point after 24 hours): the Places card and the
// "where did everyone go" day on the website and in Telegram read them.

function answer(res, out, settings, where, now, device, loc, batt) {
    const tvLiveOn = Boolean(settings.liveUntil && new Date(settings.liveUntil).getTime() > now) && settings.tvLive?.enabled !== false && where.state !== "home";
    // "Refresh location" on the page: every phone, home or not, answers fast for a minute and a half.
    const locateOn = Boolean(settings.locateUntil && new Date(settings.locateUntil).getTime() > now);
    const liveOn = tvLiveOn || locateOn;
    const watch = !liveOn && device ? placeTrail.watchFor(settings.places, device._id, loc, automation.localParts(now, settings.timezone || "Asia/Kolkata").minutes, batt) : { near: false };
    return res.json({
        roomOn: Boolean(device && device.roomOn), roomAuto: device ? roomLive.autoOf(device).on : true, live: liveOn, ok: true, state: where.state, traffic: Boolean(where.traffic), distanceKm: where.distanceKm ?? null, etaMinutes: where.state === "home" ? 0 : where.etaMinutes ?? null,
        nextCheckSec: liveOn ? 8 : watch.near ? Math.min(automation.checkInterval(where, batt), watch.sec) : automation.checkInterval(where, batt), home: { set: where.state !== "unset" },
        // near one of its places during an arrive/leave window: look closely (every 3 minutes, a real fix every time)
        precise: watch.near,
        notices: (out.commands || []).filter((c) => c.type === "notice").map((c) => ({ id: c.id, text: (c.args || {}).text || "" })).filter((n) => n.text)
    });
}

router.post("/home/agent/location", agentLimiter, (req, res, next) => homeRouter.agentAuth(req, res, next), async (req, res) => {
    try {
        const d = req.device;
        if (d.kind !== "phone") return res.status(403).json({ error: "Only a family phone can share its location." });
        const b = req.body || {};
        const now = Date.now();
        const prev = (d.status && d.status.location) || null;

        // "Still here": the phone has not moved (same Wi-Fi as last time), so it sends no coordinates. Just mark the last one as current,
        // which is one small write and no trip maths.
        if (b.same === true && prev && Number.isFinite(prev.lat) && now - Number(prev.at) < 12 * 3600 * 1000) {
            const set = { lastSeen: new Date(now), online: true, "status.location.at": now };
            if (b.battery && Number.isFinite(num(b.battery.pct))) { set["status.battery"] = Math.min(Math.max(Math.round(num(b.battery.pct)), 0), 100); set["status.charging"] = b.battery.charging === true; }
            const health = home.cleanHealth(b.health);
            if (health) set["status.health"] = health;
            if (b.wifi) {
                set["status.wifi"] = Boolean(b.wifi.connected); if (/^\d{1,3}(\.\d{1,3}){3}$/.test(String(b.wifi.ip || ""))) set["status.ip"] = String(b.wifi.ip);
                set["status.bssid"] = b.wifi.connected ? houseMap.normBssid(b.wifi.bssid) : "";
                if (set["status.bssid"]) void houseMap.noteAp({ _id: d._id, owner: d.owner, kind: "phone", status: { ...(d.status || {}), ip: set["status.ip"] || (d.status || {}).ip } }, set["status.bssid"], now);
            }
            const fcm = cleanFcm(b.fcm); if (fcm) { set.fcmToken = fcm; set.fcmSet = true; set.fcmSeenAt = new Date(now); }
            await HomeDevice.updateOne({ _id: d._id }, { $set: set });
            if (b.scan && d.roomOn) void roomLive.update(d.toObject(), b.scan, now);
            const settings = await automation.settingsOf(d.owner);
            const fresh = await HomeDevice.findById(d._id).select("commands").lean();
            const notices = (fresh.commands || []).filter((c) => c.type === "notice" && c.status === "pending");
            if (notices.length) await HomeDevice.updateOne({ _id: d._id }, { $set: { "commands.$[c].status": "sent" } }, { arrayFilters: [{ "c.status": "pending", "c.type": "notice" }] });
            const where = automation.whereIs(settings, { ...d.toObject(), status: { ...(d.status || {}), location: { ...prev, at: now } } }, now);
            void placeFixes.keep(d.owner, d._id, prev, { same: true, now }).catch(() => {});
            const same = { pct: b.battery && Number.isFinite(num(b.battery.pct)) ? num(b.battery.pct) : (d.status || {}).battery, charging: b.battery ? b.battery.charging === true : (d.status || {}).charging === true };
            // A "still here" call carries the battery too: a phone sinking to 20% is announced even when it never moves.
            if (Number(same.pct) <= 20 && !same.charging) void automation.lowBatteryNow(d.owner, { ...d.toObject(), status: { ...(d.status || {}), location: { ...prev, at: now }, battery: same.pct, charging: same.charging } }, settings, now).catch(() => {});
            return answer(res, { commands: notices.map((c) => ({ id: c.id, type: c.type, args: c.args })) }, settings, where, now, d, prev, same);
        }

        const lat = num(b.lat), lon = num(b.lon);
        if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return res.status(400).json({ error: "The location is not valid." });
        let at = num(b.at);
        if (!Number.isFinite(at) || at > now + 60_000 || at < now - 24 * 3600_000) at = now;
        const loc = { lat, lon, acc: Math.min(Math.max(num(b.acc) || 0, 0), 100000), at };
        if (Number.isFinite(num(b.speed)) && num(b.speed) >= 0) loc.speed = Math.min(num(b.speed), 100);
        const status = { agent: "stashr-where", location: loc };
        // Stored the way every family phone reports it: a number, plus `charging`.
        if (b.battery && Number.isFinite(num(b.battery.pct))) { status.battery = Math.min(Math.max(Math.round(num(b.battery.pct)), 0), 100); status.charging = b.battery.charging === true; }
        const health = home.cleanHealth(b.health);
        if (health) status.health = health;
        status.wifi = Boolean(b.wifi && b.wifi.connected);
        status.ip = b.wifi && /^\d{1,3}(\.\d{1,3}){3}$/.test(String(b.wifi.ip || "")) ? String(b.wifi.ip) : "";
        status.bssid = b.wifi && b.wifi.connected ? houseMap.normBssid(b.wifi.bssid) : "";
        if (status.bssid) void houseMap.noteAp({ _id: d._id, owner: d.owner, kind: "phone", status: { ...(d.status || {}), ip: status.ip } }, status.bssid, now);
        const out = await homeRouter.ingest(d, { status });
        if (out.error) return res.status(400).json({ error: out.error });
        // The room is worked out AFTER the status is stored: ingest rewrites the whole status, so writing the room before would be lost.
        if (b.scan && d.roomOn) void roomLive.update({ ...d.toObject(), status: { ...(d.status || {}), ...status } }, b.scan, now);
        const fcm = cleanFcm(b.fcm); if (fcm) await HomeDevice.updateOne({ _id: d._id }, { $set: { fcmToken: fcm, fcmSet: true, fcmSeenAt: new Date(now) } }).catch(() => {});
        // Work out the trip now (the Wi-Fi sees this phone too) and answer with where it is and when to look again.
        const settings = await automation.settingsOf(d.owner);
        const list = await devicesOf(d.owner, now);
        const all = list.map((x) => (String(x._id) === String(d._id) ? { ...x, status: { ...(x.status || {}), ...status }, lastSeen: new Date(now) } : x));
        const state = await automation.etaTick(d.owner, now, settings, all);
        await insights().keepFix(d.owner, d, d.person || d.name, loc, settings).catch(() => {});
        const me = all.find((x) => String(x._id) === String(d._id)) || d;
        const where = automation.whereIs({ ...settings, etaState: state }, me, now);
        void placeFixes.keep(d.owner, d._id, loc, { now }).catch(() => {});
        return answer(res, out, settings, where, now, d, loc, { pct: status.battery, charging: status.charging === true });
    } catch (e) { return fail(res, e, "Could not save the location."); }
});

// The tablet draws the house map itself from this.
router.get("/home/agent/map", agentLimiter, (req, res, next) => homeRouter.agentAuth(req, res, next), async (req, res) => {
    try { res.set("Cache-Control", "no-store"); const m = await houseMap.build(req.device.owner); return res.json({ ...m, plan: "" }); }
    catch (e) { return fail(res, e, "Could not build the map."); }
});

router.post("/home/agent/unlink", agentLimiter, (req, res, next) => homeRouter.agentAuth(req, res, next), async (req, res) => {
    try {
        const d = req.device;
        await HomeDevice.deleteOne({ _id: d._id });
        forgetDevices(d.owner);
        await record({ owner: d.owner, kind: "unpaired", text: `${d.name} disconnected their phone (Stashr Location)` });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not disconnect."); }
});

// The TV's live map: the phones that are out, where they are right now, and the road home.
const routeCache = new Map();   // phone id -> { at, lat, lon, line, seconds, meters, traffic }
async function buildLive(owner, { includeHome = false, extend = true } = {}) {
    const now = Date.now();
    const s = await automation.settingsOf(owner);
    if (s.tvLive && s.tvLive.enabled === false) return { ok: false, error: "The live map is switched off on the Stashr website (Family locations).", devices: [], home: null };
    if (extend) await HomeSettings.updateOne({ owner }, { $set: { liveUntil: new Date(now + 2 * 60 * 1000) } });
    const spot = s.homeSpot && Number.isFinite(s.homeSpot.lat) ? { lat: s.homeSpot.lat, lon: s.homeSpot.lon, radius: s.homeSpot.radius || 200 } : null;
    const phones = (await HomeDevice.find({ owner, kind: "phone" }).lean()).filter((p) => p.status && p.status.agent === "stashr-where" && p.status.location);
    const devices = [];
    for (const p of phones.slice(0, 8)) {
        const w = automation.whereIs(s, p, now), loc = p.status.location;
        const out = w.state === "away" || w.state === "coming";
        if (!out && !(includeHome && (w.state === "home" || w.state === "unset" || w.state === "unknown"))) continue;
        let line = spot && out ? [[loc.lat, loc.lon], [spot.lat, spot.lon]] : [];
        if (spot && out && devices.length < 6) {
            const key = String(p._id), c = routeCache.get(key);
            if (c && now - c.at < 45000 && automation.distanceM({ lat: loc.lat, lon: loc.lon }, c) < 300) line = c.line;
            else {
                const r = await route.drivingRoute({ lat: loc.lat, lon: loc.lon }, { lat: spot.lat, lon: spot.lon }, { geometry: true });
                if (r && r.line && r.line.length > 1) { line = r.line; routeCache.set(key, { at: now, lat: loc.lat, lon: loc.lon, line }); }
            }
        }
        devices.push({ id: String(p._id), name: p.person || p.name, lat: loc.lat, lon: loc.lon, acc: Math.round(loc.acc || 0), speedKmh: Number.isFinite(loc.speed) ? Math.round(loc.speed * 3.6) : null,
            at: Number(loc.at), ageSec: Math.max(0, Math.round((now - Number(loc.at)) / 1000)), state: w.state, etaMinutes: w.etaMinutes || null, km: w.distanceKm ?? null, traffic: Boolean(w.traffic),
            live: now - Number(loc.at) < 40000, route: line });
    }
    return { ok: true, now, home: spot, devices: devices.sort((a, b2) => (a.etaMinutes || 999) - (b2.etaMinutes || 999)) };
}

router.get("/home/agent/tv-live", agentLimiter, (req, res, next) => homeRouter.agentAuth(req, res, next), async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        if (req.device.kind !== "tv" && req.device.kind !== "hub") return res.status(403).json({ error: "Only the TV or the tablet can show the live map." });
        return res.json(await buildLive(req.device.owner));
    } catch (e) { return fail(res, e, "Could not load the live map."); }
});

// The website's live map: the same, and it also puts the phones that are out into live mode while the page keeps asking.
router.get("/home/live", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        return res.json(await buildLive(req.rootUser._id, { includeHome: true, extend: req.query.passive !== "1" }));
    } catch (e) { return fail(res, e, "Could not load the live map."); }
});

// Look up an address or a place for the home location (OpenStreetMap Nominatim, falling back to Open-Meteo's place search).
const geoLimiter = rateLimit({ windowMs: 60 * 1000, max: 12, message: "Too many searches. Wait a minute." });
router.get("/home/geocode", authenticate, geoLimiter, async (req, res) => {
    try {
        const q = String(req.query.q || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120);
        if (q.length < 3) return res.status(400).json({ error: "Type at least 3 letters." });
        let results = [];
        try {
            const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": "Stashr-Home/1.0 (personal home automation)", Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
            if (r.ok) results = (await r.json()).map((x) => ({ name: String(x.display_name || "").slice(0, 160), lat: Number(x.lat), lon: Number(x.lon) }));
        } catch (e) { /* try the fallback */ }
        if (!results.length) {
            try {
                const g = await require("../utils/homeWeather").geocode(q);
                if (g) results = [{ name: g.city, lat: g.lat, lon: g.lon }];
            } catch (e) { /* nothing */ }
        }
        return res.json({ results: results.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)) });
    } catch (e) { return fail(res, e, "Could not search."); }
});

// The page: who is where, how far from home, and how long they will take.
// "Refresh location": for the next 90 seconds every phone that checks in is told to report right away and every few seconds.
router.post("/home/locate-now", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, now = Date.now(), until = new Date(now + 90 * 1000);
        await HomeSettings.updateOne({ owner }, { $set: { locateUntil: until } });
        const phones = (await HomeDevice.find({ owner, kind: "phone" }).lean()).filter((p) => (p.status || {}).agent === "stashr-where");
        // A phone that is asleep will not call in for minutes: wake the ones that can be woken (Firebase push).
        void phonePush.nudgeOwner(owner, now).catch(() => {});
        return res.json({ ok: true, until: until.toISOString(), phones: phones.length, asked: now });
    } catch (e) { return fail(res, e, "Could not ask the phones for their location."); }
});

router.get("/home/where", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const owner = req.rootUser._id, now = Date.now();
        const s = await automation.settingsOf(owner);
        const phones = (await HomeDevice.find({ owner, kind: "phone" }).lean()).filter((p) => (p.status || {}).location || (p.status || {}).agent === "stashr-where");
        return res.json({
            homeSet: Boolean(s.homeSpot && Number.isFinite(s.homeSpot.lat)),
            locating: Boolean(s.locateUntil && new Date(s.locateUntil).getTime() > now),
            people: phones.map((p) => {
                const w = automation.whereIs(s, p, now), st = p.status || {};
                return { id: String(p._id), name: p.person || p.name, app: st.agent === "stashr-where" ? "Stashr Location" : "Stashr Hub", ...w,
                    battery: home.batteryOf(st), lastSeen: p.lastSeen || null,
                    wifi: Boolean(st.wifi), accuracyM: st.location ? Math.round(st.location.acc || 0) : null };
            }).sort((a, b) => ({ coming: 0, away: 1, home: 2, unknown: 3, unset: 4 }[a.state] - { coming: 0, away: 1, home: 2, unknown: 3, unset: 4 }[b.state]) || a.name.localeCompare(b.name))
        });
    } catch (e) { return fail(res, e, "Could not load where everyone is."); }
});

module.exports = router;
