/**
 * Stashr Home, the rest: pairing a tablet or a family phone with a short code, the automations (alerts, TV schedules,
 * scenes, the TV limit, briefs), TV time, internet speed history, the tablet camera's photos and videos, the tablet's
 * dashboard and slideshow, and tidying the Wi-Fi list (merge two rows, forget a row).
 *
 *   Signed-in user                                    Device (token in "Authorization: Bearer sh_...")
 *   POST   /home/pair-codes        a code to type      POST /home/agent/pair            code in, token out (no token yet)
 *   GET    /home/settings          PUT /home/settings  POST /home/agent/media?kind=     a camera photo or clip
 *   PUT    /home/schedules         PUT /home/scenes    GET  /home/agent/dashboard       what the tablet screen shows
 *   POST   /home/scenes/:id/run                        GET  /home/agent/slideshow(/file)
 *   GET    /home/usage             GET /home/speed     POST /home/agent/assistant       a spoken sentence
 *   GET    /home/media(/:id)       DELETE /home/media/:id
 *   POST   /home/devices/:id/lan/:key/merge   DELETE /home/devices/:id/lan/:key   PUT /home/devices/:id/person
 *   POST   /home/brief/test
 */
const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const HomeDevice = require("../models/homeDevice");
const HomeEvent = require("../models/homeEvent");
const HomeSettings = require("../models/homeSettings");
const HomePairCode = require("../models/homePairCode");
const HomeSpeed = require("../models/homeSpeed");
const HomeWidgetKey = require("../models/homeWidgetKey");
const HomeLiveFrame = require("../models/homeLiveFrame");
const home = require("../utils/home");
const automation = require("../utils/homeAutomation");
const media = require("../utils/homeMedia");
const weather = require("../utils/homeWeather");
const news = require("../utils/homeNews");
const movies = require("../utils/homeMovies");
const { record } = require("../utils/homeEvents");
const placeTrail = require("../utils/placeTrail");
const placeFixes = require("../utils/placeFixes");
const homeRouter = require("./home");

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many changes. Slow down." });
const agentLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: "Too many requests." });
const pairLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many tries. Wait a few minutes." });
// Live frames come about once a second, so they get their own, larger allowance.
const liveLimiter = rateLimit({ windowMs: 60 * 1000, max: 90, message: "Too many frames." });
const agentLimiterLive = () => liveLimiter;
const agentAuth = (req, res, next) => homeRouter.agentAuth(req, res, next);
const fail = (res, error, fallback) => res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : fallback });
const validId = (id) => mongoose.isValidObjectId(id);

/* ───────── pairing ───────── */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashCode = (c) => crypto.createHash("sha256").update("pair:" + normCode(c)).digest("hex");
const PAIR_MS = 15 * 60 * 1000;

router.post("/home/pair-codes", authenticate, writeLimiter, async (req, res) => {
    try {
        const kind = req.body && req.body.kind === "phone" ? "phone" : "hub";
        const name = String((req.body && req.body.name) || "").trim().slice(0, 60);
        if (await HomeDevice.countDocuments({ owner: req.rootUser._id, parent: { $exists: false } }) >= 20) return res.status(400).json({ error: "You can add up to 20 devices." });
        let code = "";
        for (let i = 0; i < 8; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
        await HomePairCode.create({ owner: req.rootUser._id, codeHash: hashCode(code), kind, name, expires: new Date(Date.now() + PAIR_MS) });
        return res.status(201).json({ code: code.slice(0, 4) + "-" + code.slice(4), kind, expiresAt: new Date(Date.now() + PAIR_MS) });
    } catch (e) { return fail(res, e, "Could not make a code."); }
});

// The tablet or phone types the code: it gets its own device token, which can only report and receive commands.
router.post("/home/agent/pair", pairLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        if (normCode(b.code).length !== 8) return res.status(400).json({ error: "Type the 8-letter code from the Smart home page." });
        const pc = await HomePairCode.findOneAndDelete({ codeHash: hashCode(b.code), expires: { $gt: new Date() } });
        if (!pc) return res.status(400).json({ error: "That code is wrong or has expired. Make a new one on the Smart home page." });
        const name = String(pc.name || b.name || (pc.kind === "phone" ? "Phone" : "Tablet")).trim().slice(0, 60) || "Device";
        const token = home.newToken();
        const device = await HomeDevice.create({ owner: pc.owner, name, kind: pc.kind, person: pc.kind === "phone" ? name : "", tokenHash: home.hashToken(token), tokenHint: token.slice(-4) });
        await record({ owner: pc.owner, device: device._id, deviceName: name, kind: "paired", text: `${name} joined Stashr Home (${pc.kind === "phone" ? "family phone" : "tablet"})` });
        return res.status(201).json({ token, device: { id: String(device._id), name, kind: pc.kind } });
    } catch (e) { return fail(res, e, "Could not pair."); }
});

/* ───────── settings ───────── */

