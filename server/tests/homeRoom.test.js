const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret"; process.env.CRYPTO_SECRET_KEY = "test-crypto-secret"; process.env.RATE_LIMIT_MAX = "1000"; process.env.ALLOW_SIGNUP = "true"; delete process.env.YOUTUBE_API_KEY; process.env.HOME_ROUTING = "off";
const app = require("../app");
const User = require("../models/schema");
const HomeDevice = require("../models/homeDevice");
const HomeSettings = require("../models/homeSettings");
const HomeEvent = require("../models/homeEvent");
const HomeRoomSample = require("../models/homeRoomSample");
const live = require("../utils/roomLive");

describe("room location through the server", () => {
    let mongo;
    beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
    afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
    const { HomeApEdge: Edge } = require("../models/homeApSeen");
    beforeEach(async () => { for (const M of [User, HomeDevice, HomeSettings, HomeEvent, HomeRoomSample, Edge]) await M.deleteMany({}); });

    const signUp = async () => {
        await request(app).post("/register").send({ name: "Ana", email: "ana@example.com", password: "master-pass", cpassword: "master-pass" });
        const r = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile" });
        return { Authorization: `Bearer ${r.body.token}` };
    };
    const bearer = (t) => ({ Authorization: `Bearer ${t}` });
    // the phone's report is answered first and the room is worked out just after: wait for it (up to 3 s) instead of guessing a delay
    const until = async (fn) => { for (let i = 0; i < 30; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
    const link = async (auth, name = "Papa") => {
        const code = (await request(app).get("/home/location-code").set(auth)).body.code;
        return (await request(app).post("/home/agent/link").send({ code, name })).body;
    };

    // what the phone hears in each room (RSSI dBm), a little different on every scan
    const FP = { Bedroom: { r1: -45, n1: -60, n2: -85 }, Kitchen: { r1: -60, n1: -80, n2: -55 } };
    let seed = 11; const jit = () => { seed = (seed * 16807) % 2147483647; return Math.round((seed / 2147483647 - 0.5) * 6); };
    const scan = (room) => ({ wifi: Object.entries(FP[room] || FP.Bedroom).map(([b, r]) => ({ b: "aa:bb:cc:00:00:" + b, r: r + jit() })), ble: [] });
    const tap = (token, room, n = 8, session = room + Math.random()) => request(app).post("/home/agent/room/sample").set(bearer(token)).send({ room, session, scans: Array.from({ length: n }, () => scan(room)) });

    test("rooms are added from the phone or the website; a scan for an unknown room, or one that heard nothing, is refused", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        expect((await request(app).post("/home/agent/room/add").set(bearer(ph.token)).send({ name: "Bedroom" })).body.rooms).toEqual(["Bedroom"]);
        await request(app).post("/home/agent/room/add").set(bearer(ph.token)).send({ name: "Bedroom" });
        expect((await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen", "x"] })).body.rooms).toEqual(["Bedroom", "Kitchen"]);   // "x" is too short
        expect((await tap(ph.token, "Garage")).status).toBe(400);
        expect((await request(app).post("/home/agent/room/sample").set(bearer(ph.token)).send({ room: "Bedroom", scans: [{ wifi: [], ble: [] }] })).status).toBe(400);
        expect((await request(app).get("/home/rooms")).status).toBe(401);
    });

    test("training two rooms gives an honest accuracy, hashes the ids, and turns room location on", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 4; i++) { await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen"); }
        const last = await tap(ph.token, "Kitchen");
        expect(last.status).toBe(200);
        expect(last.body.counts).toEqual({ Bedroom: 32, Kitchen: 40 });
        expect(last.body.accuracy >= 85).toBe(true);
        expect(last.body.verdict).toMatch(/Good/);
        const raw = await HomeRoomSample.findOne({}).lean();
        expect(raw.wifi[0].b).toMatch(/^[0-9a-f]{12}$/);
        expect(JSON.stringify(raw)).not.toMatch(/aa:bb:cc/);                 // the real network address is never stored
        expect((await HomeDevice.findOne({ kind: "phone" }).lean()).roomOn).toBe(true);
        const site = (await request(app).get("/home/rooms").set(auth)).body;
        expect(site.phones[0].on).toBe(true);
        expect(site.phones[0].report.accuracy >= 85).toBe(true);
        expect(Object.keys(site.phones[0].report.perRoom).sort()).toEqual(["Bedroom", "Kitchen"]);
    });

    test("a live scan names the room, the room changes only after two agreeing scans, and the change is written to the timeline", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 4; i++) { await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen"); }
        const now = Date.now();
        const asked = async (room, at) => { const d = await HomeDevice.findOne({ kind: "phone" }); await live.update(d.toObject(), scan(room), at); return (await HomeDevice.findOne({ kind: "phone" }).lean()).status.room; };
        expect((await asked("Bedroom", now)).name).toBe("Bedroom");          // the first answer is taken
        let r = await asked("Kitchen", now + 60000);
        expect(r.name).toBe("Bedroom"); expect(r.pending).toBe("Kitchen");   // one scan is not enough
        r = await asked("Kitchen", now + 120000);
        expect(r.name).toBe("Kitchen");
        const ev = await HomeEvent.find({ kind: "room_change" }).lean();
        expect(ev).toHaveLength(1);
        expect(ev[0].text).toMatch(/Papa: Bedroom → Kitchen/);
        expect(live.currentOf({ status: { room: r } }, now + 130000).name).toBe("Kitchen");
        expect(live.currentOf({ status: { room: r } }, now + 3600000)).toBeNull();       // an hour old: not trusted
    });

    test("the phone's normal report carries the scan: the room is found without a separate call; a phone with room location off ignores it", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 4; i++) { await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen"); }
        const report = (room) => request(app).post("/home/agent/location").set(bearer(ph.token)).send({ lat: 28.6139, lon: 77.209, acc: 20, at: Date.now(), battery: { pct: 80, charging: false }, wifi: { connected: true, ip: "192.168.1.9", bssid: "aa:bb:cc:dd:ee:01" }, scan: scan(room) });
        await report("Kitchen");
        expect((await until(async () => (await HomeDevice.findOne({ kind: "phone" }).lean()).status.room)).name).toBe("Kitchen");
        await request(app).put(`/home/rooms/phone/${ph.deviceId}`).set(auth).send({ on: false });
        await HomeDevice.updateOne({}, { $unset: { "status.room": 1 } });
        await report("Bedroom");
        await new Promise((r) => setTimeout(r, 300));
        expect((await HomeDevice.findOne({ kind: "phone" }).lean()).status.room).toBeUndefined();
    });

    test("a wrong answer corrected from the phone adds a 'fix' sample; deleting a room removes its training; samples can be erased", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen");
        const fixed = await request(app).post("/home/agent/room/fix").set(bearer(ph.token)).send({ room: "Kitchen", scans: [scan("Kitchen")] });
        expect(fixed.status).toBe(200);
        expect(await HomeRoomSample.countDocuments({ src: "fix" })).toBe(1);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom"] });
        expect(await HomeRoomSample.countDocuments({ room: "Kitchen" })).toBe(0);
        expect((await request(app).delete("/home/rooms/samples").set(auth).send({})).body.deleted).toBe(8);
        expect(await HomeRoomSample.countDocuments({})).toBe(0);
    });

    test("with rooms made, the map's blocks are the rooms and each phone sits in the room the model names; an unsure phone is 'home, room unknown'", async () => {
        const auth = await signUp();
        const ph = await link(auth, "Papa");
        const ph2 = await link(auth, "Mom");
        await request(app).put("/home/settings").set(auth).send({ homeSpot: { lat: 28.6139, lon: 77.209, radius: 200 } });
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 4; i++) { await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen"); }
        const now = Date.now();
        for (const t of [ph, ph2]) await request(app).post("/home/agent/location").set(bearer(t.token)).send({ lat: 28.6139, lon: 77.209, acc: 20, at: now, battery: { pct: 80, charging: false }, wifi: { connected: true, ip: "192.168.1.9", bssid: "aa:bb:cc:dd:ee:01" } });
        const d = await HomeDevice.findOne({ person: "Papa" });
        await live.update(d.toObject(), scan("Kitchen"), now);
        const map = (await request(app).get("/home/map").set(auth)).body;
        expect(map.zones.map((z) => z.name)).toEqual(["Bedroom", "Kitchen"]);
        const inKitchen = map.zones.find((z) => z.name === "Kitchen").people;
        expect(inKitchen).toHaveLength(1);
        expect(inKitchen[0]).toMatchObject({ person: "Papa", by: "room", sure: true });
        expect(inKitchen[0].confidence > 0.5).toBe(true);
        expect(map.zones.find((z) => z.name === "Bedroom").people).toEqual([]);
        expect(map.homeNoZone.map((p) => p.person)).toEqual(["Mom"]);          // her phone has room location off: home, room unknown
        expect(map.stats.rooms).toBe(2);
        expect(map.note).toMatch(/2 kamre/);
    });

    test("'Papa kis room mein hai' is answered from the model: the room and how sure, 'not sure' with the two likely rooms, off, and stale", async () => {
        const auth = await signUp();
        const ph = await link(auth, "Papa");
        await link(auth, "Mom");
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 4; i++) { await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen"); }
        const now = Date.now();
        const papa = await HomeDevice.findOne({ person: "Papa" });
        await live.update(papa.toObject(), scan("Kitchen"), now);
        const ask = async (text) => (await request(app).post("/home/assistant").set(auth).send({ text })).body.reply;
        expect(await ask("Papa kis room mein hai")).toMatch(/Papa abhi Kitchen mein hain \(\d+% pakka, 0 min pehle\)/);
        expect(await ask("kaun kis room mein hai")).toMatch(/Mom ka room location band hai/);
        await HomeDevice.updateOne({ _id: papa._id }, { $set: { "status.room.sure": false, "status.room.ranking": [{ room: "Kitchen", p: 0.52 }, { room: "Bedroom", p: 0.48 }] } });
        expect(await ask("papa kaun se room mein hai")).toMatch(/pakka nahi, shayad Kitchen \(52%\) ya Bedroom \(48%\)/);
        await HomeDevice.updateOne({ _id: papa._id }, { $set: { "status.room.at": now - 3 * 3600 * 1000 } });
        expect(await ask("papa kis room mein hai")).toMatch(/kamra abhi pata nahi \(aakhri scan 180 min purana\)/);
    });

    test("Start model: only trained phones start, an untrained one is told why, the phone's next answer carries roomOn, Stop turns it off", async () => {
        const auth = await signUp();
        const papa = await link(auth, "Papa");
        const mom = await link(auth, "Mom");
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 3; i++) { await tap(papa.token, "Bedroom"); await tap(papa.token, "Kitchen"); }
        await HomeDevice.updateMany({}, { $set: { roomOn: false } });
        const started = (await request(app).post("/home/room/model").set(auth).send({ on: true })).body;
        expect(started.running).toBe(true);
        expect(started.started).toEqual(["Papa"]);
        expect(started.blocked.map((b) => b.person)).toEqual(["Mom"]);
        expect(started.live.running).toBe(true);
        const ans = (token) => request(app).post("/home/agent/location").set(bearer(token)).send({ lat: 28.6, lon: 77.2, acc: 20, at: Date.now(), battery: { pct: 80, charging: false }, wifi: { connected: true, ip: "192.168.1.9" } });
        expect((await ans(papa.token)).body.roomOn).toBe(true);
        expect((await ans(mom.token)).body.roomOn).toBe(false);
        const tablet = await request(app).post("/home/pair-codes").set(auth).send({ kind: "hub", name: "Hall tablet" });
        const hub = (await request(app).post("/home/agent/pair").send({ code: tablet.body.code })).body;
        const stopped = (await request(app).post("/home/agent/room/model").set(bearer(hub.token)).send({ on: false })).body;     // the tablet can stop it too
        expect(stopped.running).toBe(false);
        expect(stopped.live.running).toBe(false);
        expect((await ans(papa.token)).body.roomOn).toBe(false);
        expect((await request(app).post("/home/room/model").send({ on: true })).status).toBe(401);
    });

    test("the live report has every number, the same on the website and the tablet; 'Sahi hai' and corrections make the real-life accuracy", async () => {
        const auth = await signUp();
        const ph = await link(auth, "Papa");
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 4; i++) { await tap(ph.token, "Bedroom"); await tap(ph.token, "Kitchen"); }
        await request(app).post("/home/room/model").set(auth).send({ on: true });
        const d = await HomeDevice.findOne({ kind: "phone" });
        await live.update(d.toObject(), scan("Kitchen"), Date.now());
        const site = (await request(app).get("/home/room/live").set(auth)).body;
        const p = site.phones[0];
        expect(site.running).toBe(true);
        expect(site.rooms).toEqual(["Bedroom", "Kitchen"]);
        expect(p.current.name).toBe("Kitchen");
        expect(p.current.ranking.map((r) => r.room)).toEqual(["Kitchen", "Bedroom"]);        // every room's share, not just the top few
        expect(p.current.nearest >= 0).toBe(true);
        expect(p.current.heard.wifi).toBe(3);
        expect(p.current.samples).toBe(64);
        expect(p.cv.accuracy >= 85).toBe(true);
        expect(p.field).toMatchObject({ confirmed: 0, wrong: 0, accuracy: null });
        // real life: one "Sahi hai", then a correction to another room
        await request(app).post("/home/agent/room/confirm").set(bearer(ph.token));
        await request(app).post("/home/agent/room/fix").set(bearer(ph.token)).send({ room: "Bedroom", scans: [scan("Bedroom")] });
        const hub = (await request(app).post("/home/agent/pair").send({ code: (await request(app).post("/home/pair-codes").set(auth).send({ kind: "hub", name: "T" })).body.code })).body;
        const tab = (await request(app).get("/home/agent/room/live").set(bearer(hub.token))).body;
        expect(tab.phones[0].field).toMatchObject({ confirmed: 1, wrong: 1, accuracy: 50 });
        expect(tab.summary.fieldAccuracy).toBe(50);
        expect(tab.summary.trained).toBe(1);
        expect(JSON.stringify({ ...tab, at: 0, phones: tab.phones.map((x) => ({ ...x, current: x.current && { ...x.current, ageSec: 0, at: 0 }, cv: x.cv, field: x.field })) }).length > 100).toBe(true);
    });

    test("only the oldest samples go once a room has 80", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        for (let i = 0; i < 11; i++) await tap(ph.token, "Bedroom", 8);       // 88 scans
        expect((await tap(ph.token, "Kitchen", 2)).body.counts.Bedroom).toBe(80);
    });

    /* ───────── deleting a room, and auto-improve (docs/ROOM_MODEL_AUTO_IMPROVE_PLAN.md) ───────── */

    const report = (token, room, extra = {}) => request(app).post("/home/agent/location").set(bearer(token)).send({ lat: 28.6139, lon: 77.209, acc: 20, at: Date.now(), battery: { pct: 80, charging: false }, wifi: { connected: true, ip: "192.168.1.9", bssid: "aa:bb:cc:dd:ee:01" }, scan: { ...scan(room), ...extra } });
    const phoneDoc = async (person) => (await HomeDevice.findOne(person ? { person } : { kind: "phone" })).toObject();
    const trainTwo = async (token, n = 4) => { for (let i = 0; i < n; i++) { await tap(token, "Bedroom"); await tap(token, "Kitchen"); } };

    test("deleting a room from the website removes it everywhere: list, layout, every phone's training, a phone's current room, walks; the timeline says so", async () => {
        const { HomeApEdge } = require("../models/homeApSeen");
        const auth = await signUp();
        const papa = await link(auth, "Papa"), mom = await link(auth, "Mom");
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen", "Hall"] });
        await trainTwo(papa.token); await tap(mom.token, "Kitchen"); await tap(mom.token, "Bedroom");
        await request(app).put("/home/map/layout").set(auth).send({ layout: { Bedroom: { x: 0, y: 0, w: 3, h: 3 }, Kitchen: { x: 4, y: 0, w: 2, h: 2 } } });
        await live.update(await phoneDoc("Papa"), scan("Kitchen"), Date.now());
        expect((await phoneDoc("Papa")).status.room.name).toBe("Kitchen");
        const owner = (await phoneDoc("Papa")).owner;
        await HomeApEdge.create({ owner, a: "r:Bedroom", b: "r:Kitchen", count: 2 });
        const r = await request(app).delete("/home/room/kitchen").set(auth);           // any capital letters
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ rooms: ["Bedroom", "Hall"], room: "Kitchen", deleted: 40 });
        expect(await HomeRoomSample.countDocuments({ room: "Kitchen" })).toBe(0);
        expect(await HomeRoomSample.countDocuments({ room: "Bedroom" })).toBe(40);
        expect((await phoneDoc("Papa")).status.room).toBeUndefined();
        expect(await HomeApEdge.countDocuments({})).toBe(0);
        const settings = await HomeSettings.findOne({}).lean();
        expect(Object.keys(settings.map.layout)).toEqual(["Bedroom"]);
        expect((await HomeEvent.findOne({ kind: "room_deleted" }).lean()).text).toMatch(/Kitchen.*40 training scan/);
        expect((await request(app).delete("/home/room/Garage").set(auth)).status).toBe(404);
        expect((await request(app).delete("/home/room/Hall")).status).toBe(401);
        const map = (await request(app).get("/home/map").set(auth)).body;
        expect(map.zones.map((z) => z.name)).toEqual(["Bedroom", "Hall"]);
    });

    test("a phone can delete a room too (Stashr Location → Room Lab → Kamra hatao)", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        await trainTwo(ph.token, 1);
        const r = await request(app).post("/home/agent/room/delete").set(bearer(ph.token)).send({ name: "Bedroom" });
        expect(r.status).toBe(200);
        expect(r.body.rooms).toEqual(["Kitchen"]);
        expect(r.body.counts).toEqual({ Kitchen: 8 });
        expect((await HomeEvent.findOne({ kind: "room_deleted" }).lean()).text).toMatch(/Bedroom \(Papa\)/);
        expect((await request(app).post("/home/agent/room/delete").set(bearer(ph.token)).send({ name: "Nope" })).status).toBe(404);
    });

    test("auto-improve: a settled, sure, fresh scan from the phone's normal report becomes an auto sample; an old app's scan never does", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        await trainTwo(ph.token);
        const autos = () => HomeRoomSample.countDocuments({ src: "auto" });
        // 1st scan: the room is found, but nothing is learned (the person may have just walked in)
        const first = await report(ph.token, "Kitchen", { ageSec: 15, auto: true });
        expect(first.body.roomAuto).toBe(true);
        const r1 = await until(async () => (await phoneDoc()).status.room);
        expect(r1.name).toBe("Kitchen");
        expect(r1.learned).toBe(false);
        expect(r1.learnWhy).toMatch(/settled/);
        // 2nd scan, same room: settled, so it is learned
        const now = Date.now();
        const r2 = await live.update(await phoneDoc(), { ...scan("Kitchen"), ageSec: 15, auto: true }, now);
        expect(r2.learned).toBe(true);
        expect(await autos()).toBe(1);
        const d = await phoneDoc();
        expect(d.roomAuto).toMatchObject({ added: 1, lastRoom: "Kitchen" });
        // right after: one per room every 10 minutes
        const r3 = await live.update(await phoneDoc(), { ...scan("Kitchen"), ageSec: 15 }, now + 60000);
        expect(r3.learned).toBe(false);
        expect(await autos()).toBe(1);
        // an older Stashr Location sends no age: the room is still found, but never learned from
        const r4 = await live.update(await phoneDoc(), scan("Kitchen"), now + 30 * 60000);
        expect(r4.name).toBe("Kitchen");
        expect(r4.learnWhy).toMatch(/not fresh/);
        // auto samples are counted apart from the person's training
        const site = (await request(app).get("/home/rooms").set(auth)).body.phones[0];
        expect(site.counts).toEqual({ Bedroom: 32, Kitchen: 32 });
        expect(site.autoCounts).toEqual({ Kitchen: 1 });
        expect(site.auto).toMatchObject({ on: true, added: 1, paused: false });
        const lv = (await request(app).get("/home/room/live").set(auth)).body;
        expect(lv.phones[0].auto).toMatchObject({ on: true, total: 1, counts: { Kitchen: 1 } });
        expect(lv.phones[0].tune.width).toBe(5);
        expect(lv.summary).toMatchObject({ autoOn: 1, autoSamples: 1 });
    });

    test("auto-improve can be switched off and on, from the website and from the phone; the phone's next answer follows", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        await trainTwo(ph.token);
        expect((await request(app).put(`/home/rooms/phone/${ph.deviceId}`).set(auth).send({ auto: false })).body).toEqual({ on: true, auto: false });
        expect((await report(ph.token, "Kitchen", { ageSec: 10 })).body.roomAuto).toBe(false);
        const now = Date.now();
        await live.update(await phoneDoc(), { ...scan("Kitchen"), ageSec: 10 }, now);
        expect((await live.update(await phoneDoc(), { ...scan("Kitchen"), ageSec: 10 }, now + 60000)).learnWhy).toMatch(/off/);
        const cfg = (await request(app).get("/home/agent/room/config").set(bearer(ph.token))).body;
        expect(cfg.auto).toMatchObject({ on: false, added: 0, counts: {} });
        expect((await request(app).post("/home/agent/room/auto").set(bearer(ph.token)).send({ on: true })).body.auto.on).toBe(true);
        expect((await phoneDoc()).roomAuto.off).toBeUndefined();
        expect((await request(app).put(`/home/rooms/phone/${ph.deviceId}`).set(auth).send({})).status).toBe(400);
        expect((await request(app).put(`/home/rooms/phone/${ph.deviceId}`).set(auth).send({ on: false })).body).toEqual({ on: false, auto: true });
    });

    test("'Galat hai' removes the auto samples that named another room at that spot; 'Sahi hai' with a scan becomes training", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        await trainTwo(ph.token);
        const d = await phoneDoc();
        const wrong = live.hashScan(d.owner, scan("Kitchen"));
        await HomeRoomSample.create({ owner: d.owner, phone: d._id, room: "Bedroom", session: "auto1", src: "auto", at: new Date(Date.now() - 3600000), ...wrong });
        live.forget(d._id);
        const fixed = await request(app).post("/home/agent/room/fix").set(bearer(ph.token)).send({ room: "Kitchen", scans: [scan("Kitchen")] });
        expect(fixed.body.purged).toBe(1);
        expect(fixed.body.vecs).toBeUndefined();
        expect(await HomeRoomSample.countDocuments({ src: "auto" })).toBe(0);
        const ok = await request(app).post("/home/agent/room/confirm").set(bearer(ph.token)).send({ room: "Kitchen", scans: [scan("Kitchen"), scan("Kitchen")] });
        expect(ok.body.added).toBe(2);
        expect(ok.body.field.confirmed).toBe(1);
        expect(await HomeRoomSample.countDocuments({ src: "confirm", room: "Kitchen" })).toBe(2);
        // an older phone sends nothing with "Sahi hai": still counted
        expect((await request(app).post("/home/agent/room/confirm").set(bearer(ph.token)).send({})).body).toMatchObject({ added: 0, field: { confirmed: 2 } });
    });

    test("the hourly check tunes each phone, and pauses auto-improve for a week when its samples make things worse", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen", "Store"] });
        await trainTwo(ph.token);
        const d = await phoneDoc();
        // auto samples for a room nobody trained, each a copy of a Kitchen scan (they pull Kitchen guesses away)
        const kitchen = await HomeRoomSample.find({ room: "Kitchen" }).lean();
        await HomeRoomSample.insertMany(kitchen.map((k, i) => ({ owner: d.owner, phone: d._id, room: "Store", session: "a" + i, src: "auto", at: new Date(), wifi: k.wifi, ble: k.ble })));
        live.forget(d._id);
        const r = (await request(app).post("/home/room/maintain").set(auth)).body;
        expect(r.done[0]).toMatchObject({ person: "Papa", paused: true });
        const after = await phoneDoc();
        expect(after.roomAuto.pausedUntil > Date.now() + 6 * 86400000).toBe(true);
        expect(after.roomAuto.guard.with < after.roomAuto.guard.without).toBe(true);
        expect(Number.isFinite(after.roomTune.width)).toBe(true);
        expect(after.roomTune.tried).toHaveLength(5);
        expect(await HomeRoomSample.countDocuments({ src: "auto" })).toBe(0);
        expect((await HomeEvent.findOne({ kind: "room_model" }).lean()).text).toMatch(/7 din/);
        expect(r.live.phones[0].auto).toMatchObject({ paused: true });
        const now = Date.now();
        await live.update(after, { ...scan("Kitchen"), ageSec: 5 }, now);
        expect((await live.update(await phoneDoc(), { ...scan("Kitchen"), ageSec: 5 }, now + 60000)).learnWhy).toMatch(/paused/);
    });

    test("a phone's room changes are counted as walks, and unsaved room blocks are arranged so rooms people walk between sit together", async () => {
        const { HomeApEdge } = require("../models/homeApSeen");
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Hall", "Kitchen"] });
        await trainTwo(ph.token);
        const now = Date.now();
        for (const [i, room] of ["Bedroom", "Kitchen", "Kitchen", "Bedroom", "Bedroom"].entries()) await live.update(await phoneDoc(), scan(room), now + i * 60000);
        const edge = await HomeApEdge.findOne({ a: "r:Bedroom", b: "r:Kitchen" }).lean();
        expect(edge.count).toBe(2);                                                       // Bedroom → Kitchen and back: the same pair
        await HomeApEdge.updateOne({ _id: edge._id }, { $set: { count: 5 } });
        const map = (await request(app).get("/home/map").set(auth)).body;
        const at = (n) => map.zones.find((z) => z.name === n);
        // two columns for three rooms: without walks it would be Bedroom, Hall / Kitchen; the Kitchen moved next to the Bedroom
        expect([at("Bedroom"), at("Kitchen"), at("Hall")].map((z) => [z.x, z.y])).toEqual([[0, 0], [2.5, 0], [0, 2.5]]);
    });

    test("auto samples have their own limit (40 a room), so they never push out a person's training", async () => {
        const auth = await signUp();
        const ph = await link(auth);
        await request(app).put("/home/rooms").set(auth).send({ rooms: ["Bedroom", "Kitchen"] });
        await trainTwo(ph.token);
        const d = await phoneDoc();
        await HomeRoomSample.insertMany(Array.from({ length: 41 }, (_, i) => ({ owner: d.owner, phone: d._id, room: "Kitchen", session: "old" + i, src: "auto", at: new Date(Date.now() - 2 * 86400000 - i * 1000), wifi: [{ b: "f" + i, r: -40 }, { b: "g" + i, r: -45 }], ble: [] })));
        live.forget(d._id);
        const now = Date.now();
        await live.update(await phoneDoc(), { ...scan("Kitchen"), ageSec: 5 }, now);
        expect((await live.update(await phoneDoc(), { ...scan("Kitchen"), ageSec: 5 }, now + 60000)).learned).toBe(true);
        expect(await HomeRoomSample.countDocuments({ src: "auto" })).toBe(40);
        expect(await HomeRoomSample.countDocuments({ src: "train", room: "Kitchen" })).toBe(32);
    });
});

