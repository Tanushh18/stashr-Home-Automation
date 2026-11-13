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
const HomeDevice = require("../models/homeDevice");
const HomeClaim = require("../models/homeClaim");
const WaSettings = require("../models/waSettings");
const WaSheet = require("../models/waSheet");
const WaRecipient = require("../models/waRecipient");
const WaSend = require("../models/waSend");
const WaLink = require("../models/waLink");
const sender = require("../utils/waSender");

/* A tiny stand-in for the We Three server. */
let fake, fakeUrl, valid, marks, patchStatus, refreshes, leadsOverride = null, weLists = [], weLeads = [];
const leadsFor = () => [
    { id: "l1", name: "Ravi Kumar", phone: "+919810000001", archived: false, whatsappSentAt: null },
    { id: "l2", name: "Done Already", phone: "9810000002", archived: false, whatsappSentAt: "2026-11-01T00:00:00Z" },
    { id: "l3", name: "Archived", phone: "9810000003", archived: true, whatsappSentAt: null },
    { id: "l4", name: "Bad Number", phone: "12345", archived: false, whatsappSentAt: null },
    { id: "l5", name: "No WhatsApp", phone: "9810000005", archived: false, whatsappSentAt: null }
];
const send = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(d ? JSON.parse(d) : {}); } catch (e) { r({}); } }); });

let mongo;
beforeAll(async () => {
    mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
    fake = http.createServer(async (req, res) => {
        const url = new URL(req.url, "http://x"), body = await readBody(req);
        if (req.method === "POST" && url.pathname === "/auth/login") {
            if (body.mobileNumber === "8130483894" && body.mpin === "1234") { const t = "a" + (++refreshes); valid.add(t); return send(res, 200, { user: { name: "Tanush" }, accessToken: t, refreshToken: "r1" }); }
            return send(res, 401, { error: "Wrong mobile number or MPIN" });
        }
        if (req.method === "POST" && url.pathname === "/auth/refresh") {
            if (body.refreshToken !== "r1") return send(res, 401, { error: "Session expired" });
            const t = "a" + (++refreshes); valid.add(t); return send(res, 200, { accessToken: t, refreshToken: "r1" });
        }
        const token = (req.headers.authorization || "").replace("Bearer ", "");
        if (!valid.has(token)) return send(res, 401, { error: "Unauthorized" });
        if (req.method === "GET" && url.pathname === "/leads/origins") return send(res, 200, { origins: [{ name: "Test", count: 5, sent: 1 }, { name: "Calling data", count: 1993, sent: 153 }] });
        if (req.method === "POST" && url.pathname === "/leads/lists") { weLists.push(body.name); return send(res, weLists.filter((n) => n === body.name).length > 1 ? 200 : 201, { name: body.name, created: true }); }
        if (req.method === "POST" && url.pathname === "/leads/import") {
            let added = 0, existing = 0, invalid = 0;
            for (const c of body.contacts || []) {
                const ph = String(c.phone || "").replace(/\D/g, "").slice(-10);
                if (ph.length !== 10) { invalid++; continue; }
                if (weLeads.some((l) => l.phone === ph)) { existing++; continue; }
                weLeads.push({ id: "n" + (weLeads.length + 1), name: c.name, phone: ph, origin: body.list, archived: false, whatsappSentAt: null }); added++;
            }
            return send(res, 201, { added, existing, invalid });
        }
        if (req.method === "GET" && url.pathname === "/leads" && weLeads.some((l) => l.origin === url.searchParams.get("origin"))) {
            const mine = weLeads.filter((l) => l.origin === url.searchParams.get("origin")), page = Number(url.searchParams.get("page"));
            return send(res, 200, { leads: mine.slice((page - 1) * 2, page * 2), totalPages: Math.max(1, Math.ceil(mine.length / 2)) });
        }
        if (req.method === "GET" && url.pathname === "/leads") {
            if (url.searchParams.get("origin") !== "Test") return send(res, 200, { leads: [], totalPages: 1 });
            const page = Number(url.searchParams.get("page")), all = leadsOverride || leadsFor();
            return send(res, 200, { leads: all.slice((page - 1) * 3, page * 3), totalPages: 2 });     // pages of 3 to exercise paging
        }
        if (req.method === "PATCH" && url.pathname.startsWith("/leads/")) {
            if (patchStatus !== 200) return send(res, patchStatus, { error: "boom" });
            marks.push({ id: url.pathname.split("/")[2], ...body }); return send(res, 200, { lead: {} });
        }
        send(res, 404, {});
    });
    await new Promise((r) => fake.listen(0, "127.0.0.1", r));
    fakeUrl = `http://127.0.0.1:${fake.address().port}`;
    process.env.WA_THREE_URL = fakeUrl;
});
afterAll(async () => { fake.close(); await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
    valid = new Set(); marks = []; patchStatus = 200; refreshes = 0; weLists = []; weLeads = [];
    for (const M of [User, HomeDevice, HomeClaim, WaSettings, WaSheet, WaRecipient, WaSend, WaLink]) await M.deleteMany({});
});

