const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");
const crypto = require("crypto");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
process.env.RATE_LIMIT_MAX = "1000";
process.env.ALLOW_SIGNUP = "true";

const app = require("../app");
const fcm = require("../utils/fcm");
const User = require("../models/schema");
const HomeDevice = require("../models/homeDevice");
const HomeEvent = require("../models/homeEvent");
const home = require("../utils/home");

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY = { type: "service_account", project_id: "stashr-home", client_email: "x@stashr-home.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };
const TOKEN = "f".repeat(60) + ":APA91b" + "x".repeat(100);

let mongo;
const sent = [];
let fcmStatus = 200;
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const fakeFetch = async (url, opts) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) return reply(200, { access_token: "ya29.fake", expires_in: 3600 });
    if (fcmStatus >= 400) return reply(fcmStatus, { error: { status: "UNREGISTERED" } });
    sent.push(JSON.parse(opts.body).message);
    return reply(200, { name: "projects/stashr-home/messages/1" });
};

beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); delete process.env.STASHR_FIREBASE_KEY; });
beforeEach(async () => {
    for (const M of [User, HomeDevice, HomeEvent]) await M.deleteMany({});
    sent.length = 0; fcmStatus = 200;
    process.env.STASHR_FIREBASE_KEY = JSON.stringify(KEY);
    fcm._reset({ fetch: fakeFetch });
});

const signUp = async (email = "ana@example.com") => {
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
};
const ownerOf = async (email = "ana@example.com") => (await User.findOne({ email }))._id;
const phone = async (owner, over = {}) => HomeDevice.create({ owner, name: "Tanush A38", kind: "phone", person: "Tanush", tokenHash: Math.random().toString(36), status: { agent: "stashr-where" }, fcmToken: TOKEN, fcmSet: true, ...over });

describe("lock a family phone from Stashr", () => {
    test("sends one high-priority push with a 2-minute life, says it was sent, and writes it on the timeline", async () => {
        const auth = await signUp(); const p = await phone(await ownerOf());
        const r = await request(app).post(`/home/devices/${p._id}/lock`).set(auth).send({});
        expect(r.status).toBe(202);
        expect(r.body.sent).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].token).toBe(TOKEN);
        expect(sent[0].data).toEqual({ type: "lock" });
        expect(sent[0].android.priority).toBe("HIGH");
        expect(sent[0].android.ttl).toBe("120s");
        const events = await HomeEvent.find({ device: p._id });
        expect(events.map((e) => e.text).join(" ")).toMatch(/Lock sent to Tanush A38/);
    });

    test("only the owner's own phone: someone else gets 404 and no push goes out", async () => {
        const auth = await signUp(); const other = await signUp("bob@example.com");
        const p = await phone(await ownerOf());
        const r = await request(app).post(`/home/devices/${p._id}/lock`).set(other).send({});
        expect(r.status).toBe(404);
        expect(sent).toHaveLength(0);
        expect(auth).toBeTruthy();
    });

    test("only a phone running Stashr Location can be locked (not the TV or the tablet)", async () => {
        const auth = await signUp(); const owner = await ownerOf();
        const tv = await HomeDevice.create({ owner, name: "TV", kind: "tv", tokenHash: "t1", fcmToken: TOKEN });
        const r = await request(app).post(`/home/devices/${tv._id}/lock`).set(auth).send({});
        expect(r.status).toBe(400);
        const hubPhone = await phone(owner, { status: { agent: "stashr-hub" } });
        expect((await request(app).post(`/home/devices/${hubPhone._id}/lock`).set(auth).send({})).status).toBe(400);
        expect(sent).toHaveLength(0);
    });

    test("no push address yet: 409 with a plain reason; Firebase not set up: 503; both say nothing was sent", async () => {
        const auth = await signUp(); const owner = await ownerOf();
        const p = await phone(owner, { fcmToken: "", fcmSet: false });
        const r = await request(app).post(`/home/devices/${p._id}/lock`).set(auth).send({});
        expect(r.status).toBe(409);
        expect(r.body.error).toMatch(/no push address/);
        delete process.env.STASHR_FIREBASE_KEY;
        const q = await phone(owner, { name: "Other" });
        const r2 = await request(app).post(`/home/devices/${q._id}/lock`).set(auth).send({});
        expect(r2.status).toBe(503);
        expect(sent).toHaveLength(0);
    });

    test("Firebase refuses it: 502, never a success; a dead push address is forgotten", async () => {
        const auth = await signUp(); const p = await phone(await ownerOf());
        fcmStatus = 404;
        const r = await request(app).post(`/home/devices/${p._id}/lock`).set(auth).send({});
        expect(r.status).toBe(502);
        expect(r.body.sent).toBeUndefined();
        const after = await HomeDevice.findById(p._id).select("+fcmToken");
        expect(after.fcmToken).toBe("");
        expect((await HomeEvent.find({ device: p._id })).length).toBe(0);
    });

    test("needs a signed-in user", async () => {
        const r = await request(app).post("/home/devices/000000000000000000000000/lock").send({});
        expect(r.status).toBe(401);
    });

    test("the phone's report keeps its own word on the last lock and whether Remote lock is on", () => {
        const h = home.cleanHealth({ remoteLock: true, lastLock: { at: 1700000000000, ok: false, reason: "admin_off", junk: "x" }, evil: "<script>" });
        expect(h.remoteLock).toBe(true);
        expect(h.lastLock).toEqual({ at: 1700000000000, ok: false, reason: "admin_off" });
        expect(h.evil).toBeUndefined();
        expect(home.cleanHealth({ lastLock: { ok: true } }).lastLock).toBeUndefined();
    });
});
