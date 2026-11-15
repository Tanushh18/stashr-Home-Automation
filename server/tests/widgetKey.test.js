const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
process.env.RATE_LIMIT_MAX = "1000";
process.env.ALLOW_SIGNUP = "true";
delete process.env.YOUTUBE_API_KEY;

const app = require("../app");
const User = require("../models/schema");
const HomeDevice = require("../models/homeDevice");
const HomeWidgetKey = require("../models/homeWidgetKey");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { for (const M of [User, HomeDevice, HomeWidgetKey]) await M.deleteMany({}); });

const signUp = async (email = "ana@example.com") => {
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
};
const makeKey = async (auth, name) => (await request(app).post("/home/widget-keys").set(auth).send({ name })).body;

describe("read-only keys for the home-screen widgets", () => {
    test("a signed-in user gets a key once; only its hash is stored; the list shows a hint, never the key", async () => {
        const auth = await signUp();
        const r = await request(app).post("/home/widget-keys").set(auth).send({ name: "My A38 <b>widgets</b>" });
        expect(r.status).toBe(201);
        expect(r.body.key).toMatch(/^wk_[a-f0-9]{48}$/);
        expect(r.body.name).toBe("My A38 bwidgetsb");           // markup characters are stripped
        const stored = await HomeWidgetKey.findOne({});
        expect(stored.hash).not.toContain(r.body.key);
        expect(stored.hash).toMatch(/^[a-f0-9]{64}$/);
        const list = (await request(app).get("/home/widget-keys").set(auth)).body.keys;
        expect(list).toHaveLength(1);
        expect(list[0].hint).toBe(r.body.key.slice(-4));
        expect(JSON.stringify(list)).not.toContain(r.body.key);
    });

    test("the key can read the dashboard and nothing else", async () => {
        const auth = await signUp();
        const { key } = await makeKey(auth);
        const ok = await request(app).get("/home/widget/dashboard").set("X-Widget-Key", key);
        expect(ok.status).toBe(200);
        expect(Array.isArray(ok.body.people)).toBe(true);
        expect(Array.isArray(ok.body.scenes)).toBe(true);
        expect(ok.headers["cache-control"]).toMatch(/no-store/);
        // not a login: every other route says no
        for (const path of ["/home/devices", "/home/settings", "/authenticate", "/home/dashboard", "/home/widget-keys"]) {
            const r = await request(app).get(path).set("X-Widget-Key", key).set("Authorization", `Bearer ${key}`);
            expect(r.status).toBe(401);
        }
        expect((await request(app).post("/home/scenes/movie-night/run").set("X-Widget-Key", key).send({})).status).toBe(401);
    });

    test("wrong, malformed or missing keys are refused with the same answer", async () => {
        const auth = await signUp(); await makeKey(auth);
        for (const k of ["", "nope", "wk_" + "0".repeat(48), "wk_" + "g".repeat(48), "wk_" + "a".repeat(47)]) {
            const r = await request(app).get("/home/widget/dashboard").set("X-Widget-Key", k);
            expect(r.status).toBe(401);
            expect(r.body.error).toBe("Not allowed.");
        }
        expect((await request(app).get("/home/widget/dashboard")).status).toBe(401);
    });

    test("it shows only its own owner's home", async () => {
        const a = await signUp("ana@example.com"), b = await signUp("bob@example.com");
        const owner = (await User.findOne({ email: "bob@example.com" }))._id;
        await HomeDevice.create({ owner, name: "Bob TV", kind: "tv", tokenHash: "t-bob", lastSeen: new Date(), status: { screen: "on" } });
        const ka = (await makeKey(a)).key, kb = (await makeKey(b)).key;
        expect((await request(app).get("/home/widget/dashboard").set("X-Widget-Key", ka)).body.tvs).toHaveLength(0);
        expect((await request(app).get("/home/widget/dashboard").set("X-Widget-Key", kb)).body.tvs.map((t) => t.name)).toEqual(["Bob TV"]);
    });

    test("the dashboard lists the family phones with battery and whether Remote lock is on", async () => {
        const auth = await signUp(); const owner = (await User.findOne({ email: "ana@example.com" }))._id;
        await HomeDevice.create({ owner, name: "Tanush A38", kind: "phone", person: "Tanush", tokenHash: "p1", lastSeen: new Date(), status: { agent: "stashr-where", battery: 87, charging: true, wifi: true, health: { remoteLock: true } } });
        await HomeDevice.create({ owner, name: "F21 Pro", kind: "phone", person: "Tanush", tokenHash: "p2", lastSeen: new Date(), status: { agent: "stashr-where", battery: 54, charging: false, wifi: false, health: { remoteLock: false } } });
        await HomeDevice.create({ owner, name: "Hub phone", kind: "phone", person: "X", tokenHash: "p3", lastSeen: new Date(), status: { agent: "stashr-hub", battery: 40 } });
        const { key } = await makeKey(auth);
        const phones = (await request(app).get("/home/widget/dashboard").set("X-Widget-Key", key)).body.phones;
        expect(phones.map((p) => p.name).sort()).toEqual(["F21 Pro", "Hub phone", "Tanush A38"]);
        const a38 = phones.find((p) => p.name === "Tanush A38");
        expect(a38).toMatchObject({ online: true, battery: 87, charging: true, wifi: true, canLock: true, remoteLock: true });
        expect(a38.id).toMatch(/^[a-f0-9]{24}$/);
        // an old "off" report must not hide the button (the phone may have just been switched on): offered, with the state kept for display
        expect(phones.find((p) => p.name === "F21 Pro")).toMatchObject({ canLock: true, remoteLock: false });
        // a phone in Stashr Hub's phone mode cannot be locked at all
        expect(phones.find((p) => p.name === "Hub phone")).toMatchObject({ canLock: false, remoteLock: null });
    });

    test("removing a key stops it at once; someone else cannot remove it; at most ten keys", async () => {
        const auth = await signUp(), other = await signUp("bob@example.com");
        const { id, key } = await makeKey(auth);
        expect((await request(app).delete(`/home/widget-keys/${id}`).set(other)).status).toBe(404);
        expect((await request(app).get("/home/widget/dashboard").set("X-Widget-Key", key)).status).toBe(200);
        expect((await request(app).delete(`/home/widget-keys/${id}`).set(auth)).status).toBe(200);
        expect((await request(app).get("/home/widget/dashboard").set("X-Widget-Key", key)).status).toBe(401);
        for (let i = 0; i < 10; i++) expect((await request(app).post("/home/widget-keys").set(auth).send({})).status).toBe(201);
        expect((await request(app).post("/home/widget-keys").set(auth).send({})).status).toBe(429);
    });

    test("making or listing keys needs a signed-in user; using a key records when it was last used", async () => {
        expect((await request(app).post("/home/widget-keys").send({})).status).toBe(401);
        expect((await request(app).get("/home/widget-keys")).status).toBe(401);
        const auth = await signUp(); const { key } = await makeKey(auth);
        await request(app).get("/home/widget/dashboard").set("X-Widget-Key", key);
        await new Promise((r) => setTimeout(r, 150));
        expect((await HomeWidgetKey.findOne({})).lastUsedAt).toBeTruthy();
    });
});