const publicSettings = (s) => ({
    timezone: s.timezone, alerts: s.alerts, weather: { city: (s.weather && s.weather.city) || "" }, brief: { enabled: s.brief.enabled, time: s.brief.time },
    weekly: { enabled: s.weekly.enabled }, tvLimit: { minutes: s.tvLimit.minutes, action: s.tvLimit.action, lateNight: s.tvLimit.lateNight !== false },
    schedules: s.schedules || [], scenes: (s.scenes && s.scenes.length ? s.scenes : automation.DEFAULT_SCENES),
    places: s.places || [], history: { enabled: Boolean(s.history && s.history.enabled) }, tvLive: { enabled: !(s.tvLive && s.tvLive.enabled === false) }, news: { enabled: true, lang: "en", count: 6, ...(s.news || {}) }, rain: s.rain !== false, homeSpot: s.homeSpot && Number.isFinite(s.homeSpot.lat) ? { lat: s.homeSpot.lat, lon: s.homeSpot.lon, radius: s.homeSpot.radius || 200 } : null, eta: { enabled: true, maxKm: 40, notifyMinutes: 15, routing: true, ...(s.eta || {}) }, camera: { sensitivity: 5, video: true, auto: false, ...(s.camera || {}), autoState: undefined }
});

router.get("/home/settings", authenticate, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json(publicSettings(await automation.settingsOf(req.rootUser._id))); }
    catch (e) { return fail(res, e, "Could not load the settings."); }
});

const bool = (v, d) => (typeof v === "boolean" ? v : d);

router.put("/home/settings", authenticate, writeLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const cur = await automation.settingsOf(req.rootUser._id);
        const set = {};
        if (b.timezone !== undefined) {
            try { new Intl.DateTimeFormat("en", { timeZone: String(b.timezone) }); set.timezone = String(b.timezone).slice(0, 60); }
            catch (e) { return res.status(400).json({ error: "Unknown time zone." }); }
        }
        if (b.alerts && typeof b.alerts === "object") {
            const a = b.alerts, c = cur.alerts || {};
            for (const t of ["nightFrom", "nightTo"]) if (a[t] !== undefined && !automation.okTime(a[t])) return res.status(400).json({ error: "Times look like 23:30." });
            set.alerts = {
                newDevice: bool(a.newDevice, c.newDevice !== false), night: bool(a.night, c.night !== false), emptyHomeTv: bool(a.emptyHomeTv, c.emptyHomeTv !== false),
                camera: bool(a.camera, c.camera !== false), presence: bool(a.presence, c.presence === true), everything: bool(a.everything, c.everything !== false),
                nightFrom: a.nightFrom || c.nightFrom || "00:00", nightTo: a.nightTo || c.nightTo || "05:00"
            };
        }
        if (b.weatherCity !== undefined) {
            const city = String(b.weatherCity || "").trim();
            if (!city) set.weather = { city: "" };
            else {
                const g = await weather.geocode(city).catch(() => null);
                if (!g) return res.status(400).json({ error: "Could not find that city. Try “Delhi” or “Gurugram, Haryana”." });
                set.weather = g;
            }
        }
        if (b.brief && typeof b.brief === "object") {
            if (b.brief.time !== undefined && !automation.okTime(b.brief.time)) return res.status(400).json({ error: "Times look like 08:00." });
            set["brief.enabled"] = bool(b.brief.enabled, cur.brief.enabled);
            if (b.brief.time) set["brief.time"] = b.brief.time;
        }
        if (b.weekly && typeof b.weekly === "object") set["weekly.enabled"] = bool(b.weekly.enabled, cur.weekly.enabled);
        if (b.tvLimit && typeof b.tvLimit === "object") {
            const m = Number(b.tvLimit.minutes);
            if (b.tvLimit.minutes !== undefined && (!Number.isInteger(m) || m < 0 || m > 24 * 60)) return res.status(400).json({ error: "The TV limit is minutes a day, 0 for none." });
            if (b.tvLimit.minutes !== undefined) set["tvLimit.minutes"] = m;
            if (["notify", "pause", "home"].includes(b.tvLimit.action)) set["tvLimit.action"] = b.tvLimit.action;
            if (typeof b.tvLimit.lateNight === "boolean") set["tvLimit.lateNight"] = b.tvLimit.lateNight;
        }
        if (b.news && typeof b.news === "object") {
            const c = cur.news || {}, n = b.news;
            const lang = n.lang !== undefined ? String(n.lang) : (c.lang || "en"), count = n.count !== undefined ? Number(n.count) : (c.count || 6);
            if (!["en", "hi", "both"].includes(lang) || !Number.isInteger(count) || count < 1 || count > 10) return res.status(400).json({ error: "News language is English, Hindi or both; 1 to 10 headlines." });
            set.news = { enabled: bool(n.enabled, c.enabled !== false), lang, count };
        }
        if (b.rain !== undefined) set.rain = Boolean(b.rain);
        if (b.tvLive && typeof b.tvLive.enabled === "boolean") set["tvLive.enabled"] = b.tvLive.enabled;
        if (b.homeSpot !== undefined) {
            if (b.homeSpot === null) set.homeSpot = {};
            else {
                const lat = Number(b.homeSpot.lat), lon = Number(b.homeSpot.lon), radius = Math.round(Number(b.homeSpot.radius || 200));
                if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) || b.homeSpot.lat === "" || b.homeSpot.lon === "") return res.status(400).json({ error: "Home needs a latitude and a longitude." });
                if (!(radius >= 50 && radius <= 1000)) return res.status(400).json({ error: "Home radius is 50 to 1000 metres." });
                set.homeSpot = { lat, lon, radius };
            }
        }
        if (b.eta && typeof b.eta === "object") {
            const e = b.eta, c = cur.eta || {};
            const maxKm = e.maxKm !== undefined ? Number(e.maxKm) : (c.maxKm || 40), mins = e.notifyMinutes !== undefined ? Number(e.notifyMinutes) : (c.notifyMinutes || 15);
            if (!(maxKm >= 5 && maxKm <= 300) || !(mins >= 1 && mins <= 120)) return res.status(400).json({ error: "Distance 5–300 km, minutes 1–120." });
            set.eta = { ...c, enabled: bool(e.enabled, c.enabled !== false), maxKm, notifyMinutes: mins, routing: bool(e.routing, c.routing !== false) };
        }
        if (b.camera && typeof b.camera === "object") {
            const sens = Number(b.camera.sensitivity);
            if (b.camera.sensitivity !== undefined && (!Number.isInteger(sens) || sens < 1 || sens > 10)) return res.status(400).json({ error: "Sensitivity is 1 to 10." });
            if (b.camera.sensitivity !== undefined) set["camera.sensitivity"] = sens;
            if (typeof b.camera.video === "boolean") set["camera.video"] = b.camera.video;
            if (typeof b.camera.auto === "boolean") { set["camera.auto"] = b.camera.auto; set["camera.autoState"] = {}; }
        }
        await HomeSettings.updateOne({ owner: req.rootUser._id }, { $set: set });
        return res.json(publicSettings(await automation.settingsOf(req.rootUser._id)));
    } catch (e) { return fail(res, e, "Could not save the settings."); }
});

