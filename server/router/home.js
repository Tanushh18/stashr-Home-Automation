/**
 * Stashr Home: the TV and the always-on tablet report here, and you see and control them from the Stashr web page.
 *
 *   Signed-in user                                   Device (token in "Authorization: Bearer sh_...")
 *   GET    /home/devices                             POST /home/agent/report   status in, commands out
 *   POST   /home/devices            add a device
 *   DELETE /home/devices/:id
 *   POST   /home/devices/:id/token  new token
 *   POST   /home/devices/:id/commands
 *   PUT    /home/devices/:id/lan/:key   name / room of a Wi-Fi device
 *   GET    /home/events
 *
 * A device token can only call /home/agent/report. It cannot read the vault or anything else.
 */
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const HomeDevice = require("../models/homeDevice");
const HomeSettings = require("../models/homeSettings");
const HomeEvent = require("../models/homeEvent");
const home = require("../utils/home");
const assistant = require("../utils/homeAssistant");
const movies = require("../utils/homeMovies");
const MovieSettings = require("../models/homeMovieSettings");
const { record } = require("../utils/homeEvents");
const automation = require("../utils/homeAutomation");
const HomeSpeed = require("../models/homeSpeed");
const waSender = require("../utils/waSender");

const MAX_DEVICES = 20;
// A family phone reports every 15 minutes (Android does not allow more often in the background).
const PHONE_ONLINE_MS = 75 * 60 * 1000; // the location app checks in as rarely as every 30 min, and phones doze
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many changes. Slow down." });
const agentLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: "Too many reports." });

const fail = (res, error, fallback) => res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : fallback });
const validId = (id) => mongoose.isValidObjectId(id);

/** What the web page and the app are allowed to see about a device. Never the token hash. */
function publicDevice(d, now = Date.now()) {
    const out = {
        id: String(d._id), name: d.name, kind: d.kind, tokenHint: d.tokenHint || "", viaHub: Boolean(d.parent),
        online: d.syncPaused ? false : d.kind === "phone" ? Boolean(d.lastSeen) && now - new Date(d.lastSeen).getTime() < PHONE_ONLINE_MS : Boolean(d.online) && home.isOnline(d, now), lastSeen: d.lastSeen || null, onlineSince: d.onlineSince || null, syncPaused: Boolean(d.syncPaused),
        status: d.status || {},
        ...(d.kind === "phone" ? { roomOn: Boolean(d.roomOn) } : {}),
        ...(d.kind === "phone" ? { push: { on: Boolean(d.fcmSet), seenAt: d.fcmSeenAt || null, askedAt: d.fcmPushedAt || null, misses: d.fcmMisses || 0 } } : {}),
        commands: (d.commands || []).slice(-10).reverse().map((c) => ({ id: c.id, type: c.type, args: c.args, status: c.status, result: c.result, createdAt: c.createdAt }))
    };
    if (d.kind === "hub") {
        const labels = d.lanLabels || {};
        out.lan = Object.entries(d.lanBook || {}).map(([key, v]) => {
            const l = labels[key] || {};
            return {
                key, ...v, label: l.label || "", room: l.room || "", tag: l.tag || "", person: l.person || "",
                wakeMac: l.mac || (v.mac && v.mac !== "02:00:00:00:00:00" ? v.mac : ""), risks: home.risksOf(v.ports),
                stale: !v.up && now - v.lastSeen > 24 * 3600 * 1000
            };
        }).sort((a, b) => (b.up - a.up) || (b.lastSeen - a.lastSeen));
    }
    if (d.kind === "phone") out.person = d.person || "";
    return out;
}

/** Joins each family phone to the Wi-Fi row at its address, so the row shows the phone's name and health. */
function linkPhones(devices) {
    const phones = devices.filter((d) => d.kind === "phone" && d.status && d.status.wifi && d.status.ip);
    for (const hub of devices.filter((d) => d.kind === "hub")) {
        for (const row of hub.lan || []) {
            const p = phones.find((x) => x.status.ip === row.ip && row.up);
            if (p) row.phone = { id: p.id, name: p.name, person: p.person, battery: (home.batteryOf(p.status) || {}).pct ?? null, charging: Boolean((home.batteryOf(p.status) || {}).charging), storage: p.status.storage, online: p.online, lastSeen: p.lastSeen };
        }
    }
    return devices;
}

/* ───────── you ───────── */

