/**
 * The database side of the room model: saving labelled samples, finding the room of a live scan, remembering the smoothing state, and
 * writing a "Papa: Hall -> Bedroom" line on the timeline when the room really changes. See utils/roomModel.js for how the guess is made.
 *
 * Auto-improve (docs/ROOM_MODEL_AUTO_IMPROVE_PLAN.md): a live scan the model is very sure about becomes an "auto" sample (`update`),
 * a correction removes wrong auto samples near it (`purgeWrong`), and once an hour `maintain` tunes each phone's kernel width, checks that
 * the auto samples help (and pauses them for a week if they do not), and says when a phone's model got weaker.
 */
const HomeDevice = require("../models/homeDevice");
const HomeSettings = require("../models/homeSettings");
const HomeRoomSample = require("../models/homeRoomSample");
const model = require("./roomModel");

const MAX_PER_ROOM = 80;        // samples a person labelled, kept per room and phone; the oldest go first
const MAX_AUTO_PER_ROOM = model.AUTO.perRoom;   // auto samples have their own room, so they can never push out a person's training
const MAX_ROOMS = 12;
const MAX_IDS = 40;             // strongest networks / devices kept from one scan
const FRESH_MS = 20 * 60 * 1000;
const PAUSE_MS = 7 * 86400000;  // auto-improve rests this long after it was caught making things worse
const ALERT_DROP = 15;          // accuracy points below the best seen before "train again" is said
const CV_TTL = 5 * 60 * 1000;

const cvCache = new Map();      // phone id -> { at, width, report }: the honest accuracy compares every sample with the rest, so it is kept a while (and dropped on any change)
const cache = new Map();        // phone id -> { at, samples, gone }: the model is rebuilt from the database at most every 60 s, and at once after a change
const forget = (phone) => { cache.delete(String(phone)); cvCache.delete(String(phone)); };

/** The strongest MAX_IDS entries, ids hashed for this household: { wifi: [{ b, r }], ble: [{ b, r }] }. */
function hashScan(owner, scan) {
    const cut = (list) => (Array.isArray(list) ? list : [])
        .filter((x) => x && typeof x.b === "string" && x.b && Number(x.r) <= -1 && Number(x.r) >= -127)
        .sort((a, b) => Number(b.r) - Number(a.r)).slice(0, MAX_IDS)
        .map((x) => ({ b: model.hashId(owner, x.b), r: Math.round(Number(x.r)) }));
    return { wifi: cut(scan && scan.wifi), ble: cut(scan && scan.ble) };
}