const newId = () => crypto.randomBytes(6).toString("hex");

router.put("/home/schedules", authenticate, writeLimiter, async (req, res) => {
    try {
        const list = Array.isArray(req.body && req.body.schedules) ? req.body.schedules : null;
        if (!list || list.length > 20) return res.status(400).json({ error: "Up to 20 schedules." });
        const clean = [];
        for (const s of list) {
            if (!s || !automation.okTime(s.time)) return res.status(400).json({ error: "Each schedule needs a time like 23:00." });
            const steps = automation.cleanSteps(s.steps);
            if (!steps) return res.status(400).json({ error: "Each schedule needs at least one allowed command." });
            const days = Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
            clean.push({ id: /^[a-f0-9]{12}$/.test(s.id || "") ? s.id : newId(), name: String(s.name || "").trim().slice(0, 60) || s.time, time: s.time, days, steps, enabled: s.enabled !== false });
        }
        await automation.settingsOf(req.rootUser._id);
        await HomeSettings.updateOne({ owner: req.rootUser._id }, { $set: { schedules: clean } });
        return res.json({ schedules: clean });
    } catch (e) { return fail(res, e, "Could not save the schedules."); }
});

router.put("/home/places", authenticate, writeLimiter, async (req, res) => {
    try {
        const list = Array.isArray(req.body && req.body.places) ? req.body.places : null;
        if (!list || list.length > 10) return res.status(400).json({ error: "Up to 10 places." });
        const owner = req.rootUser._id;
        const phones = (await HomeDevice.find({ owner, kind: "phone" }).select("_id").lean()).map((d) => String(d._id));
        const old = new Map(((await automation.settingsOf(owner)).places || []).map((p) => [p.id, p]));
        const clean = [];
        for (const p of list) {
            const lat = Number(p && p.lat), lon = Number(p && p.lon), radius = Math.round(Number(p && p.radius));
            if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) || (p.lat === "" || p.lon === "")) return res.status(400).json({ error: "Each place needs a location (latitude and longitude)." });
            if (!(radius >= 50 && radius <= 2000)) return res.status(400).json({ error: "The radius is 50 to 2000 metres." });
            if (!phones.includes(String(p.phone))) return res.status(400).json({ error: "Pick one of your paired family phones." });
            const group = String(p.group || "").trim().slice(0, 80);
            const txt = (v) => String(v || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500);
            for (const t of ["arriveFrom", "arriveTo", "leaveFrom", "leaveTo"]) if (p[t] && !automation.okTime(p[t])) return res.status(400).json({ error: "Times look like 09:30." });
            if (!!p.arriveFrom !== !!p.arriveTo || !!p.leaveFrom !== !!p.leaveTo) return res.status(400).json({ error: "Give both a from and a to time, or neither." });
            const id = /^[a-f0-9]{12}$/.test(p.id || "") ? p.id : newId();
            clean.push({ id, name: String(p.name || "").trim().slice(0, 40) || "Place", lat, lon, radius, phone: String(p.phone), group, arriveText: txt(p.arriveText), leaveText: txt(p.leaveText),
                arriveFrom: p.arriveFrom || "", arriveTo: p.arriveTo || "", leaveFrom: p.leaveFrom || "", leaveTo: p.leaveTo || "", tgArrive: p.tgArrive === true, tgLeave: p.tgLeave === true, enabled: p.enabled !== false, strictWindow: p.strictWindow === true, state: (old.get(id) || {}).state || "" });
        }
        await HomeSettings.updateOne({ owner }, { $set: { places: clean } });
        return res.json({ places: clean });
    } catch (e) { return fail(res, e, "Could not save the places."); }
});