router.get("/home/devices", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const list = await HomeDevice.find({ owner: req.rootUser._id }).sort({ createdAt: 1 }).lean();
        const devices = linkPhones(list.map((d) => publicDevice(d)));
        const people = home.presence(list.filter((d) => d.kind === "hub"), list.filter((d) => d.kind === "phone"), Date.now(), (await automation.settingsOf(req.rootUser._id)).homeSpot);
        return res.json({ devices, people });
    } catch (e) { return fail(res, e, "Could not load your devices."); }
});

router.post("/home/devices", authenticate, writeLimiter, async (req, res) => {
    try {
        const name = String((req.body && req.body.name) || "").trim().slice(0, 60);
        const kind = String((req.body && req.body.kind) || "");
        if (!name) return res.status(400).json({ error: "Give the device a name." });
        if (!["tv", "hub"].includes(kind)) return res.status(400).json({ error: "Device kind must be tv or hub." });
        if (await HomeDevice.countDocuments({ owner: req.rootUser._id, parent: { $exists: false } }) >= MAX_DEVICES) return res.status(400).json({ error: `You can add up to ${MAX_DEVICES} devices.` });
        const token = home.newToken();
        // The tablet app signs in and registers itself. Signing in again on the same tablet (same name) takes over
        // its place with a fresh token, instead of adding a second tablet.
        if (kind === "hub" && req.body.reuse === true) {
            const again = await HomeDevice.findOneAndUpdate({ owner: req.rootUser._id, kind: "hub", name, parent: { $exists: false } }, { $set: { tokenHash: home.hashToken(token), tokenHint: token.slice(-4) } }, { returnDocument: "after" });
            if (again) return res.status(200).json({ device: publicDevice(again), token });
        }
        const device = await HomeDevice.create({ owner: req.rootUser._id, name, kind, tokenHash: home.hashToken(token), tokenHint: token.slice(-4) });
        return res.status(201).json({ device: publicDevice(device), token });
    } catch (e) { return fail(res, e, "Could not add the device."); }
});

router.post("/home/devices/:id/token", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ error: "Device not found." });
        const token = home.newToken();
        const r = await HomeDevice.updateOne({ _id: req.params.id, owner: req.rootUser._id, parent: { $exists: false } }, { $set: { tokenHash: home.hashToken(token), tokenHint: token.slice(-4) } });
        if (!r.matchedCount) return res.status(404).json({ error: "Device not found." });
        return res.json({ token });
    } catch (e) { return fail(res, e, "Could not make a new token."); }
});

router.put("/home/devices/:id", authenticate, writeLimiter, async (req, res) => {
    try {
        const name = String((req.body && req.body.name) || "").trim().slice(0, 60);
        if (!validId(req.params.id) || !name) return res.status(400).json({ error: "Give the device a name." });
        const r = await HomeDevice.updateOne({ _id: req.params.id, owner: req.rootUser._id }, { $set: { name } });
        if (!r.matchedCount) return res.status(404).json({ error: "Device not found." });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not rename it."); }
});

// Pause or resume syncing for one device (a phone's location, the tablet, the TV): it stays linked, but nothing it sends is stored and it is shown offline until resumed.
router.put("/home/devices/:id/sync", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id) || typeof (req.body && req.body.paused) !== "boolean") return res.status(400).json({ error: "Say whether syncing is paused." });
        const paused = req.body.paused;
        const d = await HomeDevice.findOne({ _id: req.params.id, owner: req.rootUser._id, parent: { $exists: false } });
        if (!d) return res.status(404).json({ error: "Device not found." });
        if (Boolean(d.syncPaused) === paused) return res.json({ ok: true, syncPaused: paused });
        const set = { syncPaused: paused };
        if (paused) set.online = false;
        const ids = paused ? [d._id, ...(await HomeDevice.find({ owner: d.owner, parent: d._id }).distinct("_id"))] : [d._id];
        await HomeDevice.updateMany({ _id: { $in: ids } }, { $set: set });
        await record({ owner: d.owner, device: d._id, deviceName: d.name, kind: paused ? "sync_paused" : "sync_resumed", text: paused ? `Syncing with ${d.name} is paused from the website` : `Syncing with ${d.name} is back on` });
        return res.json({ ok: true, syncPaused: paused });
    } catch (e) { return fail(res, e, "Could not change syncing."); }
});

