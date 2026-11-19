// Money Brain through the API: insights, budgets, plain-word questions, learned category suggestions.
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
const ExpenseStatement = require("../models/expenseStatement");
const ExpenseStatementLine = require("../models/expenseStatementLine");
const stores = require("../utils/expenseStore");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { for (const M of [User, ExpenseSettings, ExpenseTx, ExpenseStatement, ExpenseStatementLine]) await M.deleteMany({}); });

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


describe("money brain over the API", () => {
    test("insights, budgets, ask and suggestions work end to end", async () => {
        const auth = await signUp();
        await request(app).post("/expenses/start").set(auth).send({ date: recent(30) });
        await seed([
            { merchant: "swiggy order (a1@ybl)", amount: 300, category: "Food" }, { merchant: "swiggy instamart (a2@ybl)", amount: 200, category: "Food" },
            { merchant: "swiggy genie (a3@ybl)", amount: 150 }, { merchant: "Client A", amount: 9000, type: "Credit" }]);
        const ins = await request(app).get("/expenses/insights").set(auth);
        expect(ins.status).toBe(200);
        expect(["healthy", "watch", "alert"].includes(ins.body.verdict)).toBe(true);
        expect(ins.body.thisMonth.income >= 0).toBe(true);
        expect(ins.body.suggestions.some((x) => x.category === "Food")).toBe(true);

        const b = await request(app).put("/expenses/budgets").set(auth).send({ budgets: { Food: 400, "": 5, Bad: -1 } });
        expect(b.body.budgets).toEqual({ Food: 400 });
        const again = await request(app).get("/expenses/insights").set(auth);
        expect(again.body.budgets[0].category).toBe("Food");

        const q = await request(app).get("/expenses/ask").set(auth).query({ q: "how much did I spend on food this month" });
        expect(q.body.answer).toMatch(/Food/);

        const ap = await request(app).post("/expenses/suggestions/apply").set(auth).send({});
        expect(ap.body.updated).toBe(1);
        const al = await request(app).post("/expenses/alerts/run").set(auth).send({});
        expect(al.status).toBe(200);
    });
});