// Where the phone of a place is right now, how far from the place, and the last 24 hours: what the Places card on the Automations page shows.
router.get("/home/places/:id/trail", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const owner = req.rootUser._id, now = Date.now();
        const settings = await automation.settingsOf(owner);
        const p = (settings.places || []).find((x) => x.id === req.params.id);
        if (!p) return res.status(404).json({ error: "Place not found." });
        const phone = mongoose.isValidObjectId(String(p.phone)) ? await HomeDevice.findOne({ _id: p.phone, owner, kind: "phone" }).lean() : null;
        const fixes = phone ? await placeFixes.last24h(owner, phone._id, now) : [];
        const loc = phone && phone.status && phone.status.location;
        const have = loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lon));
        const dist = have ? placeTrail.distanceM({ lat: Number(loc.lat), lon: Number(loc.lon) }, p) : null;
        const all = placeTrail.trailOf(p, fixes);
        const real = all.filter((x) => !x.same);
        // how often the phone really reports: the typical gap between its last points (3 hours)
        const recent = all.filter((x) => x.at > now - 3 * 3600000).map((x) => x.at);
        const gaps = recent.slice(1).map((t, i) => t - recent[i]).sort((a, b) => a - b);
        const tz = settings.timezone || "Asia/Kolkata";
        const kinds = ["place", "place_failed", "place_skipped", "place_state"];
        const escaped = String(p.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const events = await HomeEvent.find({ owner, kind: { $in: kinds }, at: { $gte: new Date(now - 24 * 3600000) }, text: { $regex: escaped } }).sort({ at: -1 }).limit(30).lean();
        return res.json({
            place: { id: p.id, name: p.name, lat: p.lat, lon: p.lon, radius: p.radius, state: p.state || "", enabled: p.enabled !== false },
            phone: phone ? { id: String(phone._id), name: phone.person || phone.name, lastSeen: phone.lastSeen || null, battery: (home.batteryOf(phone.status) || {}).pct ?? null } : null,
            now: have ? { lat: Number(loc.lat), lon: Number(loc.lon), acc: Math.round(Number(loc.acc) || 0), at: Number(loc.at) || null, ageSec: Math.max(0, Math.round((now - Number(loc.at)) / 1000)),
                distanceM: Math.round(dist), beyondM: Math.round(dist - p.radius), state: placeTrail.classify(dist, p, loc.acc) } : null,
            summary: placeTrail.summarize(all),
            rule: { radius: p.radius, outBeyondM: Math.round(placeTrail.outBeyond(p, have ? loc.acc : 0)), minMarginM: 20, strictWindow: p.strictWindow === true, watchingNow: placeTrail.watching(p, automation.localParts(now, tz).minutes), arrive: p.arriveFrom ? `${p.arriveFrom}–${p.arriveTo}` : "", leave: p.leaveFrom ? `${p.leaveFrom}–${p.leaveTo}` : "" },
            checkInEverySec: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)] / 1000) : null,
            trail: placeTrail.downsample(all, 240),
            events: events.map((e) => ({ at: new Date(e.at).getTime(), kind: e.kind, text: e.text }))
        });
    } catch (e) { return fail(res, e, "Could not load the place."); }
});

router.post("/home/places/:id/test", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id;
        const p = ((await automation.settingsOf(owner)).places || []).find((x) => x.id === req.params.id);
        if (!p) return res.status(404).json({ error: "Place not found." });
        const text = String(req.body && req.body.text || p.arriveText || "Test message from Stashr").slice(0, 500);
        const hubs = await HomeDevice.find({ owner, kind: "hub" }).lean();
        const tablet = homeRouter.hubsFor(hubs, "send_whatsapp")[0];
        const entry = tablet && p.group && await automation.queue(tablet, "send_whatsapp", { group: p.group, text });
        if (!entry) return res.status(400).json({ error: "Add the WhatsApp group name and make sure the tablet is paired." });
        return res.json({ ok: true, sent: { device: tablet.name, id: entry.id } });
    } catch (e) { return fail(res, e, "Could not send the test."); }
});

// What the tablet answered for a test it was given: pending/sent (still working), done or failed with its own words.
router.get("/home/places/test/:cmd", authenticate, async (req, res) => {
    try {
        const hubs = await HomeDevice.find({ owner: req.rootUser._id, kind: "hub", "commands.id": String(req.params.cmd).slice(0, 40) }, { name: 1, commands: 1, lastSeen: 1 }).lean();
        const hub = hubs[0], c = hub && (hub.commands || []).find((x) => x.id === req.params.cmd);
        if (!c) return res.status(404).json({ error: "That test is no longer on the tablet's list." });
        return res.json({ status: c.status, result: c.result || "", tablet: hub.name, lastSeen: hub.lastSeen || null });
    } catch (e) { return fail(res, e, "Could not read the test."); }
});

