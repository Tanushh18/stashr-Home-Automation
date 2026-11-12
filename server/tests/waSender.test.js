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
const HomeClaim = require("../models/homeClaim");
const WaSettings = require("../models/waSettings");
const WaSheet = require("../models/waSheet");
const WaRecipient = require("../models/waRecipient");
const WaSend = require("../models/waSend");
const sender = require("../utils/waSender");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { for (const M of [User, HomeDevice, HomeClaim, WaSettings, WaSheet, WaRecipient, WaSend]) await M.deleteMany({}); });

const signUp = async (email = "ana@example.com") => {
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
};
const pairHub = async (auth) => {
    const code = (await request(app).post("/home/pair-codes").set(auth).send({ kind: "hub", name: "Hall tablet" })).body.code;
    return (await request(app).post("/home/agent/pair").send({ code })).body;
};
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const hubReport = (token, acks = []) => request(app).post("/home/agent/report").set(bearer(token)).send({ status: { agent: "stashr-hub" }, acks });
const owner = async () => (await User.findOne({}))._id;
// Noon on a weekday, India time: inside the 10:00 to 19:00 window.
const NOON = Date.parse("2026-11-12T06:30:00Z");
// The tablet counts as online when it spoke recently relative to the time a test pretends it is.
const seenAt = (t) => HomeDevice.updateMany({}, { $set: { lastSeen: new Date(t), online: true } });

async function setup({ people = 3 } = {}) {
    const auth = await signUp();
    const hub = await pairHub(auth);
    await hubReport(hub.token);
    const sheet = (await request(app).post("/wa/sheets").set(auth).send({ name: "Test", texts: ["Hello {name}, new plots", "Hi {name}!"] })).body;
    const recipients = Array.from({ length: people }, (_, i) => ({ name: `Person ${i + 1}`, phone: `98100000${String(i + 1).padStart(2, "0")}` }));
    await request(app).post(`/wa/sheets/${sheet.id}/recipients`).set(auth).send({ recipients });
    await request(app).put("/wa/settings").set(auth).send({ enabled: true, dailyLimit: 2 });
    return { auth, hub, sheet, o: await owner() };
}

describe("pure rules", () => {
    test("normalizes Indian numbers", () => {
        expect(sender.normalizePhone("98100 00001")).toBe("919810000001");
        expect(sender.normalizePhone("+91 98100-00001")).toBe("919810000001");
        expect(sender.normalizePhone("09810000001")).toBe("919810000001");
        expect(sender.normalizePhone("123")).toBe(null);
    });
    test("the gap stays between 6 and 12 minutes and follows the daily limit", () => {
        const s = { from: "10:00", to: "19:00", gapMin: 6, gapMax: 12, dailyLimit: 13 };
        for (let i = 0; i < 200; i++) { const g = sender.nextGapMinutes(s); expect(g >= 6 && g <= 12).toBe(true); }
        // 540 minutes / 60 a day is 9 minutes a message: the gap is centred there.
        const mid = sender.nextGapMinutes({ ...s, dailyLimit: 60 }, () => 0.5);
        expect(Math.round(mid)).toBe(9);
    });
    test("the window", () => {
        const s = { from: "10:00", to: "19:00" };
        expect(sender.inWindow(s, 9 * 60 + 59)).toBe(false);
        expect(sender.inWindow(s, 10 * 60)).toBe(true);
        expect(sender.inWindow(s, 18 * 60 + 59)).toBe(true);
        expect(sender.inWindow(s, 19 * 60)).toBe(false);
    });
});