router.delete("/home/devices/:id", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ error: "Device not found." });
        const r = await HomeDevice.deleteOne({ _id: req.params.id, owner: req.rootUser._id });
        if (!r.deletedCount) return res.status(404).json({ error: "Device not found." });
        await HomeDevice.deleteMany({ owner: req.rootUser._id, parent: req.params.id });
        await HomeEvent.deleteMany({ owner: req.rootUser._id, device: req.params.id });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not remove the device."); }
});

// A device that was linked again under another name: move everything of the old entry (:id) to the one you keep (into), then remove the old one.
router.post("/home/devices/:id/merge", authenticate, writeLimiter, async (req, res) => {
    try {
        const out = await require("../utils/homeMerge").mergeDevices(req.rootUser._id, req.params.id, req.body && req.body.into);
        return res.json({ ok: true, ...out });
    } catch (e) { return fail(res, e, "Could not merge the devices."); }
});

router.post("/home/devices/:id/commands", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ error: "Device not found." });
        const device = await HomeDevice.findOne({ _id: req.params.id, owner: req.rootUser._id }).lean();
        if (!device) return res.status(404).json({ error: "Device not found." });
        const command = home.cleanCommand(device.kind, String((req.body && req.body.type) || ""), req.body && req.body.args);
        if (!command) return res.status(400).json({ error: "That command is not allowed for this device." });
        const waiting = (device.commands || []).filter((c) => c.status === "pending" || c.status === "sent").length;
        if (waiting >= home.MAX_COMMANDS) return res.status(429).json({ error: "Too many commands are waiting. Wait for the device to catch up." });
        const entry = { id: new mongoose.Types.ObjectId().toString(), ...command, status: "pending", result: "", createdAt: new Date() };
        await HomeDevice.updateOne({ _id: device._id }, { $push: { commands: { $each: [entry], $slice: -50 } } });
        await record({ owner: req.rootUser._id, device: device._id, deviceName: device.name, kind: "command", text: `Sent to ${device.name}: ${command.type}${command.args.name ? " " + command.args.name : ""}` });
        return res.status(202).json({ id: entry.id });
    } catch (e) { return fail(res, e, "Could not send the command."); }
});

router.put("/home/devices/:id/lan/:key", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id) || !/^[a-z0-9-]{1,60}$/.test(req.params.key)) return res.status(404).json({ error: "Device not found." });
        const b = req.body || {};
        const label = String(b.label || "").trim().slice(0, 60);
        const room = String(b.room || "").trim().slice(0, 60);
        const person = String(b.person || "").trim().slice(0, 40);
        const tag = home.TAGS.includes(b.tag) ? b.tag : "";
        const mac = b.mac ? (home.okMac(b.mac) ? home.normMac(b.mac) : null) : "";
        if (mac === null) return res.status(400).json({ error: "That MAC address does not look right (like aa:bb:cc:dd:ee:ff)." });
        const r = await HomeDevice.updateOne({ _id: req.params.id, owner: req.rootUser._id, kind: "hub" }, { $set: { ["lanLabels." + req.params.key]: { label, room, person, tag, mac } } });
        if (!r.matchedCount) return res.status(404).json({ error: "Device not found." });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not save."); }
});

router.get("/home/events", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const events = await HomeEvent.find({ owner: req.rootUser._id }).sort({ at: -1 }).limit(limit).lean();
        return res.json({ events: events.map((e) => ({ id: String(e._id), device: e.deviceName, kind: e.kind, text: e.text, at: e.at })) });
    } catch (e) { return fail(res, e, "Could not load events."); }
});

/** "volume up", "open netflix", "status": one sentence in, the command out to the right device. */
router.post("/home/assistant", authenticate, writeLimiter, async (req, res) => {
    try {
        const out = await runSentence(req.rootUser._id, String((req.body && req.body.text) || "").slice(0, 200));
        if (out.error) return res.status(out.status || 400).json({ error: out.error });
        return res.json(out);
    } catch (e) { return fail(res, e, "Could not do that."); }
});

/**
 * Hub commands go to the new Stashr Hub app when there is one (it can play music, run the camera and speed tests);
 * a Wi-Fi scan goes to every tablet.
 */
function hubsFor(owned, type) {
    const hubs = owned.filter((d) => d.kind === "hub");
    if (type === "scan_now") return hubs;
    const smart = hubs.filter((d) => (d.status || {}).agent === "stashr-hub");
    return (smart.length ? smart : hubs).slice(0, 1);
}