router.put("/home/scenes", authenticate, writeLimiter, async (req, res) => {
    try {
        const list = Array.isArray(req.body && req.body.scenes) ? req.body.scenes : null;
        if (!list || list.length > 12) return res.status(400).json({ error: "Up to 12 scenes." });
        const clean = [];
        for (const s of list) {
            const name = String((s && s.name) || "").trim().slice(0, 40);
            const steps = automation.cleanSteps(s && s.steps);
            if (!name || !steps) return res.status(400).json({ error: "Each scene needs a name and at least one allowed command." });
            clean.push({ id: /^[a-z0-9-]{3,40}$/.test(s.id || "") ? s.id : newId(), name, steps });
        }
        await automation.settingsOf(req.rootUser._id);
        await HomeSettings.updateOne({ owner: req.rootUser._id }, { $set: { scenes: clean } });
        return res.json({ scenes: clean });
    } catch (e) { return fail(res, e, "Could not save the scenes."); }
});

router.post("/home/scenes/:id/run", authenticate, writeLimiter, async (req, res) => {
    try {
        const s = await automation.settingsOf(req.rootUser._id);
        const scene = (s.scenes && s.scenes.length ? s.scenes : automation.DEFAULT_SCENES).find((x) => x.id === req.params.id);
        if (!scene) return res.status(404).json({ error: "Scene not found." });
        const devices = await HomeDevice.find({ owner: req.rootUser._id }).lean();
        const sent = await automation.runSteps(req.rootUser._id, devices, scene.steps, `Scene “${scene.name}”`);
        return res.json({ sent });
    } catch (e) { return fail(res, e, "Could not run the scene."); }
});

/* ───────── TV time, internet speed ───────── */

router.get("/home/usage", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const s = await automation.settingsOf(req.rootUser._id);
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 35);
        const out = [];
        for (let i = days - 1; i >= 0; i--) {
            const date = automation.localParts(Date.now() - i * 24 * 3600 * 1000, s.timezone).date;
            const u = (s.usage || {})[date] || {};
            out.push({ date, minutes: u.minutes || 0, apps: u.apps || {} });
        }
        return res.json({ days: out, limit: s.tvLimit.minutes || 0 });
    } catch (e) { return fail(res, e, "Could not load TV time."); }
});

router.get("/home/speed", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
        const rows = await HomeSpeed.find({ owner: req.rootUser._id, at: { $gte: new Date(Date.now() - days * 24 * 3600 * 1000) } }).sort({ at: 1 }).limit(3000).lean();
        return res.json({ samples: rows.map((r) => ({ at: r.at, down: r.down, up: r.up, ping: r.ping })) });
    } catch (e) { return fail(res, e, "Could not load the speed history."); }
});

/* ───────── camera ───────── */

const lastMotion = new Map(); // device -> time of the last motion alert sent to Telegram

router.post("/home/agent/media", agentLimiter, agentAuth, (req, res, next) => {
    const kind = req.query.kind === "video" ? "video" : "photo";
    return express.raw({ type: media.TYPES[kind], limit: media.LIMITS[kind] })(req, res, next);
}, async (req, res) => {
    try {
        const d = req.device;
        if (d.kind !== "hub") return res.status(403).json({ error: "Only the tablet can send camera pictures." });
        const kind = req.query.kind === "video" ? "video" : "photo";
        const reason = ["motion", "snapshot", "clip"].includes(req.query.reason) ? req.query.reason : "snapshot";
        if (!media.looksLike(kind, req.body)) return res.status(400).json({ error: kind === "video" ? "Send an MP4 video." : "Send a JPEG photo." });
        const id = await media.save({ owner: d.owner, device: d._id, kind, reason, buffer: req.body });
        const settings = await automation.settingsOf(d.owner);
        const isMotion = reason === "motion";
        const recent = Date.now() - (lastMotion.get(String(d._id)) || 0) < 60 * 1000;
        const text = isMotion ? `📷 Someone came into the ${d.name} camera's view` : `📷 ${kind === "video" ? "Clip" : "Photo"} from the ${d.name} camera`;
        if (kind === "photo" || !isMotion) await record({ owner: d.owner, device: d._id, deviceName: d.name, kind: isMotion ? "camera" : "camera_shot", text });
        // Movement: the photo (and later the clip) goes to your Telegram chat, at most one alert a minute per tablet.
        if ((isMotion && settings.alerts.camera !== false && (kind === "video" || !recent)) || reason !== "motion") {
            if (isMotion && kind === "photo") lastMotion.set(String(d._id), Date.now());
            const User = require("../models/schema");
            const bot = require("../utils/telegramBot");
            const skip = Object.fromEntries([...User.HISTORY_FIELDS, ...User.PHOTO_FIELDS, "passwords"].map((f) => [f, 0]));
            const user = await User.findById(d.owner, skip);
            if (user) void bot.notifyUserMedia(user, { kind, buffer: req.body, caption: text });
        }
        return res.status(201).json({ id: String(id) });
    } catch (e) { return fail(res, e, "Could not save the picture."); }
});

