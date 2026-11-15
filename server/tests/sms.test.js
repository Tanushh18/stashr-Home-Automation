const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const http = require("node:http");
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
const WaLink = require("../models/waLink");

/* A stand-in for the We Three server: its login and its SMS console. */
let fake, seen, admin, old;
const send = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(d ? JSON.parse(d) : {}); } catch (e) { r({}); } }); });
let mongo;
beforeAll(async () => {
    mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
    fake = http.createServer(async (req, res) => {
        const url = new URL(req.url, "http://x"), body = await readBody(req);
        if (req.method === "POST" && url.pathname === "/auth/login") return send(res, 200, { user: { name: "Tanush" }, accessToken: "a1", refreshToken: "r1" });
        if (req.method === "POST" && url.pathname === "/auth/refresh") return send(res, 200, { accessToken: "a1", refreshToken: "r1" });
        if (url.pathname.startsWith("/sms-console")) {
            if (old) return send(res, 401, { error: { code: "UNAUTHORIZED", message: "Bad console key" } });
            if (req.headers.authorization !== "Bearer a1") return send(res, 401, { error: "Unauthorized" });
            if (!admin) return send(res, 403, { error: { code: "FORBIDDEN", message: "Admin access required" } });
            seen.push({ method: req.method, path: url.pathname + url.search, body });
            if (url.pathname === "/sms-console/overview") return send(res, 200, { settings: { paused: false, mode: "auto" }, sheets: [{ sheet: "Calling data", texts: ["Hi {name}"], auto: true, remaining: 10 }], devices: [] });
            if (url.pathname === "/sms-console/sheets" && body.texts && body.texts.length === 0 && body.auto) return send(res, 400, { error: { code: "BAD_REQUEST", message: "Write the message for this sheet before switching Auto-send on" } });
            return send(res, 200, { ok: true, echo: body });
        }
        send(res, 404, {});
    });
    await new Promise((r) => fake.listen(0, "127.0.0.1", r));
    process.env.WA_THREE_URL = `http://127.0.0.1:${fake.address().port}`;
});
afterAll(async () => { fake.close(); await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { seen = []; admin = true; old = false; for (const M of [User, WaLink]) await M.deleteMany({}); });

async function signUp() {
    await request(app).post("/register").send({ name: "Ana", email: "ana@example.com", password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
}
async function linked() {
    const auth = await signUp();
    await request(app).post("/wa/threads/connect").set(auth).send({ mobile: "81304 83894", mpin: "1234" });
    return auth;
}

describe("SMS sender (managed from Stashr, sent by We Three)", () => {
    test("needs the We Three link first", async () => {
        const auth = await signUp();
        const r = await request(app).get("/sms/overview").set(auth);
        expect(r.status).toBe(409);
        expect(r.body.error).toMatch(/Connect We Three/);
    });

    test("the overview comes from We Three's SMS console with the linked login", async () => {
        const auth = await linked();
        const r = await request(app).get("/sms/overview").set(auth);
        expect(r.status).toBe(200);
        expect(r.body.sheets[0]).toMatchObject({ sheet: "Calling data", texts: ["Hi {name}"], auto: true });
        expect(seen[0]).toMatchObject({ method: "GET", path: "/sms-console/overview" });
    });

    test("a sheet's messages and switch, the settings and a phone are passed on with only the known fields", async () => {
        const auth = await linked();
        await request(app).put("/sms/sheets").set(auth).send({ sheet: " Calling data ", texts: ["One {name}", "Two {name}"], auto: true, onlyNew: 1, extra: "x" });
        expect(seen.at(-1)).toMatchObject({ method: "PUT", path: "/sms-console/sheets", body: { sheet: "Calling data", texts: ["One {name}", "Two {name}"], auto: true, onlyNew: true } });
        expect(seen.at(-1).body.extra).toBe(undefined);
        await request(app).put("/sms/settings").set(auth).send({ paused: true, dailyLimit: 80, days: [1, 2], hack: "no" });
        expect(seen.at(-1)).toMatchObject({ path: "/sms-console/settings", body: { paused: true, dailyLimit: 80, days: [1, 2] } });
        expect(seen.at(-1).body.hack).toBe(undefined);
        await request(app).patch("/sms/devices/phone 1").set(auth).send({ enabled: false, name: "Office phone" });
        expect(seen.at(-1)).toMatchObject({ method: "PATCH", path: "/sms-console/devices/phone%201", body: { enabled: false, name: "Office phone" } });
        await request(app).post("/sms/test").set(auth).send({ phoneNumber: "8130483894", message: "Hello" });
        expect(seen.at(-1)).toMatchObject({ method: "POST", path: "/sms-console/test", body: { phoneNumber: "8130483894", message: "Hello" } });
        await request(app).get("/sms/log?limit=999").set(auth);
        expect(seen.at(-1).path).toBe("/sms-console/log?limit=200");
        expect((await request(app).put("/sms/sheets").set(auth).send({ texts: [] })).status).toBe(400);
    });

    test("We Three's own errors come back readable", async () => {
        const auth = await linked();
        const bad = await request(app).put("/sms/sheets").set(auth).send({ sheet: "Calling data", texts: [], auto: true });
        expect(bad.status).toBe(400);
        expect(bad.body.error).toMatch(/Write the message/);
        admin = false;
        const notAdmin = await request(app).get("/sms/overview").set(auth);
        expect(notAdmin.status).toBe(403);
        expect(notAdmin.body.error).toMatch(/not an admin/);
        old = true;
        const tooOld = await request(app).get("/sms/overview").set(auth);
        expect(tooOld.status).toBe(502);
        expect(tooOld.body.error).toMatch(/Update We Three first/);
    });

    test("needs a Stashr login", async () => {
        expect((await request(app).get("/sms/overview")).status).toBe(401);
    });
});
