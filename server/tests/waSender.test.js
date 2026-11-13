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

async function setup({ people = 3, report = false } = {}) {
    const auth = await signUp();
    const hub = await pairHub(auth);
    await hubReport(hub.token);
    const sheet = (await request(app).post("/wa/sheets").set(auth).send({ name: "Test", texts: ["Hello {name}, new plots", "Hi {name}!"] })).body;
    const recipients = Array.from({ length: people }, (_, i) => ({ name: `Person ${i + 1}`, phone: `98100000${String(i + 1).padStart(2, "0")}` }));
    await request(app).post(`/wa/sheets/${sheet.id}/recipients`).set(auth).send({ recipients });
    await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ enabled: true });
    await request(app).put("/wa/settings").set(auth).send({ enabled: true, dailyLimit: 2, reportEnabled: report });
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
            await hubReport(hub.token, [{ id: cmd.id, ok: false, message: "Timed out before pressing Send (step 1)" }]);
            t += 20 * 60000;
        }
        expect((await WaRecipient.findOne({})).status).toBe("failed");
        expect((await sender.tickOwner(o, t, () => 0)).status).toMatch(/Nobody is left/);
    });

    test("the same number in two sheets is messaged once", async () => {
        const { auth, hub, sheet, o } = await setup({ people: 1 });
        const second = (await request(app).post("/wa/sheets").set(auth).send({ name: "Other", texts: ["Hi"] })).body;
        await request(app).post(`/wa/sheets/${second.id}/recipients`).set(auth).send({ recipients: [{ name: "Same", phone: "9810000001" }] });
        await request(app).patch(`/wa/sheets/${second.id}`).set(auth).send({ enabled: true });
        await sender.tickOwner(o, NOON, () => 0);
        const cmd = (await hubReport(hub.token)).body.commands[0];
        await hubReport(hub.token, [{ id: cmd.id, ok: true, message: "Sent" }]);
        const r = await sender.tickOwner(o, NOON + 13 * 60000, () => 0);
        expect(r.status).toMatch(/Nobody is left/);
        expect((await WaRecipient.findOne({ sheet: second.id })).status).toBe("skipped");
    });

    test("a message the tablet never picked up goes back in line", async () => {
        const { o } = await setup({ people: 1 });
        await sender.tickOwner(o, NOON, () => 0);                            // queued, the tablet has not reported since
        await sender.tickOwner(o, NOON + 7 * 60000, () => 0);
        expect((await WaSend.findOne({})).status).toBe("failed");
        expect((await WaRecipient.findOne({})).status).toBe("pending");
    });

    test("a message the tablet took but never answered is NOT retried, so nobody gets it twice", async () => {
        const { hub, o } = await setup({ people: 1 });
        await sender.tickOwner(o, NOON, () => 0);
        await hubReport(hub.token);                                          // the tablet takes the command (it is now "sent")
        await sender.tickOwner(o, NOON + 7 * 60000, () => 0);
        expect((await WaSend.findOne({})).status).toBe("failed");
        expect((await WaRecipient.findOne({})).status).toBe("failed");
        expect((await WaRecipient.findOne({})).attempts).toBe(1);
        expect((await sender.tickOwner(o, NOON + 30 * 60000, () => 0)).status).toMatch(/Nobody is left/);
    });

    test("'pressed Send but WhatsApp did not confirm' is not retried either", async () => {
        const { hub, o } = await setup({ people: 1 });
        await sender.tickOwner(o, NOON, () => 0);
        const cmd = (await hubReport(hub.token)).body.commands[0];
        await hubReport(hub.token, [{ id: cmd.id, ok: false, message: "Pressed Send but WhatsApp did not confirm" }]);
        expect((await WaRecipient.findOne({})).status).toBe("failed");
    });

    test("a new sheet sends nothing until it is switched on", async () => {
        const auth = await signUp();
        const made = (await request(app).post("/wa/sheets").set(auth).send({ name: "Fresh" })).body;
        expect((await request(app).get("/wa/overview").set(auth)).body.sheets[0].enabled).toBe(false);
        expect(made.id.length).toBe(24);
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

describe("the nightly report", () => {
    const cmdOf = async (hub) => (await hubReport(hub.token)).body.commands.find((c) => c.type === "send_wa");
    const answer = (hub, cmd, ok = true, message = "Sent") => hubReport(hub.token, [{ id: cmd.id, ok, message }]);

    // Two people: one is sent, one fails for a reason that is not retried. The limit of 2 is then used up.
    async function finishedDay() {
        const ctx = await setup({ people: 2, report: true });
        const { hub, o } = ctx;
        await sender.tickOwner(o, NOON, () => 0);
        await answer(hub, await cmdOf(hub));
        await sender.tickOwner(o, NOON + 13 * 60000, () => 0);
        await answer(hub, await cmdOf(hub), false, "Pressed Send but WhatsApp did not confirm");
        return ctx;
    }

    test("when the daily limit is reached, both numbers get the report one after the other, with the counts", async () => {
        const { hub, o } = await finishedDay();
        let t = NOON + 30 * 60000;
        const first = await sender.tickOwner(o, t, () => 0);
        expect(first.did).toBe("report");
        let cmd = await cmdOf(hub);
        expect(cmd.args.phone).toBe("918130483894");
        expect(cmd.args.image).toBe(false);
        expect(cmd.args.text).toMatch(/Sent: 1/);
        expect(cmd.args.text).toMatch(/Not sent: 1/);
        expect(cmd.args.text).toMatch(/Test: 1 sent, 1 not sent/);
        expect(cmd.args.text).toMatch(/Pressed Send but WhatsApp did not confirm/);
        // One at a time: nothing else goes until the first report is answered.
        expect((await sender.tickOwner(o, t + 31000, () => 0)).did).toBe("wait");
        await answer(hub, cmd);
        t += 62000;
        expect((await sender.tickOwner(o, t, () => 0)).did).toBe("report");
        cmd = await cmdOf(hub);
        expect(cmd.args.phone).toBe("919310994032");
        await answer(hub, cmd);
        // Once a day: no third report.
        t += 62000;
        expect((await sender.tickOwner(o, t, () => 0)).did).toBe("wait");
        expect(await WaSend.countDocuments({ kind: "report", status: "sent" })).toBe(2);
        // The report does not count against the daily limit.
        expect(await WaSend.countDocuments({ kind: "scheduled" })).toBe(2);
    });

    test("no report while the day's sending is still going", async () => {
        const { hub, o } = await setup({ people: 3, report: true });
        await sender.tickOwner(o, NOON, () => 0);
        await answer(hub, await cmdOf(hub));
        const r = await sender.tickOwner(o, NOON + 30 * 60000, () => 0);       // the limit is 2: the second message goes, not a report
        expect(r.did).toBe("queued");
        expect(await WaSend.countDocuments({ kind: "report" })).toBe(0);
    });

    test("after the window closes the report goes even if sending was switched off, and a day with nothing sent has no report", async () => {
        const { auth, hub, o } = await setup({ people: 3, report: true });
        await sender.tickOwner(o, NOON, () => 0);
        await answer(hub, await cmdOf(hub));
        await request(app).put("/wa/settings").set(auth).send({ enabled: false });
        const evening = Date.parse("2026-11-12T14:00:00Z");                    // 19:30 India time
        await seenAt(evening);
        expect((await sender.tickOwner(o, evening, () => 0)).did).toBe("report");
        // A different day with no sends: nothing to report.
        await WaSend.deleteMany({});
        await WaSettings.updateOne({}, { $set: { enabled: true } });
        await seenAt(evening + 86400000);
        expect((await sender.tickOwner(o, evening + 86400000, () => 0)).did).toBe("wait");
    });

    test("a failed report is tried again, three times at most, and test mode never reports", async () => {
        const { auth, hub, o } = await finishedDay();
        let t = NOON + 30 * 60000;
        for (let i = 0; i < 3; i++) {
            expect((await sender.tickOwner(o, t, () => 0)).did).toBe("report");
            const cmd = await cmdOf(hub);
            expect(cmd.args.phone).toBe("918130483894");
            await answer(hub, cmd, false, "Timed out before pressing Send (step 0)");
            t += 62000;
        }
        // The first number is given up on; the second one gets its report.
        expect((await sender.tickOwner(o, t, () => 0)).did).toBe("report");
        expect((await cmdOf(hub)).args.phone).toBe("919310994032");
        await request(app).put("/wa/settings").set(auth).send({ testMode: true });
        await WaSend.deleteMany({ kind: "report" });
        expect(await WaSend.countDocuments({ kind: "report" })).toBe(0);
        const r = await sender.tickOwner(o, t + 120000, () => 0);
        expect(r.did === "report").toBe(false);
    });

    test("'Send the report now' sends it again to every number, even when the report is off", async () => {
        const { auth, hub, o } = await setup({ people: 2, report: false });
        await sender.tickOwner(o, NOON, () => 0);
        await answer(hub, await cmdOf(hub));
        expect((await sender.tickOwner(o, NOON + 62000, () => 0)).did === "report").toBe(false);        // the report is off
        expect((await request(app).post("/wa/report/now").set(auth)).status).toBe(202);
        const r = await sender.tickOwner(o, NOON + 124000, () => 0);
        expect(r.did).toBe("report");
        let cmd = await cmdOf(hub);
        expect(cmd.args.phone).toBe("918130483894");
        await answer(hub, cmd, false, "That number is not on WhatsApp");
        // Pressing it again clears the failed try and starts over.
        await request(app).post("/wa/report/now").set(auth);
        expect((await sender.tickOwner(o, NOON + 190000, () => 0)).did).toBe("report");
        cmd = await cmdOf(hub);
        expect(cmd.args.phone).toBe("918130483894");
        await answer(hub, cmd);
        expect((await sender.tickOwner(o, NOON + 250000, () => 0)).did).toBe("report");
        expect((await cmdOf(hub)).args.phone).toBe("919310994032");
    });

    test("the report numbers and the report switch can be changed, and bad numbers are refused", async () => {
        const { auth } = await setup();
        const ok = await request(app).put("/wa/settings").set(auth).send({ reportNumbers: "98100 12345, +91 98100-54321", reportEnabled: true });
        expect(ok.body.reportNumbers).toEqual(["919810012345", "919810054321"]);
        expect((await request(app).put("/wa/settings").set(auth).send({ reportNumbers: "12, 34" })).status).toBe(400);
        const off = await request(app).put("/wa/settings").set(auth).send({ reportEnabled: false });
        expect(off.body.reportEnabled).toBe(false);
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

    test("a picture another sheet already has can be reused on a sheet, without uploading it again", async () => {
        const { auth, sheet } = await setup();
        const pic = (t) => "data:image/png;base64," + Buffer.from(t).toString("base64");
        const b = (await request(app).post("/wa/sheets").set(auth).send({ name: "Second" })).body;
        await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ addImage: pic("one") });
        await request(app).patch(`/wa/sheets/${sheet.id}`).set(auth).send({ addImage: pic("two") });
        const list = (await request(app).get("/wa/pictures").set(auth)).body.pictures;
        expect(list.length).toBe(2);
        expect(list[0].sheetName).toBe("Test");
        expect((await request(app).get(`/wa/pictures/${sheet.id}/1`).set(auth)).body.image).toBe(pic("two"));
        expect((await request(app).get(`/wa/pictures/${sheet.id}/5`).set(auth)).status).toBe(404);
        const copy = await request(app).patch(`/wa/sheets/${b.id}`).set(auth).send({ copyImage: { sheet: sheet.id, index: 1 } });
        expect(copy.status).toBe(200);
        expect((await request(app).get(`/wa/pictures/${b.id}/0`).set(auth)).body.image).toBe(pic("two"));
        // The same picture twice is refused, and a wrong position is not found.
        expect((await request(app).patch(`/wa/sheets/${b.id}`).set(auth).send({ copyImage: { sheet: sheet.id, index: 1 } })).status).toBe(409);
        expect((await request(app).patch(`/wa/sheets/${b.id}`).set(auth).send({ copyImage: { sheet: sheet.id, index: 7 } })).status).toBe(404);
        // The original keeps its pictures.
        expect((await request(app).get(`/wa/pictures/${sheet.id}/1`).set(auth)).status).toBe(200);
        // Someone else cannot read or copy it.
        const other = await signUp("bob@example.com");
        expect((await request(app).get("/wa/pictures").set(other)).body.pictures.length).toBe(0);
        expect((await request(app).get(`/wa/pictures/${sheet.id}/0`).set(other)).status).toBe(404);
    });

    test("every message keeps its steps: picked, queued, delivered, then where it stopped", async () => {
        const { auth, hub, o } = await setup({ people: 2 });
        const pic = "data:image/png;base64," + Buffer.from("one").toString("base64");
        const sheetId = (await request(app).get("/wa/overview").set(auth)).body.sheets[0]._id;
        await request(app).patch(`/wa/sheets/${sheetId}`).set(auth).send({ addImage: pic });
        await sender.tickOwner(o, NOON, () => 0);
        let send = await WaSend.findOne({});
        expect(send.steps.map((x) => x.key)).toEqual(["picked", "queued"]);
        const cmd = (await hubReport(hub.token)).body.commands.find((c) => c.type === "send_wa");
        send = await WaSend.findOne({});
        expect(send.steps.map((x) => x.key)).toEqual(["picked", "queued", "delivered"]);
        await hubReport(hub.token, [{ id: cmd.id, ok: false, message: "Timed out before pressing Send (step 1)" }]);
        send = await WaSend.findOne({});
        expect(send.status).toBe("failed");
        expect(send.failedWhere).toBe("tablet");
        const failed = send.steps.find((x) => x.state === "failed");
        expect(failed.key).toBe("picture");
        expect(failed.note).toMatch(/Gallery/);
        expect(send.steps.filter((x) => x.state === "skipped").map((x) => x.key)).toEqual(["opened", "send", "confirmed"]);
        // The website gets them too.
        const row = (await request(app).get("/wa/overview").set(auth)).body.recent[0];
        expect(row.failedWhere).toBe("tablet");
        expect(row.steps.length).toBe(send.steps.length);
        expect((await request(app).get(`/wa/sends/${send._id}`).set(auth)).body.steps.length).toBe(send.steps.length);
    });

    test("a message the tablet never picked up fails at 'received', and a sent one has every step ok", async () => {
        const { hub, o } = await setup({ people: 2 });
        await sender.tickOwner(o, NOON, () => 0);
        await sender.tickOwner(o, NOON + 7 * 60000, () => 0);              // six minutes later the tablet still has not asked
        let send = await WaSend.findOne({});
        expect(send.status).toBe("failed");
        expect(send.failedWhere).toBe("tablet");
        expect(send.steps.find((x) => x.state === "failed").key).toBe("delivered");
        await WaSend.deleteMany({});
        await WaSettings.updateMany({}, { $set: { nextDueAt: null } });
        await sender.tickOwner(o, NOON + 20 * 60000, () => 0);
        const cmd = (await hubReport(hub.token)).body.commands.filter((c) => c.type === "send_wa").pop();
        await hubReport(hub.token, [{ id: cmd.id, ok: true, message: "Sent to +91" }]);
        send = await WaSend.findOne({});
        expect(send.status).toBe("sent");
        expect(send.failedWhere).toBe("");
        expect(send.steps.every((x) => x.state === "ok")).toBe(true);
        expect(send.steps.map((x) => x.key)).toEqual(["picked", "queued", "delivered", "checks", "opened", "send", "confirmed"]);
    });

    test("each sheet says when its next message goes out, or why it will not", async () => {
        const { auth } = await setup({ people: 2 });
        const b = (await request(app).post("/wa/sheets").set(auth).send({ name: "Second", texts: ["Hi"] })).body;
        await request(app).post(`/wa/sheets/${b.id}/recipients`).set(auth).send({ recipients: [{ name: "Z", phone: "9810000099" }] });
        const ov = (await request(app).get("/wa/overview").set(auth)).body;
        expect(ov.next.sheet).toBeTruthy();
        const plans = Object.fromEntries(ov.sheets.map((s) => [s.name, s.plan]));
        expect(plans.Second.state).toBe("blocked");                         // a new sheet is switched off
        expect(plans.Second.reason).toMatch(/switched off/);
        expect(["next", "blocked"]).toContain(plans.Test.state);
        // The pure rule: outside the window it points at the next opening.
        const mk = (minutes) => sender.schedulePlan({ settings: { enabled: true, from: "10:00", to: "19:00", gapMin: 6, gapMax: 12, dailyLimit: 5, nextDueAt: null }, local: { minutes },
            now: 1e12, tablet: { _id: 1 }, sentToday: 0, waiting: false, sheets: [{ _id: "a", enabled: true, texts: ["x"], dailyLimit: 0 }, { _id: "b", enabled: true, texts: ["y"], dailyLimit: 0 }],
            today: { a: 2, b: 1 }, pendingBy: { a: 3, b: 3 } });
        const early = mk(9 * 60);
        expect(early.next.sheet).toBe("b");                                 // the sheet with the fewest sends goes first
        expect(early.next.at).toBe(1e12 + 60 * 60000);
        expect(early.sheets.a).toMatchObject({ state: "later", after: 1 });
        expect(mk(12 * 60).next.reason).toBe("");
        expect(mk(20 * 60).next.reason).toMatch(/opens tomorrow/);
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