router.get("/home/media", authenticate, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json({ media: await media.list(req.rootUser._id, 60) }); }
    catch (e) { return fail(res, e, "Could not load the camera pictures."); }
});

router.get("/home/media/:id", authenticate, async (req, res) => {
    try {
        const file = await media.find(req.rootUser._id, req.params.id);
        if (!file) return res.status(404).json({ error: "Not found." });
        res.set({ "Content-Type": file.contentType || (file.metadata.kind === "video" ? "video/mp4" : "image/jpeg"), "Content-Length": String(file.length), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
        media.stream(file).on("error", () => res.destroy()).pipe(res);
    } catch (e) { return fail(res, e, "Could not load that."); }
});

router.delete("/home/media/:id", authenticate, writeLimiter, async (req, res) => {
    try {
        const file = await media.find(req.rootUser._id, req.params.id);
        if (!file) return res.status(404).json({ error: "Not found." });
        await media.remove(file);
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not delete that."); }
});

// Live view: the tablet sends a small JPEG every second or two while someone is watching (2 minutes per request).
router.post("/home/agent/live", agentLimiterLive(), agentAuth, express.raw({ type: ["image/jpeg"], limit: 512 * 1024 }), async (req, res) => {
    try {
        if (req.device.kind !== "hub") return res.status(403).json({ error: "Only the tablet can send camera pictures." });
        if (!media.looksLike("photo", req.body)) return res.status(400).json({ error: "Send a JPEG photo." });
        await HomeLiveFrame.updateOne({ _id: req.device._id }, { $set: { owner: req.device.owner, at: new Date(), data: req.body } }, { upsert: true });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not save the frame."); }
});

router.get("/home/camera/live", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const frame = await HomeLiveFrame.findOne({ owner: req.rootUser._id }).sort({ at: -1 }).lean();
        if (!frame || Date.now() - new Date(frame.at).getTime() > 20 * 1000) return res.status(204).end();
        res.set({ "Content-Type": "image/jpeg", "X-Frame-At": new Date(frame.at).toISOString(), "Access-Control-Expose-Headers": "X-Frame-At" });
        return res.send(Buffer.from(frame.data.buffer || frame.data));
    } catch (e) { return fail(res, e, "Could not load the live view."); }
});

/* ───────── the tablet's screen ───────── */

const weatherCache = new Map(); // owner -> { at, value }

/** What the tablet's home screen shows; the website shows the same (GET /home/dashboard). */
const dashCache = new Map();   // owner -> { at, value }: the tablet and the website ask for the same picture every few seconds
async function buildDashboard(owner) {
    const hit = dashCache.get(String(owner));
    if (hit && Date.now() - hit.at < 8000) return hit.value;
    const value = await buildDashboardNow(owner);
    dashCache.set(String(owner), { at: Date.now(), value });
    if (dashCache.size > 200) dashCache.delete(dashCache.keys().next().value);
    return value;
}
async function buildDashboardNow(owner) {
    const s = await automation.settingsOf(owner);
    const devices = await HomeDevice.find({ owner }).lean();
    let w = weatherCache.get(String(owner));
    if (!w || Date.now() - w.at > 15 * 60 * 1000) {
        w = { at: Date.now(), value: await weather.forecast(s.weather, s.timezone).catch(() => null) };
        weatherCache.set(String(owner), w);
    }
    const today = ((s.usage || {})[automation.localParts(Date.now(), s.timezone).date] || {}).minutes || 0;
    const events = await HomeEvent.find({ owner }).sort({ at: -1 }).limit(8).lean();
    const speed = await HomeSpeed.findOne({ owner }).sort({ at: -1 }).lean();
    const tvs = devices.filter((d) => d.kind === "tv").map((d) => {
        const p = homeRouter.publicDevice(d);
        return { name: p.name, online: p.online, screen: (p.status || {}).screen || "", app: ((p.status || {}).app || {}).label || "", title: ((p.status || {}).media || {}).title || "" };
    });
    // The family phones, for the phone widgets: who is online, battery, and Remote lock as the phone last reported it (so the
    // Lock button is offered ONLY for a phone that says Remote lock is on (Stashr Location 1.11.1 reports the moment it is switched on or off).
    const phones = devices.filter((d) => d.kind === "phone").map((d) => {
        const p = homeRouter.publicDevice(d);
        const st = p.status || {};
        const bat = home.batteryOf(st);
        return { id: String(d._id), name: p.name, person: p.person || "", online: Boolean(p.online), battery: bat ? bat.pct : null, charging: Boolean(bat && bat.charging), wifi: Boolean(st.wifi), canLock: st.agent === "stashr-where" && Boolean(st.health && st.health.remoteLock === true), remoteLock: st.health && typeof st.health.remoteLock === "boolean" ? st.health.remoteLock : null };
    }).slice(0, 6);
    return {
        time: new Date().toISOString(), timezone: s.timezone, weather: w.value, tvs, phones, tvMinutesToday: today,
        people: home.presence(devices.filter((d) => d.kind === "hub"), devices.filter((d) => d.kind === "phone"), Date.now(), s.homeSpot),
        coming: automation.comingList(s),
        events: events.map((e) => ({ text: e.text, at: e.at })), speed: speed ? { down: speed.down, up: speed.up, ping: speed.ping, at: speed.at } : null,
        scenes: (s.scenes && s.scenes.length ? s.scenes : automation.DEFAULT_SCENES).map((x) => ({ id: x.id, name: x.name, steps: x.steps || [] })),
        // For local mode: Wi-Fi device key -> person, so the tablet can announce an arrival by itself when the server is down.
        localPeople: Object.fromEntries(devices.filter((d) => d.kind === "hub").flatMap((h) => Object.entries(h.lanLabels || {}).filter(([, l]) => l && l.person).map(([k, l]) => [k, l.person]))),
        ...(await require("./homeInsights").tabletLines(owner, s).catch(() => ({ nudges: [], trips: [] }))),
        config: { camera: { sensitivity: (s.camera && s.camera.sensitivity) || 5, video: !(s.camera && s.camera.video === false), alerts: s.alerts.camera !== false } }
    };
}

router.get("/home/agent/dashboard", agentLimiter, agentAuth, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json(await buildDashboard(req.device.owner)); }
    catch (e) { return fail(res, e, "Could not load the dashboard."); }
});

