/*
 * Room location: the website manages the rooms and sees how well each phone is trained; the phone (Stashr Location → Room Lab) adds
 * rooms, takes training scans ("main yahan hoon") and corrects a wrong answer. The guess itself is made in utils/roomModel.js.
 *
 *   GET  /home/rooms                     rooms, each phone: on/off, samples per room, current room, honest accuracy, auto-improve
 *   PUT  /home/rooms                     { rooms: [names] }          PUT /home/rooms/phone/:id   { on?, auto? }
 *   DELETE /home/room/:name              delete one room everywhere (its training on every phone, its place on the map)
 *   DELETE /home/rooms/samples           { phone?, room? } erase training
 *   POST /home/room/maintain             tune and check the model now (it also runs by itself once an hour)
 *   GET  /home/agent/room/config         for the phone               POST /home/agent/room/add     { name }    POST /home/agent/room/on { on }
 *   POST /home/agent/room/sample         { room, scans, session }    POST /home/agent/room/fix     { room, scans } (a wrong answer)
 *   POST /home/agent/room/confirm        { room?, scans? } "Sahi hai" POST /home/agent/room/delete  { name }    POST /home/agent/room/auto { on }
 *   GET  /home/agent/room/report         the accuracy, in words
 */
const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const HomeDevice = require("../models/homeDevice");
const HomeSettings = require("../models/homeSettings");
const HomeRoomSample = require("../models/homeRoomSample");
const home = require("../utils/home");
const model = require("../utils/roomModel");
const live = require("../utils/roomLive");
const automation = require("../utils/homeAutomation");
const homeRouter = require("./home");

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, message: "Too many changes. Slow down." });
const agentLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many requests." });
const fail = (res, error, fallback) => res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : fallback });
const agent = (req, res, next) => homeRouter.agentAuth(req, res, next);

const reportOf = live.reportOf;

router.get("/home/rooms", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const owner = req.rootUser._id, now = Date.now();
        const rooms = await live.roomsOf(owner);
        const phones = (await HomeDevice.find({ owner, kind: "phone" }).lean()).filter((p) => (p.status || {}).agent === "stashr-where");
        const out = [];
        for (const p of phones) {
            out.push({ id: String(p._id), name: p.name, person: p.person || p.name, on: Boolean(p.roomOn), counts: await live.counts(owner, p._id), autoCounts: await live.autoCounts(owner, p._id),
                current: live.currentOf(p, now), report: await reportOf(owner, p._id, now, live.widthOf(p)), auto: live.autoOf(p, now) });
        }
        return res.json({ rooms, phones: out, max: live.MAX_ROOMS });
    } catch (e) { return fail(res, e, "Could not load the rooms."); }
});

// Everything the model knows right now (the same numbers on the website and the tablet), and the Start / Stop button.
router.get("/home/room/live", authenticate, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json(await live.liveReport(req.rootUser._id)); }
    catch (e) { return fail(res, e, "Could not load the model."); }
});
router.post("/home/room/model", authenticate, writeLimiter, async (req, res) => {
    try { const r = await live.setModel(req.rootUser._id, req.body && req.body.on === true); return res.json({ ...r, live: await live.liveReport(req.rootUser._id) }); }
    catch (e) { return fail(res, e, "Could not change the model."); }
});
// "Abhi sudhaaro": tune every phone's model and check its auto samples now, instead of waiting for the hourly run.
router.post("/home/room/maintain", authenticate, writeLimiter, async (req, res) => {
    try { const done = await live.maintain(req.rootUser._id); return res.json({ done, live: await live.liveReport(req.rootUser._id) }); }
    catch (e) { return fail(res, e, "Could not tune the model."); }
});
// One room deleted everywhere: from the 3D map's room panel or Room Lab.
router.delete("/home/room/:name", authenticate, writeLimiter, async (req, res) => {
    try { return res.json(await live.removeRoom(req.rootUser._id, req.params.name, { by: "website" })); }
    catch (e) { return fail(res, e, "Could not delete the room."); }
});

router.put("/home/rooms", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id;
        const names = [...new Set((Array.isArray(req.body && req.body.rooms) ? req.body.rooms : []).map(live.clean).filter((n) => n.length >= 2))];
        if (names.length > live.MAX_ROOMS) return res.status(400).json({ error: `Up to ${live.MAX_ROOMS} rooms.` });
        const old = await live.roomsOf(owner);
        await live.dropRooms(owner, old.filter((r) => !names.includes(r)), names);
        return res.json({ rooms: names });
    } catch (e) { return fail(res, e, "Could not save the rooms."); }
});