/** One sentence, from the page, the tablet's microphone or Telegram, to commands. Shared by the routes. */
async function runSentence(owner, sentence, opts = {}) {
    // A question about the past ("Papa kab nikle kal?", "kal raat tablet kab band hua", "Papa kahan kahan gaya") is answered from the timeline.
    const asked = await require("../utils/homeAsk").answer(owner, sentence).catch(() => null);
    if (asked) return { reply: asked, sent: [] };
    const owned = await HomeDevice.find({ owner }).lean();
    const settings = await automation.settingsOf(owner);
    const scenes = (settings.scenes && settings.scenes.length ? settings.scenes : automation.DEFAULT_SCENES);
    const devices = linkPhones(owned.map((d) => publicDevice(d)));
    const out = assistant.parse(sentence, devices, scenes);
    if (out.status) return { reply: assistant.statusLine(devices), sent: [] };
    if (out.presence) return { reply: assistant.presenceLine(home.presence(owned.filter((d) => d.kind === "hub"), owned.filter((d) => d.kind === "phone"), Date.now(), settings.homeSpot)), sent: [] };
    if (out.coming) return { reply: automation.comingReply(settings, owned), sent: [] };
    if (out.locate) {
        await HomeSettings.updateOne({ owner }, { $set: { locateUntil: new Date(Date.now() + 90 * 1000) } });
        void require("../utils/phonePush").nudgeOwner(owner, Date.now()).catch(() => {});
        return { reply: "Asking the family phones for a fresh location. A phone that is saving battery answers within a few minutes; ask /coming again then.", sent: [] };
    }
    if (out.today) {
        if (opts.fromHub) return { reply: out.reply, open: "today", sent: [] };
        const target = hubsFor(owned, "show_today")[0];
        const entry = target && await automation.queue(target, "show_today", {});
        return entry ? { reply: out.reply, sent: [{ device: target.name, id: entry.id, type: "show_today" }] } : { error: "The tablet is not added to Stashr Home yet.", status: 400 };
    }
    if (out.scene) {
        const scene = scenes.find((s) => s.id === out.scene);
        const n = await automation.runSteps(owner, owned, scene.steps, `Scene “${scene.name}”`);
        return { reply: n ? out.reply : "That scene has nothing the devices can do right now.", sent: [] };
    }
    if (out.youtube) {
        const tv = owned.find((d) => d.kind === "tv");
        const video = await require("../utils/homeYoutube").firstVideo(out.youtube, { music: out.music });
        const entry = tv && video && await automation.queue(tv, "open_url", { url: video.url });
        if (!entry) return { error: "Could not send that to the TV.", status: 400 };
        return { reply: video.exact ? `Playing “${video.title}” on the TV’s YouTube app.` : `Opening a YouTube search for “${video.title}” on the TV.`, sent: [{ device: tv.name, id: entry.id, type: "open_url" }] };
    }
    if (out.wake !== undefined) {
        const want = String(out.wake || "").toLowerCase();
        for (const hub of owned.filter((d) => d.kind === "hub")) {
            for (const [key, l] of Object.entries(hub.lanLabels || {})) {
                const mac = l.mac || ((hub.lanBook || {})[key] || {}).mac;
                if (!mac || !home.okMac(mac)) continue;
                if (want && !String(l.label || "").toLowerCase().includes(want)) continue;
                const target = hubsFor(owned, "wake")[0];
                const entry = target && await automation.queue(target, "wake", { mac });
                if (entry) return { reply: `Waking ${l.label || mac}.`, sent: [{ device: target.name, id: entry.id, type: "wake" }] };
            }
        }
        return { reply: "Add the computer's MAC address in its Wi-Fi row (Name / room) first, then say “wake <its name>”.", sent: [] };
    }
    const sent = [];
    for (const c of out.commands || []) {
        const targets = c.kind === "hub" ? hubsFor(owned, c.type) : owned.filter((d) => d.kind === c.kind).slice(0, 1);
        for (const target of targets) {
            const waiting = (target.commands || []).filter((x) => x.status === "pending" || x.status === "sent").length;
            if (waiting >= home.MAX_COMMANDS) return { error: "Too many commands are waiting. Wait for the device to catch up.", status: 429 };
            const entry = await automation.queue(target, c.type, c.args);
            if (entry) sent.push({ device: target.name, id: entry.id, type: entry.type });
        }
    }
    return { reply: out.reply, sent };
}

/* ───────── a device ───────── */