const signUp = async (email = "ana@example.com") => {
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
};
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const hubReport = (token, acks = []) => request(app).post("/home/agent/report").set(bearer(token)).send({ status: { agent: "stashr-hub" }, acks });
const NOON = Date.parse("2026-11-12T06:30:00Z");

async function linked() {
    const auth = await signUp();
    const code = (await request(app).post("/home/pair-codes").set(auth).send({ kind: "hub", name: "Hall tablet" })).body.code;
    const hub = (await request(app).post("/home/agent/pair").send({ code })).body;
    await hubReport(hub.token);
    const c = await request(app).post("/wa/threads/connect").set(auth).send({ mobile: "81304 83894", mpin: "1234" });
    return { auth, hub, o: (await User.findOne({}))._id, connect: c };
}

describe("the We Three link", () => {
    test("a wrong MPIN is refused, a right one connects, and the MPIN is never stored", async () => {
        const auth = await signUp();
        const bad = await request(app).post("/wa/threads/connect").set(auth).send({ mobile: "8130483894", mpin: "9999" });
        expect(bad.status).toBe(401);
        expect((await request(app).get("/wa/threads").set(auth)).body.connected).toBe(false);
        const ok = await request(app).post("/wa/threads/connect").set(auth).send({ mobile: "8130483894", mpin: "1234" });
        expect(ok.status).toBe(200);
        expect(ok.body.name).toBe("Tanush");
        const row = await WaLink.findOne({}).lean();
        expect(JSON.stringify(row)).not.toMatch(/1234/);
        expect(row.sealed.includes("r1")).toBe(false);                       // the refresh token is sealed, not plain
        expect(require("../utils/waLeads").unseal(row.sealed)).toBe("r1");
        expect((await request(app).get("/wa/threads").set(auth)).body.connected).toBe(true);
    });

    test("it lists the We Three sheets and needs the link first", async () => {
        const auth = await signUp();
        expect((await request(app).get("/wa/threads/origins").set(auth)).status).toBe(409);
        const { auth: a2 } = await linked();
        const o = await request(app).get("/wa/threads/origins").set(a2);
        expect(o.body.origins.map((x) => x.name)).toEqual(["Test", "Calling data"]);
    });

    test("importing a sheet takes only leads that can be messaged, over several pages, and again adds nothing twice", async () => {
        const { auth } = await linked();
        const r = await request(app).post("/wa/threads/import").set(auth).send({ origin: "Test" });
        expect(r.body).toMatchObject({ seen: 5, added: 2, alreadySent: 1, invalid: 1 });     // l1 and l5 only
        const sheet = await WaSheet.findOne({});
        expect(sheet.source).toBe("leads");
        expect((await WaRecipient.find({}).sort({ order: 1 }).lean()).map((x) => [x.externalId, x.phone])).toEqual([["l1", "919810000001"], ["l5", "919810000005"]]);
        const again = await request(app).post("/wa/threads/import").set(auth).send({ origin: "Test" });
        expect(again.body.added).toBe(0);
        expect(again.body.duplicates).toBe(2);
        expect(await WaRecipient.countDocuments({})).toBe(2);
    });

    test("an expired access token is renewed on its own", async () => {
        const { auth } = await linked();
        valid.clear();                                                        // We Three forgets every access token
        const o = await request(app).get("/wa/threads/origins").set(auth);
        expect(o.status).toBe(200);
        expect(refreshes >= 2).toBe(true);
    });

    test("a sent message marks the lead in We Three, and a failed mark is retried until it lands", async () => {
        const { auth, hub, o } = await linked();
        await request(app).post("/wa/threads/import").set(auth).send({ origin: "Test" });
        const sheet = await WaSheet.findOne({});
        await WaSheet.updateOne({ _id: sheet._id }, { $set: { texts: ["Hello {name}"], enabled: true } });
        await request(app).put("/wa/settings").set(auth).send({ enabled: true, dailyLimit: 5 });
        patchStatus = 500;                                                    // We Three is failing right now
        await sender.tickOwner(o, NOON, () => 0);
        const cmd = (await hubReport(hub.token)).body.commands.find((c) => c.type === "send_wa");
        expect(cmd.args.phone).toBe("919810000001");
        await hubReport(hub.token, [{ id: cmd.id, ok: true, message: "Sent" }]);
        await new Promise((r) => setTimeout(r, 150));
        let p = await WaRecipient.findOne({ externalId: "l1" });
        expect(p.status).toBe("sent");
        expect(Boolean(p.markedAt)).toBe(false);
        expect(Boolean(p.markError)).toBe(true);
        expect(marks.length).toBe(0);
        patchStatus = 200;                                                    // We Three is back: the next sweep marks it
        await sender.tickAll(NOON + 60000);
        p = await WaRecipient.findOne({ externalId: "l1" });
        expect(Boolean(p.markedAt)).toBe(true);
        expect(marks).toEqual([{ id: "l1", whatsappSent: true, whatsappTemplateName: "Stashr" }]);
    });

    test("a number that is not on WhatsApp is marked in We Three as skipped, so it is never tried again", async () => {
        const { auth, hub, o } = await linked();
        await request(app).post("/wa/threads/import").set(auth).send({ origin: "Test" });
        await WaSheet.updateOne({}, { $set: { texts: ["Hi"], enabled: true } });
        await request(app).put("/wa/settings").set(auth).send({ enabled: true, dailyLimit: 5 });
        await sender.tickOwner(o, NOON, () => 0);
        const cmd = (await hubReport(hub.token)).body.commands.find((c) => c.type === "send_wa");
        await hubReport(hub.token, [{ id: cmd.id, ok: false, message: "That number is not on WhatsApp" }]);
        await new Promise((r) => setTimeout(r, 150));
        expect((await WaRecipient.findOne({ externalId: "l1" })).status).toBe("skipped");
        expect(marks).toEqual([{ id: "l1", whatsappSent: true, whatsappTemplateName: "No WhatsApp (skipped)" }]);
    });

    test("a person messaged in We Three after the import is not messaged again from Stashr", async () => {
        const { auth } = await linked();
        await request(app).post("/wa/threads/import").set(auth).send({ origin: "Test" });
        // We Three now shows l1 as messaged.
        const all = leadsFor; 
        const before = all();
        const spy = () => { const l = before[0]; l.whatsappSentAt = "2026-11-12T10:00:00Z"; return before; };
        spy();
        leadsOverride = before;
        const r = await request(app).post("/wa/threads/import").set(auth).send({ origin: "Test" });
        leadsOverride = null;
        expect(r.body.closed).toBe(1);
        expect((await WaRecipient.findOne({ externalId: "l1" })).status).toBe("skipped");
        expect((await WaRecipient.findOne({ externalId: "l5" })).status).toBe("pending");
    });

    test("a sheet can be reset for testing, but not while a message is on the tablet", async () => {
        const { auth, o } = await linked();
        await request(app).post("/wa/threads/import").set(auth).send({ origin: "Test" });
        const sheet = await WaSheet.findOne({});
        await WaRecipient.updateMany({}, { $set: { status: "sent", attempts: 1 } });
        const r = await request(app).post(`/wa/sheets/${sheet._id}/reset`).set(auth);
        expect(r.body.reset).toBe(2);
        expect(await WaRecipient.countDocuments({ status: "pending" })).toBe(2);
        await WaRecipient.updateOne({ externalId: "l1" }, { $set: { status: "queued" } });
        expect((await request(app).post(`/wa/sheets/${sheet._id}/reset`).set(auth)).status).toBe(409);
    });

    test("disconnecting forgets the sign-in", async () => {
        const { auth } = await linked();
        await request(app).delete("/wa/threads").set(auth);
        expect(await WaLink.countDocuments({})).toBe(0);
        expect((await request(app).get("/wa/threads/origins").set(auth)).status).toBe(409);
    });
});