// One phone's switches: room location (`on`) and auto-improve (`auto`). Only what is sent changes.
router.put("/home/rooms/phone/:id", authenticate, writeLimiter, async (req, res) => {
    try {
        const b = req.body || {}, q = { _id: req.params.id, owner: req.rootUser._id, kind: "phone" };
        if (typeof b.on !== "boolean" && typeof b.auto !== "boolean") return res.status(400).json({ error: "Send on or auto (true or false)." });
        if (!(await HomeDevice.exists(q))) return res.status(404).json({ error: "That phone is not linked." });
        if (typeof b.on === "boolean") await HomeDevice.updateOne(q, { $set: { roomOn: b.on } });
        if (typeof b.auto === "boolean") await live.setAuto(req.rootUser._id, req.params.id, b.auto);
        const d = await HomeDevice.findOne(q).lean();
        return res.json({ on: Boolean(d.roomOn), auto: live.autoOf(d).on });
    } catch (e) { return fail(res, e, "Could not save."); }
});

router.delete("/home/rooms/samples", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, b = req.body || {}, q = { owner };
        if (b.phone) q.phone = b.phone;
        if (b.room) q.room = String(b.room);
        const r = await HomeRoomSample.deleteMany(q);
        (await HomeDevice.find({ owner, kind: "phone" }).select("_id").lean()).forEach((p) => live.forget(p._id));
        return res.json({ deleted: r.deletedCount });
    } catch (e) { return fail(res, e, "Could not delete."); }
});

/* ───────── the phone ───────── */

router.get("/home/agent/room/config", agentLimiter, agent, async (req, res) => {
    try {
        const d = req.device;
        if (d.kind !== "phone") return res.status(403).json({ error: "Only a family phone can use this." });
        return res.json({ rooms: await live.roomsOf(d.owner), on: Boolean(d.roomOn), counts: await live.counts(d.owner, d._id), current: live.currentOf(d), field: live.fieldOf(d),
            auto: { ...live.autoOf(d), counts: await live.autoCounts(d.owner, d._id) } });
    } catch (e) { return fail(res, e, "Could not load."); }
});

router.post("/home/agent/room/add", agentLimiter, agent, async (req, res) => {
    try {
        const d = req.device, name = live.clean(req.body && req.body.name);
        if (d.kind !== "phone") return res.status(403).json({ error: "Only a family phone can use this." });
        if (name.length < 2) return res.status(400).json({ error: "Give the room a name of at least 2 letters." });
        const rooms = await live.roomsOf(d.owner);
        if (!rooms.includes(name)) {
            if (rooms.length >= live.MAX_ROOMS) return res.status(400).json({ error: `Up to ${live.MAX_ROOMS} rooms.` });
            await live.ensureSettings(d.owner);
            await HomeSettings.updateOne({ owner: d.owner }, { $set: { "map.rooms": [...rooms, name] } });
        }
        return res.json({ rooms: await live.roomsOf(d.owner) });
    } catch (e) { return fail(res, e, "Could not add the room."); }
});

// The tablet (or a phone) shows the same live numbers and can start or stop the model.
router.get("/home/agent/room/live", agentLimiter, agent, async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.json(await live.liveReport(req.device.owner)); }
    catch (e) { return fail(res, e, "Could not load the model."); }
});
router.post("/home/agent/room/model", agentLimiter, agent, async (req, res) => {
    try { const r = await live.setModel(req.device.owner, req.body && req.body.on === true); return res.json({ ...r, live: await live.liveReport(req.device.owner) }); }
    catch (e) { return fail(res, e, "Could not change the model."); }
});
// "Sahi hai": the person says the room shown is right (counted for the real-life accuracy). Stashr Location 1.10+ also sends a short scan
// and the room: that becomes a "confirm" sample, a label a person gave at exactly the spot where they really are.
router.post("/home/agent/room/confirm", agentLimiter, agent, async (req, res) => {
    try {
        const d = req.device, b = req.body || {};
        if (d.kind !== "phone") return res.status(403).json({ error: "Only a family phone can use this." });
        await HomeDevice.updateOne({ _id: d._id }, { $inc: { "roomStats.confirmed": 1 } });
        let added = 0;
        if (Array.isArray(b.scans) && b.scans.length && typeof b.room === "string" && b.room) {
            try { added = (await live.store(d.owner, d._id, b.room, b.scans, { session: "confirm" + Date.now(), src: "confirm" })).added; } catch (e) { added = 0; }      // the tap still counts
        }
        return res.json({ field: live.fieldOf(await HomeDevice.findById(d._id).lean()), added });
    } catch (e) { return fail(res, e, "Could not save."); }
});