/* ───────── widget keys: read-only access to the dashboard for the phone's home-screen widgets ───────── */

const WIDGET_KEY = /^wk_[a-f0-9]{48}$/;
const MAX_WIDGET_KEYS = 10;
const hashKey = (k) => crypto.createHash("sha256").update(k).digest("hex");

router.post("/home/widget-keys", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id;
        if ((await HomeWidgetKey.countDocuments({ owner })) >= MAX_WIDGET_KEYS) return res.status(429).json({ error: "Too many widget keys. Remove one you do not use." });
        const key = "wk_" + crypto.randomBytes(24).toString("hex");
        const name = String((req.body && req.body.name) || "Phone widgets").replace(/[^\w .-]/g, "").trim().slice(0, 60) || "Phone widgets";
        const doc = await HomeWidgetKey.create({ owner, name, hash: hashKey(key), hint: key.slice(-4) });
        // The key is shown once, here; only its hash is kept.
        return res.status(201).json({ id: String(doc._id), key, name });
    } catch (e) { return fail(res, e, "Could not make a widget key."); }
});

router.get("/home/widget-keys", authenticate, async (req, res) => {
    try {
        const list = await HomeWidgetKey.find({ owner: req.rootUser._id }).sort({ createdAt: -1 }).lean();
        return res.json({ keys: list.map((k) => ({ id: String(k._id), name: k.name, hint: k.hint, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })) });
    } catch (e) { return fail(res, e, "Could not list the widget keys."); }
});

router.delete("/home/widget-keys/:id", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.status(404).json({ error: "Not found." });
        const r = await HomeWidgetKey.deleteOne({ _id: req.params.id, owner: req.rootUser._id });
        return r.deletedCount ? res.json({ ok: true }) : res.status(404).json({ error: "Not found." });
    } catch (e) { return fail(res, e, "Could not remove the widget key."); }
});

// What the widgets show, the same picture as the tablet and the app: asked every 15 seconds while the phone's screen is on.
router.get("/home/widget/dashboard", agentLimiter, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const key = String(req.get("x-widget-key") || "");
        if (!WIDGET_KEY.test(key)) return res.status(401).json({ error: "Not allowed." });
        const doc = await HomeWidgetKey.findOne({ hash: hashKey(key) }).lean();
        if (!doc) return res.status(401).json({ error: "Not allowed." });
        // Note when it was last used, at most once a minute (the list in the app shows it).
        if (!doc.lastUsedAt || Date.now() - new Date(doc.lastUsedAt).getTime() > 60_000) void HomeWidgetKey.updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
        return res.json(await buildDashboard(doc.owner));
    } catch (e) { return fail(res, e, "Could not load the dashboard."); }
});

router.get("/home/dashboard", authenticate, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json(await buildDashboard(req.rootUser._id)); }
    catch (e) { return fail(res, e, "Could not load the dashboard."); }
});

router.get("/home/agent/today", agentLimiter, agentAuth, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const s = await automation.settingsOf(req.device.owner);
        return res.json(await automation.todayLines(req.device.owner, s));
    } catch (e) { return fail(res, e, "Could not load today's updates."); }
});