const clean = (name) => String(name || "").replace(/[\u0000-\u001f<>&"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);

/** The account's home settings record, created if it does not exist yet (an update on a missing record would silently save nothing). */
const ensureSettings = (owner) => HomeSettings.updateOne({ owner }, { $setOnInsert: { owner } }, { upsert: true });

async function roomsOf(owner) {
    const s = await HomeSettings.findOne({ owner }).select("map.rooms").lean();
    return Array.isArray(s && s.map && s.map.rooms) ? s.map.rooms : [];
}

/** The samples of one phone and the networks that are gone (roomModel.goneKeys), cached for a minute. */
async function modelOf(owner, phone, now = Date.now()) {
    const hit = cache.get(String(phone));
    if (hit && now - hit.at < 60000) return hit;
    const rows = await HomeRoomSample.find({ owner, phone }).sort({ at: -1 }).limit(2000).lean();
    const samples = rows.map((r) => ({ id: String(r._id), room: r.room, vec: model.vectorOf({ wifi: r.wifi, ble: r.ble }), at: new Date(r.at).getTime(), session: r.session, src: r.src || "train" }));
    const out = { at: now, samples, gone: model.goneKeys(samples, now) };
    cache.set(String(phone), out);
    return out;
}
const samplesOf = async (owner, phone, now = Date.now()) => (await modelOf(owner, phone, now)).samples;

/** The kernel width tuned for this phone (roomModel.tune, hourly), or the default. */
const widthOf = (device) => { const w = Number(device && device.roomTune && device.roomTune.width); return model.WIDTHS.includes(w) ? w : model.MIN_WIDTH; };

/** Keeps the newest `cap` samples of one room and kind (a person's, or auto). */
async function trim(owner, phone, room, auto) {
    const cap = auto ? MAX_AUTO_PER_ROOM : MAX_PER_ROOM;
    const old = await HomeRoomSample.find({ owner, phone, room, src: auto ? "auto" : { $ne: "auto" } }).sort({ at: -1 }).skip(cap).select("_id").lean();
    if (old.length) await HomeRoomSample.deleteMany({ _id: { $in: old.map((k) => k._id) } });
}

/** Saves the scans of one tap under a room (src: train, fix or confirm). Returns how many samples a person gave that room. */
async function store(owner, phone, room, scans, { session = "", src = "train", now = Date.now() } = {}) {
    const rooms = await roomsOf(owner);
    if (!rooms.includes(room)) throw Object.assign(new Error("That room is not in the list."), { status: 400 });
    const docs = (Array.isArray(scans) ? scans : []).slice(0, 40).map((sc) => ({ owner, phone, room, session: String(session).slice(0, 40), src, at: new Date(now), ...hashScan(owner, sc) }))
        .filter((d) => d.wifi.length + d.ble.length >= 2);
    if (!docs.length) throw Object.assign(new Error("The scan heard almost nothing: switch Wi-Fi and Bluetooth on and try again."), { status: 400 });
    await HomeRoomSample.insertMany(docs);
    await trim(owner, phone, room, false);
    forget(phone);
    return { added: docs.length, count: await HomeRoomSample.countDocuments({ owner, phone, room, src: { $ne: "auto" } }), vecs: docs.map((d) => model.vectorOf(d)) };
}

/** Training per room: the samples a person gave (auto samples are counted apart, see autoCounts). */
async function counts(owner, phone, auto = false) {
    const rows = await HomeRoomSample.aggregate([{ $match: { owner, phone, src: auto ? "auto" : { $ne: "auto" } } }, { $group: { _id: "$room", n: { $sum: 1 } } }]);
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}
const autoCounts = (owner, phone) => counts(owner, phone, true);

/** Auto-improve for one phone, as the pages show it. */
function autoOf(device, now = Date.now()) {
    const a = (device && device.roomAuto) || {};
    const paused = Number(a.pausedUntil) > now;
    return { on: a.off !== true, paused, pausedUntil: paused ? Number(a.pausedUntil) : null, why: paused ? String(a.pauseWhy || "") : "", added: Number(a.added) || 0, lastAt: Number(a.lastAt) || null, lastRoom: String(a.lastRoom || ""), guard: a.guard || null };
}

/** A live scan the model is very sure about, kept as an auto sample. */
async function storeAuto(device, room, hashed, now) {
    await HomeRoomSample.create({ owner: device.owner, phone: device._id, room, session: "auto" + now, src: "auto", at: new Date(now), wifi: hashed.wifi, ble: hashed.ble });
    await trim(device.owner, device._id, room, true);
    await HomeDevice.updateOne({ _id: device._id }, { $inc: { "roomAuto.added": 1 }, $set: { "roomAuto.lastAt": now, "roomAuto.lastRoom": room } });
    forget(device._id);
}

/** Two rooms someone just walked between: counted, so the map's auto-arrange puts them next to each other. */
async function noteWalk(owner, from, to, now) {
    if (!from || !to || from === to) return;
    const { HomeApEdge } = require("../models/homeApSeen");
    const [a, b] = ["r:" + from, "r:" + to].sort();
    await HomeApEdge.updateOne({ owner, a, b }, { $inc: { count: 1 }, $set: { lastSeen: new Date(now) } }, { upsert: true });
}

/** A live scan from a phone with room location on: guess, smooth, remember in status.room, learn from it if sure, note a real change. Never throws. */
async function update(device, scan, now = Date.now()) {
    try {
        if (!device.roomOn || !scan) return null;
        const { samples, gone } = await modelOf(device.owner, device._id, now);
        const hashed = hashScan(device.owner, scan);
        if (hashed.wifi.length + hashed.ble.length < 2) return null;
        const vec = model.vectorOf(hashed);
        const guess = model.classify(samples, vec, now, { width: widthOf(device), gone });
        const prev = (device.status && device.status.room) || {};
        const next = model.smooth({ room: prev.name || null, pending: prev.pending || null, count: prev.count || 0 }, guess.room);
        const auto = autoOf(device, now);
        const gate = model.autoGate({ on: auto.on && scan.auto !== false, pausedUntil: auto.pausedUntil, ageSec: typeof scan.ageSec === "number" ? scan.ageSec : NaN, guess,
            prevRoom: prev.name || null, prevAt: prev.at, nextRoom: next.state.room, samples, vec, now, gone });
        const room = {
            name: next.state.room, pending: next.state.pending, count: next.state.count, confidence: guess.confidence, margin: guess.margin, sure: Boolean(guess.room), ranking: guess.ranking, why: guess.why, at: now,
            nearest: guess.nearest, heard: { wifi: hashed.wifi.length, ble: hashed.ble.length }, samples: samples.length, learned: gate.ok, learnWhy: gate.ok ? "" : gate.why
        };
        await HomeDevice.updateOne({ _id: device._id }, { $set: { "status.room": room } });
        if (gate.ok) await storeAuto(device, guess.room, hashed, now);
        if (next.changed && prev.name && next.state.room) {
            const { record } = require("./homeEvents");
            await record({ owner: device.owner, device: device._id, deviceName: device.name, person: device.person || device.name, kind: "room_change", text: `${device.person || device.name}: ${prev.name} → ${next.state.room}` });
            await noteWalk(device.owner, prev.name, next.state.room, now);
        }
        return room;
    } catch (e) { return null; }
}

/** After "Galat hai, main X mein hoon": the auto samples of the last day that said another room near this spot were wrong. Returns how many went. */
async function purgeWrong(owner, phone, room, vecs, now = Date.now()) {
    forget(phone);
    const { samples, gone } = await modelOf(owner, phone, now);
    const ids = model.wrongAutos(samples, vecs, room, now, gone);
    if (!ids.length) return 0;
    const r = await HomeRoomSample.deleteMany({ _id: { $in: ids }, owner, phone, src: "auto" });
    forget(phone);
    return r.deletedCount;
}

/** The honest accuracy of one phone's training (see roomModel.crossValidate), with a plain verdict. Cached a few minutes (dropped on any change). */
async function reportOf(owner, phone, now = Date.now(), width = model.MIN_WIDTH) {
    const hit = cvCache.get(String(phone));
    if (hit && hit.width === width && now - hit.at < CV_TTL) return hit.report;
    const { samples, gone } = await modelOf(owner, phone, now);
    const cv = model.crossValidate(samples, now, { width, gone });
    const rooms = [...new Set(samples.filter((s) => s.src !== "auto").map((s) => s.room))];
    let verdict = "Train at least two rooms (a few spots each) to see how well it works.";
    if (rooms.length >= 2 && cv.tested) verdict = cv.accuracy >= 85 ? "Good: rooms are told apart well." : cv.accuracy >= 65 ? "Fair: add more spots in the rooms that get mixed up." : "Weak: rooms sound too alike here. Add more spots, or put a Bluetooth beacon in each room.";
    const report = { ...cv, rooms, verdict, width, gone: gone.size };
    cvCache.set(String(phone), { at: now, width, report });
    return report;
}

/** How often the person said the room was right, from their own "Sahi hai" / "Galat hai" taps. null until there is at least one. */
function fieldOf(device) {
    const s = (device && device.roomStats) || {};
    const confirmed = Number(s.confirmed) || 0, wrong = Number(s.wrong) || 0, total = confirmed + wrong;
    return { confirmed, wrong, total, accuracy: total ? Math.round((100 * confirmed) / total) : null };
}

const tuneOf = (device) => { const t = (device && device.roomTune) || {}; return { width: widthOf(device), accuracy: Number.isFinite(t.accuracy) ? t.accuracy : null, at: t.at || null, tried: Array.isArray(t.tried) ? t.tried : [] }; };

/**
 * EVERYTHING the model knows right now, in one shape, for the website and the tablet (so both always show the same numbers):
 * is it running, and for each phone: the room and how sure, every room's share, the distance to the nearest sample, how many networks it
 * heard, how many samples it has, the honest accuracy (hide-and-guess), the real-life accuracy (the person's own taps), and auto-improve.
 */
async function liveReport(owner, now = Date.now()) {
    const settings = await HomeSettings.findOne({ owner }).select("map.rooms map.model").lean();
    const map = (settings && settings.map) || {};
    const rooms = Array.isArray(map.rooms) ? map.rooms : [];
    const phones = (await HomeDevice.find({ owner, kind: "phone" }).lean()).filter((p) => (p.status || {}).agent === "stashr-where");
    const out = [];
    for (const p of phones) {
        const c = await counts(owner, p._id), ac = await autoCounts(owner, p._id);
        const trainedRooms = Object.keys(c).filter((r) => c[r] > 0 && rooms.includes(r));
        const r = (p.status || {}).room || null;
        const rep = await reportOf(owner, p._id, now, widthOf(p));
        out.push({
            id: String(p._id), person: p.person || p.name, on: Boolean(p.roomOn), trained: trainedRooms.length >= 2, trainedRooms: trainedRooms.length, counts: c, total: Object.values(c).reduce((a, b) => a + b, 0),
            current: r && r.name ? { name: r.name, confidence: r.confidence || 0, margin: r.margin ?? null, sure: r.sure !== false, ranking: r.ranking || [], nearest: r.nearest ?? null, heard: r.heard || { wifi: 0, ble: 0 }, samples: r.samples || 0, why: r.why || "", learned: Boolean(r.learned), learnWhy: r.learnWhy || "", at: r.at, ageSec: Math.max(0, Math.round((now - Number(r.at)) / 1000)), fresh: now - Number(r.at) <= FRESH_MS } : null,
            cv: { accuracy: rep.accuracy, tested: rep.tested, unsure: rep.unsure, perRoom: rep.perRoom, thin: rep.thin, verdict: rep.verdict }, field: fieldOf(p), lastSeen: p.lastSeen || null,
            auto: { ...autoOf(p, now), counts: ac, total: Object.values(ac).reduce((a, b) => a + b, 0) }, tune: { ...tuneOf(p), gone: rep.gone || 0 }
        });
    }
    const judged = out.filter((p) => p.cv.tested), fielded = out.filter((p) => p.field.total);
    return {
        running: Boolean(map.model && map.model.running), startedAt: (map.model && map.model.startedAt) || null, rooms, at: now, phones: out,
        summary: {
            phones: out.length, on: out.filter((p) => p.on).length, trained: out.filter((p) => p.trained).length, cvAccuracy: judged.length ? Math.round(judged.reduce((s, p) => s + p.cv.accuracy, 0) / judged.length) : null,
            fieldAccuracy: fielded.length ? Math.round(fielded.reduce((s, p) => s + p.field.accuracy * p.field.total, 0) / fielded.reduce((s, p) => s + p.field.total, 0)) : null,
            autoOn: out.filter((p) => p.auto.on && !p.auto.paused).length, autoSamples: out.reduce((s, p) => s + p.auto.total, 0)
        }
    };
}

/**
 * Start or stop the model for the whole home. Starting turns room location on for every phone that has trained at least two rooms
 * (the others are listed with why not) and asks them to report at once; stopping turns it off everywhere.
 */
async function setModel(owner, on, now = Date.now()) {
    const phones = (await HomeDevice.find({ owner, kind: "phone" }).lean()).filter((p) => (p.status || {}).agent === "stashr-where");
    const rooms = await roomsOf(owner);
    const started = [], blocked = [];
    for (const p of phones) {
        const c = await counts(owner, p._id);
        const trained = Object.keys(c).filter((r) => c[r] > 0 && rooms.includes(r)).length >= 2;
        if (on && !trained) { blocked.push({ person: p.person || p.name, why: "Is phone par kam se kam 2 kamre train karo (Stashr Location → Room Lab)." }); await HomeDevice.updateOne({ _id: p._id }, { $set: { roomOn: false } }); continue; }
        await HomeDevice.updateOne({ _id: p._id }, { $set: { roomOn: on } });
        if (on) started.push(p.person || p.name);
        forget(p._id);
    }
    await HomeSettings.updateOne({ owner }, { $set: { "map.model": { running: on && started.length > 0, startedAt: on && started.length ? now : null } } }, { upsert: false });
    if (on && started.length) void require("./phonePush").nudgeOwner(owner, now).catch(() => {});      // ask them to report now, so the first room shows at once
    return { running: on && started.length > 0, started, blocked };
}

/** Auto-improve on or off for one phone (the website's switch and the phone's own). */
async function setAuto(owner, phone, on) {
    const r = await HomeDevice.updateOne({ _id: phone, owner, kind: "phone" }, on ? { $unset: { "roomAuto.off": 1 } } : { $set: { "roomAuto.off": true } });
    forget(phone);
    return r.matchedCount > 0;
}

/**
 * Removes rooms everywhere they live: the room list, the map layout, every phone's training for them, a phone's "current room" that is one
 * of them, and the walks between them. `left` is the room list that stays. Returns how many samples went.
 */
async function dropRooms(owner, gone, left) {
    const { HomeApEdge } = require("../models/homeApSeen");
    await ensureSettings(owner);
    const cur = (await HomeSettings.findOne({ owner }).select("map.layout").lean()) || {};
    const keepLayout = Object.fromEntries(Object.entries((cur.map && cur.map.layout) || {}).filter(([n]) => left.includes(n)));
    await HomeSettings.updateOne({ owner }, { $set: { "map.rooms": left, "map.layout": keepLayout } });
    if (!gone.length) return 0;
    const r = await HomeRoomSample.deleteMany({ owner, room: { $in: gone } });
    await HomeDevice.updateMany({ owner, kind: "phone", "status.room.name": { $in: gone } }, { $unset: { "status.room": 1 } });
    const ids = gone.map((g) => "r:" + g);
    await HomeApEdge.deleteMany({ owner, $or: [{ a: { $in: ids } }, { b: { $in: ids } }] });
    (await HomeDevice.find({ owner, kind: "phone" }).select("_id").lean()).forEach((p) => forget(p._id));
    return r.deletedCount;
}

/** Deletes one room (from the website's 3D map or Room Lab, or from a phone). The name matches whatever the capital letters. */
async function removeRoom(owner, name, { by = "" } = {}) {
    const rooms = await roomsOf(owner);
    const want = clean(name);
    const room = rooms.find((r) => r === want) || rooms.find((r) => r.toLowerCase() === want.toLowerCase());
    if (!room) throw Object.assign(new Error("That room is not in the list."), { status: 404 });
    const left = rooms.filter((r) => r !== room);
    const deleted = await dropRooms(owner, [room], left);
    const { record } = require("./homeEvents");
    await record({ owner, kind: "room_deleted", text: `🗑️ Kamra hataya: ${room}${by ? ` (${by})` : ""}. ${deleted} training scan mite.` });
    return { rooms: left, room, deleted };
}

/**
 * Once an hour, for every phone with training: tune the kernel width (roomModel.tune), check that the auto samples help (roomModel.guard;
 * if they hurt, auto-improve rests for a week and they are removed), and say once a week at most when the model got clearly weaker.
 */
async function maintain(owner, now = Date.now()) {
    const { record } = require("./homeEvents");
    const phones = (await HomeDevice.find({ owner, kind: "phone" }).lean()).filter((p) => (p.status || {}).agent === "stashr-where");
    const done = [];
    for (const p of phones) {
        forget(p._id);
        const { samples, gone } = await modelOf(owner, p._id, now);
        if (new Set(samples.filter((s) => s.src !== "auto").map((s) => s.room)).size < 2) continue;
        const who = p.person || p.name;
        const matrix = model.gradeMatrix(samples, gone);
        const t = model.tune(samples, now, { matrix });
        const old = p.roomTune || {};
        let best = Number(old.best) || 0, alertAt = Number(old.alertAt) || 0;
        if (t.tested >= 20) {
            if (best && t.accuracy <= best - ALERT_DROP && now - alertAt > PAUSE_MS) {
                await record({ owner, device: p._id, deviceName: p.name, person: who, kind: "room_model", text: `📉 ${who} ka room model kamzor hua (${best}% → ${t.accuracy}%): Stashr Location → Room Lab mein kamron ko dobara train karo.` });
                alertAt = now; best = t.accuracy;
            } else best = Math.max(best, t.accuracy);
        }
        const set = { roomTune: { width: t.width, accuracy: t.accuracy, unsure: t.unsure, wrong: t.wrong, tested: t.tested, tried: t.tried, at: now, best, alertAt } };
        const autos = samples.filter((s) => s.src === "auto").length;
        let paused = false;
        if (autos >= 10) {
            const g = model.guard(samples, now, { matrix, width: t.width });
            set["roomAuto.guard"] = { at: now, with: g.with, without: g.without, tested: g.tested };
            if (g.hurts) {
                paused = true;
                set["roomAuto.pausedUntil"] = now + PAUSE_MS;
                set["roomAuto.pauseWhy"] = `apne aap seekhe scan se accuracy giri (${g.without}% → ${g.with}%)`;
                await HomeRoomSample.deleteMany({ owner, phone: p._id, src: "auto" });
                await record({ owner, device: p._id, deviceName: p.name, person: who, kind: "room_model", text: `⏸️ ${who}: apne aap seekhna 7 din ke liye ruka, kyunki usse accuracy giri (${g.without}% → ${g.with}%). Wo scan hata diye.` });
            }
        }
        await HomeDevice.updateOne({ _id: p._id }, { $set: set });
        forget(p._id);
        done.push({ person: who, width: t.width, accuracy: t.accuracy, autos, paused });
    }
    return done;
}

/** The room of a phone as the page and Telegram say it: only when it is recent. */
function currentOf(device, now = Date.now()) {
    const r = device.status && device.status.room;
    if (!r || !r.name || now - Number(r.at) > FRESH_MS) return null;
    return r;
}

module.exports = { hashScan, clean, ensureSettings, roomsOf, modelOf, samplesOf, store, counts, autoCounts, autoOf, update, purgeWrong, currentOf, forget, reportOf, fieldOf, liveReport, setModel, setAuto, dropRooms, removeRoom, maintain, widthOf, MAX_ROOMS, MAX_PER_ROOM, MAX_AUTO_PER_ROOM };
