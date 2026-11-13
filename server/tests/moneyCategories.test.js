// Sorting payments: one choice sorts everything to or from the same place (past and future), and the unsorted payments come in groups.
const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
process.env.RATE_LIMIT_MAX = "1000";
process.env.ALLOW_SIGNUP = "true";

const app = require("../app");
const User = require("../models/schema");
const ExpenseSettings = require("../models/expenseSettings");
const ExpenseTx = require("../models/expenseTx");
const ex = require("../utils/expenses");
const stores = require("../utils/expenseStore");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { for (const M of [User, ExpenseSettings, ExpenseTx]) await M.deleteMany({}); });

const signUp = async () => {
    await request(app).post("/register").send({ name: "Ana", email: "ana@example.com", password: "master-pass", cpassword: "master-pass" });
    const r = await request(app).post("/login").send({ email: "ana@example.com", password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${r.body.token}` };
};
const recent = (n) => new Date(Date.now() - n * 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);       // n days ago, India date
/** Puts entries straight into the account's store. */
async function seed(list) {
    const user = await User.findOne({ email: "ana@example.com" });
    const st = stores.dbStore(user._id, await user.getDataKey());
    let n = 0;
    await st.append(list.map((e) => ex.makeTx({ date: recent(e.days ?? 3), time: `10:0${n % 10}`, amount: e.amount, type: e.type || "Debit", counterparty: e.merchant, method: "UPI", ref: String(700000000000 + n++) }, e.category || "Uncategorized", "SMS", "Verified", "", 0, [])));
    return st;
}
const list = async (auth) => (await request(app).get("/expenses").set(auth)).body;

describe("one choice sorts every payment to the same place", () => {
    test("by the UPI id: past entries with other names and other bank handles follow, other people do not", async () => {
        const auth = await signUp();
        await request(app).post("/expenses/start").set(auth).send({ date: recent(30) });
        const st = await seed([
            { merchant: "durgesh tea (q469914584@ybl)", amount: 10 }, { merchant: "DURGESH T (q469914584@okaxis)", amount: 20, days: 5 },
            { merchant: "somebody else (q111111111@ybl)", amount: 30 }, { merchant: "No Remark", amount: 40 }, { merchant: "No Remark", amount: 50, days: 4 }]);
        const all = await st.list();
        const first = all.find((t) => t.merchant.startsWith("durgesh"));
        const r = await request(app).put("/expenses/category").set(auth).send({ index: first.index, category: "Friends", remember: true });
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ updated: 2, others: 1, rule: "q469914584" });
        const after = await st.list();
        expect(after.filter((t) => t.category === "Friends").map((t) => t.amount).sort()).toEqual([10, 20]);
        expect(after.find((t) => t.merchant.startsWith("somebody")).category).toBe("Uncategorized");
        // a payment that arrives later is sorted by the saved rule
        const rules = (await ExpenseSettings.findOne({}).lean()).rules;
        expect(ex.categorize("durgesh tea (q469914584@ybl)", "Debit", "UPI", rules)).toBe("Friends");
    });
    test("an entry that already had another category follows too (the choice is for that place, whatever it was before)", async () => {
        const auth = await signUp();
        await request(app).post("/expenses/start").set(auth).send({ date: recent(30) });
        const st = await seed([{ merchant: "Kesar Rajwad (kesarr@ybl)", amount: 290, category: "Food" }, { merchant: "Kesar Rajwad (kesarr@ybl)", amount: 150 }]);
        const row = (await st.list()).find((t) => t.amount === 150);
        await request(app).put("/expenses/category").set(auth).send({ index: row.index, category: "Groceries", remember: true });
        expect((await st.list()).every((t) => t.category === "Groceries")).toBe(true);
    });
    test("a name that says nothing is never made a rule: only that payment changes", async () => {
        const auth = await signUp();
        await request(app).post("/expenses/start").set(auth).send({ date: recent(30) });
        const st = await seed([{ merchant: "No Remark", amount: 40 }, { merchant: "No Remark", amount: 50 }]);
        const row = (await st.list())[0];
        const r = await request(app).put("/expenses/category").set(auth).send({ index: row.index, category: "Friends", remember: true });
        expect(r.body).toMatchObject({ updated: 1, others: 0, rule: "" });
        expect((await st.list()).filter((t) => t.category === "Friends").length).toBe(1);
    });
});

describe("the payments not sorted yet, in groups", () => {
    test("grouped by who they went to, biggest first, with the sample to sort the whole group", async () => {
        const auth = await signUp();
        await request(app).post("/expenses/start").set(auth).send({ date: recent(30) });
        await seed([
            { merchant: "Ramesh (paytm. s3wsjf6@pty)", amount: 100 }, { merchant: "RAMESH K (s3wsjf6@ptyes)", amount: 250, days: 5 },
            { merchant: "ANCHAL DASS (bittudas18451@ybl)", amount: 1100 }, { merchant: "No Remark", amount: 340, type: "Credit" }, { merchant: "No Remark", amount: 2100, type: "Credit", days: 4 },
            { merchant: "Swiggy", amount: 99, category: "Food" }]);
        const g = (await request(app).get("/expenses/uncategorized").set(auth)).body;
        expect(g.total).toBe(5);
        expect(g.groups.length).toBe(4);                                          // Ramesh (2 together), Anchal, and the two "No Remark" one by one
        const ramesh = g.groups.find((x) => x.key === "s3wsjf6");
        expect(ramesh).toMatchObject({ count: 2, debit: 350, remembers: true });
        expect(g.groups.filter((x) => !x.remembers).length).toBe(2);
        expect(g.groups[0].key.startsWith("one:") || g.groups[0].debit + g.groups[0].credit >= g.groups[1].debit + g.groups[1].credit).toBe(true);
        // sorting the group through its sample sorts both entries
        const r = await request(app).put("/expenses/category").set(auth).send({ index: ramesh.index, category: "Friends", remember: true });
        expect(r.body.updated).toBe(2);
        expect((await request(app).get("/expenses/uncategorized").set(auth)).body.total).toBe(3);
    });
    test("entries the statement set aside are not asked about", async () => {
        const auth = await signUp();
        await request(app).post("/expenses/start").set(auth).send({ date: recent(30) });
        const st = await seed([{ merchant: "Ghost (ghostpay@ybl)", amount: 77 }, { merchant: "Real (realpay@ybl)", amount: 88 }]);
        const ghost = (await st.list()).find((t) => t.merchant.startsWith("Ghost"));
        await st.updateMany([{ index: ghost.index, fields: { status: "Not in statement" }, tx: ghost }]);
        const g = (await request(app).get("/expenses/uncategorized").set(auth)).body;
        expect(g.total).toBe(1);
        expect(g.groups[0].key).toBe("realpay");
    });
});