// What the TV launcher shows on top: the weather, the morning headlines, movie night.
router.get("/home/agent/tv-home", agentLimiter, agentAuth, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const owner = req.device.owner;
        const s = await automation.settingsOf(owner);
        const devices = await HomeDevice.find({ owner }).lean();
        let w = weatherCache.get(String(owner));
        if (!w || Date.now() - w.at > 15 * 60 * 1000) {
            w = { at: Date.now(), value: await weather.forecast(s.weather, s.timezone).catch(() => null) };
            weatherCache.set(String(owner), w);
        }
        const n = s.news || {};
        return res.json({
            time: new Date().toISOString(), timezone: s.timezone, weather: w.value,
            news: n.enabled === false ? [] : await news.headlines(n.lang || "en", Math.min(Math.max(Number(n.count) || 6, 1), 10)),
            movieNight: automation.movieNightOn(s, devices),
            coming: automation.comingList(s)
        });
    } catch (e) { return fail(res, e, "Could not load the TV home screen."); }
});

router.post("/home/agent/scene/:id", agentLimiter, agentAuth, async (req, res) => {
    try {
        const s = await automation.settingsOf(req.device.owner);
        const scene = (s.scenes && s.scenes.length ? s.scenes : automation.DEFAULT_SCENES).find((x) => x.id === req.params.id);
        if (!scene) return res.status(404).json({ error: "Scene not found." });
        const devices = await HomeDevice.find({ owner: req.device.owner }).lean();
        return res.json({ sent: await automation.runSteps(req.device.owner, devices, scene.steps, `Scene “${scene.name}” (from ${req.device.name})`) });
    } catch (e) { return fail(res, e, "Could not run the scene."); }
});

router.post("/home/agent/assistant", agentLimiter, agentAuth, async (req, res) => {
    try {
        if (req.device.kind !== "hub") return res.status(403).json({ error: "Only the tablet can do that." });
        const out = await homeRouter.runSentence(req.device.owner, String((req.body && req.body.text) || "").slice(0, 200), { fromHub: true });
        if (out.error) return res.status(out.status || 400).json({ error: out.error });
        return res.json(out);
    } catch (e) { return fail(res, e, "Could not do that."); }
});

/* ───────── tidying the Wi-Fi list, family phones ───────── */

const okKey = (k) => /^[a-z0-9-]{1,60}$/.test(String(k || ""));

// "These two rows are the same phone": the history and label go to one row, the other row is removed.
router.post("/home/devices/:id/lan/:key/merge", authenticate, writeLimiter, async (req, res) => {
    try {
        const into = String((req.body && req.body.into) || "");
        if (!validId(req.params.id) || !okKey(req.params.key) || !okKey(into) || into === req.params.key) return res.status(400).json({ error: "Pick the row to merge into." });
        const hub = await HomeDevice.findOne({ _id: req.params.id, owner: req.rootUser._id, kind: "hub" }).lean();
        const book = { ...(hub && hub.lanBook) }, labels = { ...(hub && hub.lanLabels) };
        if (!hub || !book[req.params.key] || !book[into]) return res.status(404).json({ error: "Device not found." });
        const from = book[req.params.key], to = book[into];
        const fresh = from.lastSeen > to.lastSeen ? from : to;
        book[into] = { ...to, ip: fresh.ip, up: Boolean(from.up || to.up), lastSeen: Math.max(from.lastSeen, to.lastSeen), firstSeen: Math.min(from.firstSeen, to.firstSeen), name: to.name || from.name, ports: to.ports && to.ports.length ? to.ports : from.ports };
        if (!labels[into] && labels[req.params.key]) labels[into] = labels[req.params.key];
        delete book[req.params.key]; delete labels[req.params.key];
        await HomeDevice.updateOne({ _id: hub._id }, { $set: { lanBook: book, lanLabels: labels } });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not merge."); }
});

router.delete("/home/devices/:id/lan/:key", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id) || !okKey(req.params.key)) return res.status(404).json({ error: "Device not found." });
        const r = await HomeDevice.updateOne({ _id: req.params.id, owner: req.rootUser._id, kind: "hub" }, { $unset: { ["lanBook." + req.params.key]: "", ["lanLabels." + req.params.key]: "" } });
        if (!r.matchedCount) return res.status(404).json({ error: "Device not found." });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not remove it."); }
});

router.put("/home/devices/:id/person", authenticate, writeLimiter, async (req, res) => {
    try {
        const person = String((req.body && req.body.person) || "").trim().slice(0, 40);
        if (!validId(req.params.id)) return res.status(404).json({ error: "Device not found." });
        const r = await HomeDevice.updateOne({ _id: req.params.id, owner: req.rootUser._id, kind: "phone" }, { $set: { person } });
        if (!r.matchedCount) return res.status(404).json({ error: "Device not found." });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not save."); }
});

/* ───────── briefs ───────── */

router.post("/home/brief/test", authenticate, writeLimiter, async (req, res) => {
    try {
        const s = await automation.settingsOf(req.rootUser._id);
        const weekly = req.body && req.body.which === "weekly";
        const sent = await require("../utils/homeReport").sendReport(req.rootUser._id, { hours: weekly ? 168 : 24 });
        return res.json({ sent });
    } catch (e) { return fail(res, e, "Could not make the brief."); }
});

module.exports = router;