describe("the sender", () => {
    test("does nothing while it is off", async () => {
        const { auth, o } = await setup();
        await request(app).put("/wa/settings").set(auth).send({ enabled: false });
        const r = await sender.tickOwner(o, NOON);
        expect(r.did).toBe("wait");
        expect(await WaSend.countDocuments({})).toBe(0);
    });

    test("queues one message for the tablet, with the number and a filled-in text, and counts it only when the tablet says sent", async () => {
        const { auth, hub, o } = await setup();
        const r = await sender.tickOwner(o, NOON, () => 0);
        expect(r.did).toBe("queued");
        const send = await WaSend.findOne({});
        expect(send.status).toBe("queued");
        expect(send.phone).toBe("919810000001");
        expect(send.text).toBe("Hello Person, new plots");
        // The tablet's next report carries the command.
        const out = await hubReport(hub.token);
        const cmd = out.body.commands.find((c) => c.type === "send_wa");
        expect(cmd.args.phone).toBe("919810000001");
        expect(cmd.args.sendId).toBe(String(send._id));
        expect((await WaRecipient.findOne({ phone: "919810000001" })).status).toBe("queued");
        // Not counted as sent until the answer comes.
        expect((await request(app).get("/wa/overview").set(auth)).body.sheets[0].counts.sent).toBe(0);
        await hubReport(hub.token, [{ id: cmd.id, ok: true, message: "Sent" }]);
        expect((await WaSend.findOne({})).status).toBe("sent");
        expect((await WaRecipient.findOne({ phone: "919810000001" })).status).toBe("sent");
        const ov = (await request(app).get("/wa/overview").set(auth)).body;
        expect(ov.sheets[0].counts.sent).toBe(1);
        expect(ov.sentToday).toBe(1);
    });

    test("one message at a time: nothing new is queued until the tablet answers", async () => {
        const { o } = await setup();
        await sender.tickOwner(o, NOON, () => 0);
        const r = await sender.tickOwner(o, NOON + 31000, () => 0);
        expect(r.did).toBe("wait");
        expect(await WaSend.countDocuments({})).toBe(1);
    });

    test("waits for the random gap after a message, then goes on", async () => {
        const { hub, o } = await setup();
        await sender.tickOwner(o, NOON, () => 0);
        const cmd = (await hubReport(hub.token)).body.commands[0];
        await hubReport(hub.token, [{ id: cmd.id, ok: true, message: "Sent" }]);
        expect((await sender.tickOwner(o, NOON + 2 * 60000, () => 0)).did).toBe("wait");
        expect((await sender.tickOwner(o, NOON + 13 * 60000, () => 0)).did).toBe("queued");
        expect(await WaSend.countDocuments({})).toBe(2);
    });

    test("stops at the daily limit", async () => {
        const { hub, o } = await setup();
        let t = NOON;
        for (let i = 0; i < 2; i++) {
            expect((await sender.tickOwner(o, t, () => 0)).did).toBe("queued");
            const cmd = (await hubReport(hub.token)).body.commands[0];
            await hubReport(hub.token, [{ id: cmd.id, ok: true, message: "Sent" }]);
            t += 20 * 60000;
        }
        const r = await sender.tickOwner(o, t, () => 0);
        expect(r.did).toBe("wait");
        expect(r.status).toMatch(/Done for today/);
        expect(await WaSend.countDocuments({})).toBe(2);
    });

    test("outside the window nothing goes out", async () => {
        const { o } = await setup();
        const night = Date.parse("2026-11-12T20:30:00Z");            // 02:00 India time
        await seenAt(night);
        const r = await sender.tickOwner(o, night, () => 0);
        expect(r.status).toMatch(/Outside/);
        expect(await WaSend.countDocuments({})).toBe(0);
    });

    test("a number that is not on WhatsApp is skipped for good and the next person goes", async () => {
        const { hub, o } = await setup();
        await sender.tickOwner(o, NOON, () => 0);
        const cmd = (await hubReport(hub.token)).body.commands[0];
        await hubReport(hub.token, [{ id: cmd.id, ok: false, message: "That number is not on WhatsApp" }]);
        expect((await WaRecipient.findOne({ phone: "919810000001" })).status).toBe("skipped");
        const r = await sender.tickOwner(o, NOON + 13 * 60000, () => 0);
        expect(r.did).toBe("queued");
        expect((await WaSend.findOne({ status: "queued" })).phone).toBe("919810000002");
    });

    test("another kind of failure gets one more try, then is marked failed", async () => {
        const { hub, o } = await setup({ people: 1 });
        let t = NOON;
        for (let i = 0; i < 2; i++) {
            expect((await sender.tickOwner(o, t, () => 0)).did).toBe("queued");
            const cmd = (await hubReport(hub.token)).body.commands[0];
            await hubReport(hub.token, [{ id: cmd.id, ok: false, message: "Timed out" }]);
            t += 20 * 60000;
        }
        expect((await WaRecipient.findOne({})).status).toBe("failed");
        expect((await sender.tickOwner(o, t, () => 0)).status).toMatch(/Nobody is left/);
    });

    test("the same number in two sheets is messaged once", async () => {
        const { auth, hub, sheet, o } = await setup({ people: 1 });
        const second = (await request(app).post("/wa/sheets").set(auth).send({ name: "Other", texts: ["Hi"] })).body;
        await request(app).post(`/wa/sheets/${second.id}/recipients`).set(auth).send({ recipients: [{ name: "Same", phone: "9810000001" }] });
        await sender.tickOwner(o, NOON, () => 0);
        const cmd = (await hubReport(hub.token)).body.commands[0];
        await hubReport(hub.token, [{ id: cmd.id, ok: true, message: "Sent" }]);
        const r = await sender.tickOwner(o, NOON + 13 * 60000, () => 0);
        expect(r.status).toMatch(/Nobody is left/);
        expect((await WaRecipient.findOne({ sheet: second.id })).status).toBe("skipped");
    });

    test("a message the tablet never answers is given up and the person goes back in line", async () => {
        const { o } = await setup({ people: 1 });
        await sender.tickOwner(o, NOON, () => 0);
        await sender.tickOwner(o, NOON + 7 * 60000, () => 0);
        expect((await WaSend.findOne({})).status).toBe("failed");
        expect((await WaRecipient.findOne({})).status).toBe("pending");
    });

    test("an offline tablet means nothing is queued", async () => {
        const { o } = await setup();
        await HomeDevice.updateMany({}, { $set: { online: false } });
        const r = await sender.tickOwner(o, NOON, () => 0);
        expect(r.status).toMatch(/offline/);
        expect(await WaSend.countDocuments({})).toBe(0);
    });

    test("a sheet's own daily limit holds", async () => {
        const { auth, hub, sheet, o } = await setup();
        await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ dailyLimit: 1 });
        await sender.tickOwner(o, NOON, () => 0);
        const cmd = (await hubReport(hub.token)).body.commands[0];
        await hubReport(hub.token, [{ id: cmd.id, ok: true, message: "Sent" }]);
        const r = await sender.tickOwner(o, NOON + 13 * 60000, () => 0);
        expect(r.status).toMatch(/Nobody is left/);
    });

    test("test mode ignores the window, the gap and the daily limit", async () => {
        const { auth, hub, o } = await setup();
        await request(app).put("/wa/settings").set(auth).send({ testMode: true, dailyLimit: 0 });
        const night = Date.parse("2026-11-12T20:30:00Z");
        await seenAt(night);
        expect((await sender.tickOwner(o, night, () => 0)).did).toBe("queued");
        const cmd = (await hubReport(hub.token)).body.commands[0];
        await hubReport(hub.token, [{ id: cmd.id, ok: true, message: "Sent" }]);
        await seenAt(night + 31000);
        expect((await sender.tickOwner(o, night + 31000, () => 0)).did).toBe("queued");
    });
});