describe("sheets that live in Stashr and We Three both", () => {
    const people = (...nums) => nums.map((n, i) => ({ name: "P" + (i + 1), phone: n }));

    test("a new sheet made with 'also in We Three' becomes a We Three list; its people go there and are linked by number", async () => {
        const { auth } = await linked();
        const made = await request(app).post("/wa/sheets").set(auth).send({ name: "Mine", weThree: true });
        expect(made.status).toBe(201);
        expect(weLists).toEqual(["Mine"]);
        expect(made.body.weThree).toMatchObject({ sent: 0 });
        const add = await request(app).post(`/wa/sheets/${made.body.id}/recipients`).set(auth).send({ recipients: people("9810000011", "9810000012", "9810000013") });
        expect(add.body).toMatchObject({ added: 3 });
        expect(add.body.weThree).toMatchObject({ sent: 3, added: 3, linked: 3, notLinked: 0 });
        expect(weLeads.map((l) => [l.origin, l.phone])).toEqual([["Mine", "9810000011"], ["Mine", "9810000012"], ["Mine", "9810000013"]]);
        const rows = await WaRecipient.find({ sheet: made.body.id }).sort({ order: 1 }).lean();
        expect(rows.map((r) => r.externalId)).toEqual(["n1", "n2", "n3"]);
        expect((await WaSheet.findById(made.body.id).lean()).weThree).toBe(true);
    });

    test("a person messaged from Stashr gets the mark on the right We Three lead", async () => {
        const { auth, o } = await linked();
        const made = await request(app).post("/wa/sheets").set(auth).send({ name: "Mine", weThree: true });
        await request(app).post(`/wa/sheets/${made.body.id}/recipients`).set(auth).send({ recipients: people("9810000011", "9810000012") });
        await WaRecipient.updateOne({ sheet: made.body.id, phone: "919810000012" }, { $set: { status: "sent" } });
        expect(await require("../utils/waLeads").writeBack(o, 10)).toBe(1);
        expect(marks.map((m) => m.id)).toEqual(["n2"]);
    });

    test("adding more people later sends only the new ones, and a number We Three already has elsewhere is reported, not duplicated", async () => {
        const { auth } = await linked();
        weLeads.push({ id: "x1", name: "Elsewhere", phone: "9810000099", origin: "Other list", archived: false, whatsappSentAt: null });
        const made = await request(app).post("/wa/sheets").set(auth).send({ name: "Mine", weThree: true });
        await request(app).post(`/wa/sheets/${made.body.id}/recipients`).set(auth).send({ recipients: people("9810000011") });
        const more = await request(app).post(`/wa/sheets/${made.body.id}/recipients`).set(auth).send({ recipients: people("9810000012", "9810000099") });
        expect(more.body.weThree).toMatchObject({ sent: 2, added: 1, existing: 1, linked: 1, notLinked: 1 });
        expect(weLeads.filter((l) => l.origin === "Mine").length).toBe(2);
    });

    test("an old sheet can be sent to We Three with one call, and a sheet without the link says so", async () => {
        const auth = await signUp();
        const sheet = await request(app).post("/wa/sheets").set(auth).send({ name: "Old" });
        expect((await request(app).post(`/wa/sheets/${sheet.body.id}/we-three`).set(auth)).status).toBe(409);
        const { auth: a2 } = await linked();
        const s2 = await request(app).post("/wa/sheets").set(a2).send({ name: "Old2" });
        await request(app).post(`/wa/sheets/${s2.body.id}/recipients`).set(a2).send({ recipients: people("9810000021") });
        expect(weLists).toEqual([]);
        const r = await request(app).post(`/wa/sheets/${s2.body.id}/we-three`).set(a2);
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ sent: 1, linked: 1 });
        expect(weLists).toEqual(["Old2"]);
    });

    test("a failing We Three does not stop the Stashr sheet or its people from being saved", async () => {
        const auth = await signUp();
        const made = await request(app).post("/wa/sheets").set(auth).send({ name: "Mine", weThree: true });    // not linked: the push fails
        expect(made.status).toBe(201);
        expect(made.body.weThreeError).toMatch(/Connect We Three/);
        const add = await request(app).post(`/wa/sheets/${made.body.id}/recipients`).set(auth).send({ recipients: people("9810000011") });
        expect(add.body.added).toBe(1);
    });

    test("the sweep sends new people to We Three and brings new We Three leads of the same list to Stashr", async () => {
        const { auth, o } = await linked();
        const made = await request(app).post("/wa/sheets").set(auth).send({ name: "Mine", weThree: true });
        await request(app).post(`/wa/sheets/${made.body.id}/recipients`).set(auth).send({ recipients: people("9810000011") });
        weLeads.push({ id: "n9", name: "Added in We Three", phone: "9810000055", origin: "Mine", archived: false, whatsappSentAt: null });
        await WaRecipient.create({ owner: o, sheet: made.body.id, name: "Late", phone: "919810000066", order: 99 });     // e.g. added when We Three was down
        const out = await require("../utils/waLeads").syncLinked(o, sender.normalizePhone, Date.now(), true);
        expect(out).toMatchObject({ pushed: 1, pulled: 1, errors: 0 });
        expect((await WaRecipient.find({ sheet: made.body.id }).lean()).map((r) => r.phone).sort()).toEqual(["919810000011", "919810000055", "919810000066"]);
        expect(weLeads.some((l) => l.phone === "9810000066" && l.origin === "Mine")).toBe(true);
        expect((await require("../utils/waLeads").syncLinked(o, sender.normalizePhone)).skipped).toBe(true);           // not again within 10 minutes
    });
});
