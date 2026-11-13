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

const app = require("../app");
const User = require("../models/schema");
const HomeDevice = require("../models/homeDevice");
const HomeEvent = require("../models/homeEvent");
const HomeSettings = require("../models/homeSettings");
const HomeTrack = require("../models/homeTrack");
const { HomeApSeen } = require("../models/homeApSeen");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { for (const M of [User, HomeDevice, HomeEvent, HomeSettings, HomeTrack, HomeApSeen]) await M.deleteMany({}); });

const signUp = async (email = "ana@example.com") => {
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
};
const owner = async (email = "ana@example.com") => (await User.findOne({ email }))._id;

describe("merging a device linked again under another name", () => {
    test("history, places and the live link move to the kept phone; the old one is removed", async () => {
        const auth = await signUp(), o = await owner();
        const oldP = await HomeDevice.create({ owner: o, name: "Parveen old", kind: "phone", person: "Parveen", tokenHash: "a".repeat(64) });
        const newP = await HomeDevice.create({ owner: o, name: "Parveen Chawla", kind: "phone", tokenHash: "b".repeat(64) });
        await HomeEvent.create({ owner: o, device: oldP._id, deviceName: "Parveen old", kind: "note", text: "x" });
        await HomeTrack.create({ owner: o, phone: oldP._id, at: new Date(), lat: 28.4, lon: 77.0 });
        await HomeSettings.create({ owner: o, places: [{ name: "Office", phone: oldP._id }, { name: "School", phone: newP._id }], share: { enabled: true, phones: [String(oldP._id)] } });

        const r = await request(app).post(`/home/devices/${oldP._id}/merge`).set(auth).send({ into: String(newP._id) });
        expect(r.status).toBe(200);
        expect(await HomeDevice.countDocuments({ _id: oldP._id })).toBe(0);
        const kept = await HomeDevice.findById(newP._id);
        expect(kept.name).toBe("Parveen Chawla");
        expect(kept.person).toBe("Parveen");                                   // filled in from the old entry
        const ev = await HomeEvent.findOne({});
        expect(String(ev.device)).toBe(String(newP._id));
        expect(ev.deviceName).toBe("Parveen Chawla");
        expect(String((await HomeTrack.findOne({})).phone)).toBe(String(newP._id));
        const s = await HomeSettings.findOne({ owner: o });
        expect(s.places.map((p) => String(p.phone))).toEqual([String(newP._id), String(newP._id)]);
        expect(s.share.phones).toEqual([String(newP._id)]);
    });

    test("Wi-Fi sightings both entries have are not doubled", async () => {
        const auth = await signUp(), o = await owner();
        const a = await HomeDevice.create({ owner: o, name: "old", kind: "phone", tokenHash: "f".repeat(64) });
        const b = await HomeDevice.create({ owner: o, name: "new", kind: "phone", tokenHash: "9".repeat(64) });
        const row = (device, bssid) => ({ owner: o, device, bssid, ap: bssid, lastSeen: new Date() });
        await HomeApSeen.create([row(a._id, "aa:aa"), row(a._id, "bb:bb"), row(b._id, "aa:aa")]);
        expect((await request(app).post(`/home/devices/${a._id}/merge`).set(auth).send({ into: String(b._id) })).status).toBe(200);
        const rows = await HomeApSeen.find({}).lean();
        expect(rows.length).toBe(2);
        expect(rows.every((r) => String(r.device) === String(b._id))).toBe(true);
    });

    test("only two different devices of the same kind, and only your own", async () => {
        const auth = await signUp(), o = await owner();
        const phone = await HomeDevice.create({ owner: o, name: "P", kind: "phone", tokenHash: "c".repeat(64) });
        const hub = await HomeDevice.create({ owner: o, name: "H", kind: "hub", tokenHash: "d".repeat(64) });
        expect((await request(app).post(`/home/devices/${phone._id}/merge`).set(auth).send({ into: String(phone._id) })).status).toBe(400);
        expect((await request(app).post(`/home/devices/${phone._id}/merge`).set(auth).send({ into: String(hub._id) })).status).toBe(400);
        expect((await request(app).post(`/home/devices/${phone._id}/merge`).set(auth).send({ into: "nope" })).status).toBe(404);
        const other = await signUp("bob@example.com");
        expect((await request(app).post(`/home/devices/${phone._id}/merge`).set(other).send({ into: String(hub._id) })).status).toBe(404);
        expect(await HomeDevice.countDocuments({})).toBe(2);
    });

    test("a phone can be disconnected from the website", async () => {
        const auth = await signUp(), o = await owner();
        const p = await HomeDevice.create({ owner: o, name: "P", kind: "phone", tokenHash: "e".repeat(64) });
        expect((await request(app).delete(`/home/devices/${p._id}`).set(auth)).status).toBe(200);
        expect(await HomeDevice.countDocuments({})).toBe(0);
    });
});
