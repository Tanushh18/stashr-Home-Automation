// Turning syncing off for one device from the website or the app: a phone's location, the tablet and the TV all stop being stored.
const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
process.env.RATE_LIMIT_MAX = "1000";
process.env.ALLOW_SIGNUP = "true";
process.env.HOME_ROUTING = "off";
delete process.env.YOUTUBE_API_KEY;

const User = require("../models/schema"), HomeDevice = require("../models/homeDevice"), HomeSettings = require("../models/homeSettings"), HomeEvent = require("../models/homeEvent");
const app = require("../app");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { for (const M of [User, HomeDevice, HomeSettings, HomeEvent]) await M.deleteMany({}); });

const signUp = async () => {
    await request(app).post("/register").send({ name: "Ana", email: "ana@example.com", password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
};
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

describe("sync on or off for one device", () => {
    test("a phone with syncing off is not stored, answers 'paused', and everything resumes when it is turned back on", async () => {
        const auth = await signUp();
        const lc = (await request(app).get("/home/location-code").set(auth)).body.code;
        const ph = (await request(app).post("/home/agent/link").send({ code: lc, name: "Papa" })).body;
        const fix = (lat) => request(app).post("/home/agent/location").set(bearer(ph.token)).send({ lat, lon: 77.209, acc: 20, at: Date.now(), battery: { pct: 80, charging: false }, wifi: { connected: true, ip: "192.168.1.30", bssid: "aa:bb:cc:dd:ee:02" } });
        expect((await fix(28.6139)).body.paused).toBeUndefined();
        const id = String((await HomeDevice.findOne({ kind: "phone" }))._id);
        const before = (await HomeDevice.findById(id)).status.location.lat;

        const off = await request(app).put(`/home/devices/${id}/sync`).set(auth).send({ paused: true });
        expect(off.status).toBe(200); expect(off.body.syncPaused).toBe(true);
        const r = await fix(30.0);
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ ok: true, paused: true, state: "paused" });
        expect(r.body.nextCheckSec).toBe(900);
        expect((await HomeDevice.findById(id)).status.location.lat).toBe(before);              // the new fix was not stored
        const listed = (await request(app).get("/home/devices").set(auth)).body;
        const row = (listed.devices || listed).find((d) => String(d.id || d._id) === id);
        expect(row.syncPaused).toBe(true);
        expect(row.online).toBe(false);

        expect((await request(app).put(`/home/devices/${id}/sync`).set(auth).send({ paused: false })).body.syncPaused).toBe(false);
        expect((await fix(30.0)).body.paused).toBeUndefined();
        expect((await HomeDevice.findById(id)).status.location.lat).toBe(30.0);
    });

    test("the tablet can be switched too; a made-up id or a non-boolean is refused; other people's devices are untouchable", async () => {
        const auth = await signUp();
        const code = (await request(app).post("/home/pair-codes").set(auth).send({ kind: "hub", name: "Hall tablet" })).body.code;
        await request(app).post("/home/agent/pair").send({ code });
        const tv = await HomeDevice.findOne({ kind: "hub" });
        expect((await request(app).put(`/home/devices/${tv._id}/sync`).set(auth).send({ paused: true })).body.syncPaused).toBe(true);
        expect((await request(app).put(`/home/devices/${tv._id}/sync`).set(auth).send({ paused: "yes" })).status).toBe(400);
        expect((await request(app).put(`/home/devices/${new mongoose.Types.ObjectId()}/sync`).set(auth).send({ paused: true })).status).toBe(404);
        expect((await request(app).put(`/home/devices/${tv._id}/sync`).send({ paused: false })).status).toBe(401);
    });
});