describe("the website API", () => {
    test("settings are checked", async () => {
        const { auth } = await setup();
        expect((await request(app).put("/wa/settings").set(auth).send({ from: "25:00" })).status).toBe(400);
        expect((await request(app).put("/wa/settings").set(auth).send({ from: "19:00", to: "10:00" })).status).toBe(400);
        expect((await request(app).put("/wa/settings").set(auth).send({ gapMin: 10, gapMax: 5 })).status).toBe(400);
        const ok = await request(app).put("/wa/settings").set(auth).send({ dailyLimit: 999 });
        expect(ok.body.dailyLimit).toBe(60);
    });

    test("importing reports duplicates and bad numbers", async () => {
        const { auth, sheet } = await setup({ people: 1 });
        const r = await request(app).post(`/wa/sheets/${sheet.id}/recipients`).set(auth).send({ recipients: [{ name: "A", phone: "9810000001" }, { name: "B", phone: "98100 00099" }, { name: "C", phone: "12" }, { name: "D", phone: "9810000099" }] });
        expect(r.body).toEqual({ added: 1, duplicates: 1, invalid: 1, total: 4 });
    });

    test("a test message goes to the tablet and one to a number does not touch any list", async () => {
        const { auth, hub, o } = await setup();
        const t = await request(app).post("/wa/test").set(auth).send({ phone: "9899334123" });
        expect(t.status).toBe(202);
        const cmd = (await hubReport(hub.token)).body.commands.find((c) => c.type === "send_wa");
        expect(cmd.args.phone).toBe("919899334123");
        await hubReport(hub.token, [{ id: cmd.id, ok: true, message: "Sent" }]);
        expect((await WaSend.findOne({ kind: "test" })).status).toBe("sent");
        expect(await WaRecipient.countDocuments({ status: "sent" })).toBe(0);
        const again = await request(app).post("/wa/test").set(auth).send({ phone: "12" });
        expect(again.status).toBe(400);
    });

    test("the tablet downloads the picture only for its own message", async () => {
        const { auth, hub, sheet, o } = await setup();
        const png = "data:image/png;base64," + Buffer.from("fakepng").toString("base64");
        expect((await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ image: png })).status).toBe(200);
        expect((await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ image: "data:text/html;base64,AAAA" })).status).toBe(400);
        await sender.tickOwner(o, NOON, () => 0);
        const send = await WaSend.findOne({});
        const got = await request(app).get(`/wa/agent/image/${send._id}`).set(bearer(hub.token));
        expect(got.status).toBe(200);
        expect(got.headers["content-type"]).toMatch(/image\/png/);
        expect((await request(app).get(`/wa/agent/image/${send._id}`)).status).toBe(401);
        const other = await pairHub(await signUp("bob@example.com"));
        expect((await request(app).get(`/wa/agent/image/${send._id}`).set(bearer(other.token))).status).toBe(404);
    });

    test("a sheet keeps up to five pictures and each message uses one of them at random", async () => {
        const { auth, hub, sheet, o } = await setup();
        const pic = (t) => "data:image/png;base64," + Buffer.from(t).toString("base64");
        for (const t of ["one", "two", "three"]) expect((await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ addImage: pic(t) })).status).toBe(200);
        expect((await request(app).get("/wa/overview").set(auth)).body.sheets[0].imageCount).toBe(3);
        await sender.tickOwner(o, NOON, () => 0.99);                          // the last picture
        const send = await WaSend.findOne({});
        expect(send.imageIndex).toBe(2);
        const got = await request(app).get(`/wa/agent/image/${send._id}`).set(bearer(hub.token));
        expect(got.body.toString()).toBe("three");
        const cmd = (await hubReport(hub.token)).body.commands.find((c) => c.type === "send_wa");
        expect(cmd.args.image).toBe(true);
        // Two more fit, a sixth does not; one can be removed by position.
        await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ addImage: pic("four") });
        await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ addImage: pic("five") });
        expect((await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ addImage: pic("six") })).status).toBe(400);
        await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ removeImage: 0 });
        expect((await request(app).get("/wa/overview").set(auth)).body.sheets[0].imageCount).toBe(4);
        expect((await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ removeImage: 9 })).status).toBe(400);
        await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ image: "" });
        expect((await request(app).get("/wa/overview").set(auth)).body.sheets[0].hasImage).toBe(false);
    });

    test("someone else's sheet is not reachable", async () => {
        const { sheet } = await setup();
        const bob = await signUp("bob@example.com");
        expect((await request(app).patch(`/wa/sheets/${sheet.id}`).set(bob).send({ enabled: false })).status).toBe(404);
        expect((await request(app).delete(`/wa/sheets/${sheet.id}`).set(bob)).status).toBe(404);
    });
});