// The phone's own auto-improve switch (the website has the same switch for each phone).
router.post("/home/agent/room/auto", agentLimiter, agent, async (req, res) => {
    try {
        const d = req.device;
        if (d.kind !== "phone") return res.status(403).json({ error: "Only a family phone can use this." });
        await live.setAuto(d.owner, d._id, req.body && req.body.on === true);
        return res.json({ auto: live.autoOf(await HomeDevice.findById(d._id).lean()) });
    } catch (e) { return fail(res, e, "Could not save."); }
});

// "Kamra hatao" in the phone's Room Lab: the same as the website's delete (every phone's training for that room goes).
router.post("/home/agent/room/delete", agentLimiter, agent, async (req, res) => {
    try {
        const d = req.device;
        if (d.kind !== "phone") return res.status(403).json({ error: "Only a family phone can use this." });
        const r = await live.removeRoom(d.owner, req.body && req.body.name, { by: d.person || d.name });
        return res.json({ ...r, counts: await live.counts(d.owner, d._id) });
    } catch (e) { return fail(res, e, "Could not delete the room."); }
});

// The phone's own "Room location on / off" switch (the website has the same switch for each phone).
router.post("/home/agent/room/on", agentLimiter, agent, async (req, res) => {
    try {
        const d = req.device;
        if (d.kind !== "phone") return res.status(403).json({ error: "Only a family phone can use this." });
        await HomeDevice.updateOne({ _id: d._id }, { $set: { roomOn: req.body && req.body.on === true } });
        return res.json({ on: req.body && req.body.on === true });
    } catch (e) { return fail(res, e, "Could not save."); }
});

async function takeSamples(req, res, src) {
    try {
        const d = req.device, b = req.body || {};
        if (d.kind !== "phone") return res.status(403).json({ error: "Only a family phone can use this." });
        const { vecs, ...got } = await live.store(d.owner, d._id, String(b.room || ""), b.scans, { session: String(b.session || Date.now()), src });
        let purged = 0;
        if (src === "fix") {
            const said = live.currentOf(d);
            await HomeDevice.updateOne({ _id: d._id }, { $inc: { [said && said.name === String(b.room) ? "roomStats.confirmed" : "roomStats.wrong"]: 1 } });
            purged = await live.purgeWrong(d.owner, d._id, String(b.room), vecs);       // auto samples that said another room right here were wrong
        }
        // turning training on also turns the room location on for this phone
        if (!d.roomOn) await HomeDevice.updateOne({ _id: d._id }, { $set: { roomOn: true } });
        const r = await reportOf(d.owner, d._id, Date.now(), live.widthOf(d));
        return res.json({ ...got, purged, counts: await live.counts(d.owner, d._id), accuracy: r.accuracy, tested: r.tested, verdict: r.verdict, thin: r.thin });
    } catch (e) { return fail(res, e, "Could not save the scan."); }
}
router.post("/home/agent/room/sample", agentLimiter, agent, (req, res) => takeSamples(req, res, "train"));
router.post("/home/agent/room/fix", agentLimiter, agent, (req, res) => takeSamples(req, res, "fix"));

router.get("/home/agent/room/report", agentLimiter, agent, async (req, res) => {
    try {
        const d = req.device;
        if (d.kind !== "phone") return res.status(403).json({ error: "Only a family phone can use this." });
        const r = await reportOf(d.owner, d._id, Date.now(), live.widthOf(d));
        return res.json({ accuracy: r.accuracy, tested: r.tested, unsure: r.unsure, perRoom: r.perRoom, confusion: r.confusion, thin: r.thin, verdict: r.verdict, auto: live.autoOf(d), width: r.width });
    } catch (e) { return fail(res, e, "Could not build the report."); }
});

module.exports = router;