const agentAuth = async (req, res, next) => {
    const m = /^Bearer (sh_[a-f0-9]{48})$/.exec(req.headers.authorization || "");
    if (!m) return res.status(401).json({ error: "Bad device token." });
    const device = await HomeDevice.findOne({ tokenHash: home.hashToken(m[1]) });
    if (!device) return res.status(401).json({ error: "Bad device token." });
    req.device = device;
    next();
};

/**
 * One report from a device, whether it came itself or through the tablet. Stores the status, notes what changed
 * (on, standby, a movie added, a device joined the Wi-Fi), settles the results of earlier commands and hands out new
 * ones. `seenAt` is when the device really spoke, which for a TV behind the tablet is a moment ago.
 * Returns { error } or { commands }.
 */
async function ingest(d, body, seenAt = new Date()) {
    const now = seenAt, prev = d.status || {};
    const wasOnline = Boolean(d.online) && home.isOnline(d, now.getTime());
    const base = { owner: d.owner, device: d._id, deviceName: d.name };

    // The device is switching itself off (TV standby): show it as off at once instead of after a timeout.
    if (body.leaving === true) {
        await HomeDevice.updateOne({ _id: d._id }, { $set: { online: false, "status.screen": "off" } });
        if (wasOnline) await record({ ...base, kind: "offline", text: `${d.name} switched off`, notify: true });
        return { commands: [] };
    }

    const status = home.cleanStatus(body.status);
    if (!status) return { error: "Status is missing or too big." };

    const set = { lastSeen: now, online: true };
    if (!wasOnline) set.onlineSince = now;
    const events = [];
    if (d.kind === "hub" && status.wifi && status.wifi.bssid) void require("../utils/homeMap").noteAp(d, status.wifi.bssid, now.getTime());

    if (d.kind === "hub") {
        const labels = { ...(d.lanLabels || {}) };
        const merged = home.mergeLan(d.lanBook || {}, status.lan, labels, now.getTime());
        // A device that now reports its name moves from its IP key to its name key: so does your label.
        for (const m of merged.moves || []) if (labels[m.from] && !labels[m.to]) { labels[m.to] = labels[m.from]; delete labels[m.from]; }
        if ((merged.moves || []).length) set.lanLabels = labels;
        set.lanBook = merged.book;
        const settings = await automation.settingsOf(d.owner);
        const local = automation.localParts(now.getTime(), (settings && settings.timezone) || "Asia/Kolkata");
        events.push(...automation.lanAlerts(merged.events, labels, settings, local));
        status.lanCount = Object.values(merged.book).filter((x) => x.up).length;
        delete status.lan;
        // An internet speed test the tablet ran since its last report.
        const sp = status.speed;
        if (sp && sp.at && sp.at !== (prev.speed && prev.speed.at) && Number.isFinite(Number(sp.down))) {
            await HomeSpeed.create({ owner: d.owner, device: d._id, at: new Date(Number(sp.at) || now), down: Math.round(Number(sp.down) * 10) / 10, up: Math.round(Number(sp.up || 0) * 10) / 10, ping: Math.round(Number(sp.ping || 0)), server: String(sp.server || "").slice(0, 60) });
        }
    } else if (d.kind === "tv") {
        events.push(...home.diffMovies(prev, status));
        const up = status.upload || {};
        if (up.lastAt && up.lastName && up.lastAt !== (prev.upload && prev.upload.lastAt)) events.push({ kind: "upload", text: `Uploaded to the USB drive: ${up.lastName}` });
    }
    set.status = status;
    await HomeDevice.updateOne({ _id: d._id }, { $set: set });

    // Online / on / standby: what you asked to be told about the TV.
    if (d.kind === "tv") {
        const screenOn = status.screen !== "off", wasScreenOn = prev.screen !== "off";
        if (!wasOnline) events.push({ kind: "online", text: screenOn ? `${d.name} is on` : `${d.name} is connected (standby)`, notify: screenOn });
        else if (screenOn && !wasScreenOn) events.push({ kind: "online", text: `${d.name} turned on`, notify: true });
        else if (!screenOn && wasScreenOn) events.push({ kind: "standby", text: `${d.name} went to standby`, notify: true });
    } else if (!wasOnline && d.kind === "hub") {
        events.push({ kind: "online", text: `${d.name} is back online`, notify: true });
    }
    // Every small change at home reaches Telegram: movies, uploads, devices joining or leaving, TV on/standby.
    const LOUD = new Set(["movie_added", "movie_removed", "upload", "paired", "unpaired"]);
    for (const e of events.slice(0, 30)) await record({ ...base, ...e, notify: e.notify === undefined ? LOUD.has(e.kind) : e.notify });
    // Things the tablet noticed while the server could not be reached (local mode), with the time they happened.
    if (d.kind === "hub" && Array.isArray(body.localEvents)) {
        const nowMs = now.getTime();
        for (const le of body.localEvents.slice(0, 100)) {
            if (!le || !["arrived", "left", "camera", "local"].includes(le.kind) || typeof le.text !== "string" || !le.text.trim()) continue;
            const at = Number(le.at);
            if (!Number.isFinite(at) || at > nowMs + 60000 || at < nowMs - 3 * 24 * 3600 * 1000) continue;
            await record({ ...base, kind: le.kind === "local" ? "local" : le.kind, text: `(offline mode) ${le.text.trim().slice(0, 250)}`, at: new Date(at) });
        }
    }
    // The TV's USB drive lists what it holds; complete copies of Drive movies can be cleared from Drive.
    if (d.kind === "tv") void movies.settle(d.owner, status.movies);

    if (d.kind === "phone" && status.location) void automation.settingsOf(d.owner).then(async (st) => { const all = await HomeDevice.find({ owner: d.owner }).lean(); if ((st.places || []).length) await automation.geoTick(d.owner, Date.now(), st, all); if (status.agent !== "stashr-where") await automation.etaTick(d.owner, Date.now(), st, all); }).catch(() => {});

    // Results of earlier commands.
    for (const a of (Array.isArray(body.acks) ? body.acks.slice(0, 20) : [])) {
        if (!a || typeof a.id !== "string") continue;
        // The Wi-Fi motion test takes two minutes: its result goes to the timeline and to Telegram when it arrives.
        const ran = (d.commands || []).find((c) => c.id === a.id && c.type === "wifi_motion_test" && (c.status === "pending" || c.status === "sent"));
        if (ran) await record({ owner: d.owner, device: d._id, deviceName: d.name, kind: "wifi_test", text: `📡 ${String(a.message || "").slice(0, 200)}`, notify: false });
        await HomeDevice.updateOne({ _id: d._id }, {
            $set: { "commands.$[c].status": a.ok ? "done" : "failed", "commands.$[c].result": String(a.message || "").slice(0, 200), "commands.$[c].doneAt": new Date() }
        }, { arrayFilters: [{ "c.id": a.id, "c.status": { $in: ["pending", "sent"] } }] });
        // A WhatsApp send: the tablet's answer decides whether the message counts as sent.
        if (d.kind === "hub") await waSender.onAck(d, a).catch((e) => console.log("[wa] ack failed:", e.message));
    }

    // New commands go out once: pending becomes sent.
    const fresh = await HomeDevice.findById(d._id).select("commands").lean();
    const out = (fresh.commands || []).filter((c) => c.status === "pending").map((c) => ({ id: c.id, type: c.type, args: c.args }));
    if (out.length) await HomeDevice.updateOne({ _id: d._id }, { $set: { "commands.$[c].status": "sent" } }, { arrayFilters: [{ "c.status": "pending" }] });
    // The WhatsApp messages among them now count as "received by the tablet" on the sender's timeline.
    if (d.kind === "hub") await waSender.onDelivered(out.filter((c) => c.type === "send_wa").map((c) => c.id)).catch(() => {});
    return { commands: out };
}

