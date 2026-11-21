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
const Bill = require("../models/bill");
const ExpenseTx = require("../models/expenseTx");
const bills = require("../utils/bills");

// The tests pretend it is 12:00 noon India time on this fixed day, whatever the real date is.
const TODAY = "2026-06-10";
const NOON = Date.parse(`${TODAY}T06:30:00Z`);
const at = (day, hhmm = "12:00") => Date.parse(`${day}T${hhmm}:00+05:30`);

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { app.set("billsNow", () => NOON); for (const M of [User, Bill, ExpenseTx]) await M.deleteMany({}); });

const signUp = async (email = "ana@example.com") => {
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const res = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${res.body.token}` };
};
const add = (auth, o = {}) => request(app).post("/bills").set(auth).send({ name: "Electricity", dueDate: "2026-06-12", account: "150322009", amount: 1284.5, ...o });

describe("bill helpers", () => {
    test("state of a bill is worked out from the given day", () => {
        expect(bills.stateOf({ status: "unpaid", dueDate: "2026-06-09" }, TODAY).state).toBe("overdue");
        expect(bills.stateOf({ status: "unpaid", dueDate: TODAY }, TODAY).state).toBe("today");
        expect(bills.stateOf({ status: "unpaid", dueDate: "2026-06-13" }, TODAY).state).toBe("soon");
        expect(bills.stateOf({ status: "unpaid", dueDate: "2026-06-14" }, TODAY).state).toBe("later");
        expect(bills.stateOf({ status: "paid", dueDate: "2026-06-01" }, TODAY).state).toBe("paid");
    });
    test("next month keeps the day as far as the month allows", () => {
        expect(bills.addMonth("2026-01-31")).toBe("2026-02-28");
        expect(bills.addMonth("2026-12-15")).toBe("2027-01-15");
    });
    test("reads an electricity bill (DHBVN style) and ignores the last-payment amount", () => {
        const r = bills.parseBillText("K No.: 1503 2200 9   Meter 77\nBill Issue Date: 05/11/2026\nLast Payment Details Amount 900 Receipt 12\nTotal Payable Amount (A+B+C) Rs 1,284.50\nDue Date: 15-11-2026");
        expect(r).toMatchObject({ amount: 1284.5, dueDate: "2026-11-15", billDate: "2026-11-05", account: "1503 2200 9" });
        expect(bills.parseBillText("Hello there").found).toBe(false);
    });
    test("dates without a year are not guessed", () => { expect(bills.firstDate("pay by 15 Nov")).toBe(""); });
});

describe("bills API", () => {
    test("needs a sign-in", async () => { expect((await request(app).get("/bills")).status).toBe(401); });

    test("add, list sorted by due date, edit and delete", async () => {
        const auth = await signUp();
        await add(auth, { name: "Water", dueDate: "2026-06-30" });
        const e = (await add(auth)).body;
        expect(e.account).toBe("150322009");
        const list = (await request(app).get("/bills").set(auth)).body;
        expect(list.today).toBe(TODAY);
        expect(list.bills.map((b) => b.name)).toEqual(["Electricity", "Water"]);
        expect(list.due.map((b) => b.name)).toEqual(["Electricity"]);
        const p = await request(app).patch(`/bills/${e.id}`).set(auth).send({ dueDate: "2026-06-05", notes: "autopay off" });
        expect(p.body.state).toBe("overdue");
        expect(p.body.notes).toBe("autopay off");
        expect(p.body.account).toBe("150322009");           // untouched by an edit that did not mention it
        expect((await request(app).delete(`/bills/${e.id}`).set(auth)).status).toBe(200);
        expect((await request(app).get("/bills").set(auth)).body.bills).toHaveLength(1);
    });

    test("checks the fields", async () => {
        const auth = await signUp();
        expect((await add(auth, { name: "" })).status).toBe(400);
        expect((await add(auth, { dueDate: "2026-02-31" })).status).toBe(400);
        expect((await add(auth, { amount: -4 })).status).toBe(400);
        expect((await add(auth, { billDate: "2026-06-20" })).status).toBe(400);
        expect((await request(app).patch("/bills/nope").set(auth).send({})).status).toBe(404);
    });

    test("the account number is stored sealed, and the banner list does not carry it", async () => {
        const auth = await signUp();
        await add(auth);
        const raw = await Bill.findOne({}).lean();
        expect(JSON.stringify(raw)).not.toContain("150322009");
        expect(raw.enc).toMatch(/^gcm:/);
        const due = (await request(app).get("/bills/due").set(auth)).body;
        expect(due.due).toHaveLength(1);
        expect(JSON.stringify(due)).not.toContain("150322009");
    });

    test("a bill belongs to its owner", async () => {
        const a = await signUp(), b = await signUp("bo@example.com");
        const e = (await add(a)).body;
        expect((await request(app).patch(`/bills/${e.id}`).set(b).send({ name: "x" })).status).toBe(404);
        expect((await request(app).delete(`/bills/${e.id}`).set(b)).status).toBe(404);
        expect((await request(app).get("/bills").set(b)).body.bills).toHaveLength(0);
    });

    test("paying adds a Money expense and marks the bill; undo removes both", async () => {
        const auth = await signUp();
        const e = (await add(auth)).body;
        const paid = await request(app).post(`/bills/${e.id}/pay`).set(auth).send({});
        expect(paid.status).toBe(200);
        expect(paid.body.bill).toMatchObject({ status: "paid", paidAt: TODAY, paidAmount: 1284.5, inMoney: true });
        const money = (await request(app).get(`/expenses?month=${TODAY.slice(0, 7)}`).set(auth)).body;
        const rows = JSON.stringify(money);
        expect(rows).toContain("Electricity");
        expect(rows).not.toContain("150322009");
        expect((await request(app).post(`/bills/${e.id}/pay`).set(auth).send({})).status).toBe(409);
        expect((await request(app).get("/bills/due").set(auth)).body.due).toHaveLength(0);
        const undo = await request(app).post(`/bills/${e.id}/unpay`).set(auth);
        expect(undo.body.status).toBe("unpaid");
        expect(await ExpenseTx.countDocuments({})).toBe(0);
    });

    test("a bill with no amount asks for one when paid", async () => {
        const auth = await signUp();
        const e = (await add(auth, { amount: "" })).body;
        expect((await request(app).post(`/bills/${e.id}/pay`).set(auth).send({})).status).toBe(400);
        const ok = await request(app).post(`/bills/${e.id}/pay`).set(auth).send({ amount: 500, date: "2026-06-09" });
        expect(ok.body.bill).toMatchObject({ paidAmount: 500, paidAt: "2026-06-09" });
        expect((await request(app).post(`/bills/${e.id}/pay`).set(auth).send({ amount: 5, date: "2026-07-30" })).status).toBe(409);
    });

    test("a monthly bill makes next month's when paid", async () => {
        const auth = await signUp();
        const e = (await add(auth, { repeat: true, dueDate: "2026-06-30" })).body;
        const r = (await request(app).post(`/bills/${e.id}/pay`).set(auth).send({})).body;
        expect(r.next).toMatchObject({ dueDate: "2026-07-30", status: "unpaid", repeat: true, account: "150322009" });
        expect((await request(app).get("/bills").set(auth)).body.bills).toHaveLength(2);
    });

    test("reads pasted bill text", async () => {
        const auth = await signUp();
        const r = await request(app).post("/bills/read").set(auth).send({ text: "Consumer No: 1503220091\nAmount Payable: Rs. 640\nDue Date: 12/06/2026" });
        expect(r.body).toMatchObject({ amount: 640, dueDate: "2026-06-12", account: "1503220091" });
        expect((await request(app).post("/bills/read").set(auth).send({ text: "" })).status).toBe(400);
    });
});

describe("daily Telegram note", () => {
    const run = async (now, sent) => bills.dailyNote({ now, send: async (owner, text) => { sent.push(text); return true; } });

    test("goes once a day, from 09:00, only for overdue or due-soon bills, without the account number", async () => {
        const auth = await signUp();
        await add(auth, { name: "Soon", dueDate: "2026-06-12" });
        await add(auth, { name: "Late", dueDate: "2026-06-08" });
        await add(auth, { name: "Far", dueDate: "2026-07-20" });
        const sent = [];
        expect(await run(at(TODAY, "08:30"), sent)).toBe(0);          // too early
        expect(await run(at(TODAY, "09:05"), sent)).toBe(1);
        expect(sent[0]).toContain("Soon"); expect(sent[0]).toContain("Late"); expect(sent[0]).not.toContain("Far");
        expect(sent[0]).toContain("overdue by 2 days");
        expect(sent[0]).not.toContain("150322009");
        expect(await run(at(TODAY, "15:00"), sent)).toBe(0);          // already told today
        expect(await run(at("2026-06-11", "09:00"), sent)).toBe(1);   // and again the next day
        expect(sent).toHaveLength(2);
    });

    test("a failed send is tried again later the same day, and paid bills are not mentioned", async () => {
        const auth = await signUp();
        const a = (await add(auth, { name: "Gas" })).body;
        await add(auth, { name: "Net", dueDate: "2026-06-11" });
        await request(app).post(`/bills/${a.id}/pay`).set(auth).send({});
        expect(await bills.dailyNote({ now: at(TODAY, "10:00"), send: async () => false })).toBe(0);
        const sent = [];
        expect(await run(at(TODAY, "10:01"), sent)).toBe(1);
        expect(sent[0]).toContain("Net"); expect(sent[0]).not.toContain("Gas");
    });
});
