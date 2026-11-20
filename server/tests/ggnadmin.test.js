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
const GgnAdminLink = require("../models/ggnAdminLink");

/* A stand-in for the ggnHome server: the admin OTP login and one admin API. */
let fake, seen, role;
const send = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const jwtLike = (exp) => "h." + Buffer.from(JSON.stringify({ exp })).toString("base64url") + ".s";
let mongo;
beforeAll(async () => {
    mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
    fake = http.createServer((req, res) => {
        const url = new URL(req.url, "http://x");
        seen.push({ method: req.method, path: url.pathname + url.search, auth: req.headers.authorization || "" });
        if (url.pathname === "/admin/login/request-otp") return send(res, 200, { message: "OTP sent" });
        if (url.pathname === "/admin/login/verify-otp") return send(res, 200, { accessToken: jwtLike(Math.floor(Date.now() / 1000) + 3600), user: { role, name: "Boss", mobileNumber: "9810012345" } });
        if (url.pathname === "/api/admin/overview") return send(res, req.headers.authorization === "Bearer " + jwtLike(0) ? 401 : 200, { users: 7 });
        send(res, 404, {});
    });
    await new Promise((r) => fake.listen(0, "127.0.0.1", r));
    process.env.GGNHOME_URL = `http://127.0.0.1:${fake.address().port}`;
});
afterAll(async () => { fake.close(); await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { seen = []; role = "admin"; for (const M of [User, GgnAdminLink]) await M.deleteMany({}); });

async function signUp() {
    await request(app).post("/register").send({ name: "Ana", email: "ana@example.com", password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
}

describe("ggnHome admin inside Stashr", () => {
    test("signs in with the OTP, keeps the token sealed and forwards admin calls", async () => {
        const auth = await signUp();
        expect((await request(app).get("/ggnadmin/status").set(auth)).body.connected).toBe(false);
        expect((await request(app).post("/ggnadmin/otp").set(auth).send({ mobileNumber: "98100 12345" })).body.ok).toBe(true);
        const login = await request(app).post("/ggnadmin/login").set(auth).send({ mobileNumber: "9810012345", otp: "1234" });
        expect(login.body.ok).toBe(true);
        const row = await GgnAdminLink.findOne({}).lean();
        // Sealed, not the plain token: iv.tag.ciphertext in base64, with no trace of the JWT payload.
        // (Checking for the token's "h." prefix was flaky: the random 16-char IV ends in "h" 1 time in 64.)
        expect(/^[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{22}==\.[A-Za-z0-9+/]+=*$/.test(row.sealed)).toBe(true);
        expect(row.sealed.includes(Buffer.from('{"exp"').toString("base64url"))).toBe(false); // 6 bytes: encodes to a fixed "eyJleHAi" prefix
        expect((await request(app).get("/ggnadmin/status").set(auth)).body).toMatchObject({ connected: true, name: "Boss" });
        const r = await request(app).get("/ggnadmin/api/api/admin/overview?x=1").set(auth);
        expect(r.body).toEqual({ users: 7 });
        expect(seen.at(-1).path).toBe("/api/admin/overview?x=1");
        expect(seen.at(-1).auth.startsWith("Bearer h.")).toBe(true);
    });
    test("refuses non-admin accounts and paths outside the admin API", async () => {
        const auth = await signUp();
        role = "user";
        expect((await request(app).post("/ggnadmin/login").set(auth).send({ mobileNumber: "9810012345", otp: "1234" })).status).toBe(403);
        role = "admin";
        await request(app).post("/ggnadmin/login").set(auth).send({ mobileNumber: "9810012345", otp: "1234" });
        expect((await request(app).get("/ggnadmin/api/properties/list").set(auth)).status).toBe(400);
        expect((await request(app).get("/ggnadmin/api/admin/login/verify-otp").set(auth)).status).toBe(400);
    });
    test("needs a Stashr login and logs out", async () => {
        expect((await request(app).get("/ggnadmin/status")).status).toBe(401);
        const auth = await signUp();
        await request(app).post("/ggnadmin/login").set(auth).send({ mobileNumber: "9810012345", otp: "1234" });
        await request(app).post("/ggnadmin/logout").set(auth);
        expect((await request(app).get("/ggnadmin/api/api/admin/overview").set(auth)).status).toBe(409);
    });
});