const MAX_CHILDREN = 3;

/* ───────── movies from Google Drive to the TV's USB drive ───────── */

router.get("/home/movies/settings", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const [connections, settings] = await Promise.all([movies.connectionsOf(req.rootUser._id), MovieSettings.findOne({ owner: req.rootUser._id }).lean()]);
        const ctx = settings && settings.folderId ? await movies.context(req.rootUser._id) : null;
        let waiting = null, error = null;
        if (ctx && !ctx.missing) { try { waiting = (await movies.list(ctx)).map((f) => ({ name: f.name, size: f.size })); } catch (e) { error = e.message; } }
        else if (ctx && ctx.missing) error = "The chosen Google account is not connected any more.";
        return res.json({
            connections,
            settings: { connectionId: (settings && settings.connectionId) || "", folderId: (settings && settings.folderId) || "", deleteAfterSync: Boolean(settings && settings.deleteAfterSync) },
            canDelete: Boolean(ctx && ctx.canDelete), waiting, error, lastDelete: (settings && settings.lastDelete) || null
        });
    } catch (e) { return fail(res, e, "Could not load the movie settings."); }
});

router.put("/home/movies/settings", authenticate, writeLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const folderId = movies.folderIdFrom(b.folder);
        if (!folderId) return res.status(400).json({ error: "Paste the Drive folder's link." });
        const connections = await movies.connectionsOf(req.rootUser._id);
        const connection = connections.find((c) => c.id === String(b.connectionId || "")) || (connections.length === 1 ? connections[0] : null);
        if (!connection) return res.status(400).json({ error: connections.length ? "Pick a Google account." : "Connect Google Drive first (the button in Movies from Google Drive)." });
        const deleteAfterSync = b.deleteAfterSync === true;
        if (deleteAfterSync && !connection.canDelete) return res.status(400).json({ error: "This Google connection can only read Drive. Reconnect it with full Drive access to delete movies after they reach the TV." });
        await MovieSettings.updateOne({ owner: req.rootUser._id }, { $set: { connectionId: connection.id, folderId, deleteAfterSync } }, { upsert: true });
        return res.json({ ok: true });
    } catch (e) { return fail(res, e, "Could not save the movie settings."); }
});

// The TV gets what it needs to download movies from Google itself (the server no longer carries the movie bytes).
router.get("/home/movies/grant", agentLimiter, async (req, res, next) => agentAuth(req, res, next), async (req, res) => {
    try {
        const ctx = await movies.context(req.device.owner);
        if (!ctx || ctx.missing) return res.status(404).json({ error: "no movie folder" });
        return res.json(movies.grant(ctx));
    } catch (e) { return fail(res, e, "Could not prepare the movie download."); }
});

/** The TV that reports through the tablet becomes a device of its own the first time it is seen. */
async function childOf(hub, key, name) {
    if (!/^[a-z0-9]{1,20}$/.test(key)) return null;
    let child = await HomeDevice.findOne({ owner: hub.owner, parent: hub._id, childKey: key });
    if (child) return child;
    if (await HomeDevice.countDocuments({ parent: hub._id }) >= MAX_CHILDREN) return null;
    return HomeDevice.create({ owner: hub.owner, parent: hub._id, childKey: key, kind: "tv", name: String(name || "TV").trim().slice(0, 60) || "TV" });
}

router.post("/home/agent/report", agentLimiter, (req, res, next) => agentAuth(req, res, next), async (req, res) => {
    try {
        const d = req.device, body = req.body || {};
        // Paused from the website: nothing is stored and no commands go out. The device keeps asking now and then, so it notices when syncing is back on.
        if (d.syncPaused) return res.json({ ok: true, paused: true, commands: [], childCommands: {}, serverTime: new Date().toISOString() });
        const own = await ingest(d, body);
        if (own.error) return res.status(400).json({ error: own.error });

        // The tablet carries the TV's reports: each is stored as a device of its own, and the TV's commands come back here.
        const childCommands = {};
        if (d.kind === "hub" && Array.isArray(body.children)) {
            for (const c of body.children.slice(0, MAX_CHILDREN)) {
                if (!c || typeof c !== "object") continue;
                const key = String(c.key || ""), status = c.status && typeof c.status === "object" ? c.status : null;
                const child = await childOf(d, key, c.name || (status && status.deviceName));
                if (!child) continue;
                const ago = Math.min(Math.max(Number(c.seenAgoMs) || 0, 0), 10 * 60 * 1000);
                const r = await ingest(child, { status, leaving: c.leaving === true, acks: c.acks }, new Date(Date.now() - ago));
                childCommands[key] = r.commands || [];
            }
        }
        const out = { ok: true, commands: own.commands, childCommands, serverTime: new Date().toISOString() };
        // The key for the tablet's local mode (tablet and TV talk to each other on the home Wi-Fi when the server is unreachable).
        if (d.kind === "hub" || d.kind === "tv") out.local = { key: await automation.localKeyOf(d.owner), port: 8765 };
        return res.json(out);
    } catch (e) { return fail(res, e, "Could not save the report."); }
});

router.agentAuth = agentAuth;
router.publicDevice = publicDevice;
router.linkPhones = linkPhones;
router.ingest = ingest;
router.runSentence = runSentence;
router.hubsFor = hubsFor;
module.exports = router;
