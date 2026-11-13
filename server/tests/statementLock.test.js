// Locked statements (password asked and checked), choosing the month, and saved statements that can be searched later.
const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");
const fs = require("fs");
const path = require("path");

process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
process.env.RATE_LIMIT_MAX = "1000";
process.env.ALLOW_SIGNUP = "true";

const app = require("../app");
const User = require("../models/schema");
const ExpenseSettings = require("../models/expenseSettings");
const ExpenseTx = require("../models/expenseTx");
const Statement = require("../models/expenseStatement");
const Line = require("../models/expenseStatementLine");
const { agileLock } = require("./helpers/agileLock");

const LOCKED = fs.readFileSync(path.join(__dirname, "fixtures", "statement-locked.xlsx"));      // made by LibreOffice, password secret123
const PLAIN = fs.readFileSync(path.join(__dirname, "fixtures", "statement-plain.xlsx"));

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { for (const M of [User, ExpenseSettings, ExpenseTx, Statement, Line]) await M.deleteMany({}); });

const signUp = async (email = "ana@example.com") => {
    await request(app).post("/register").send({ name: "Ana", email, password: "master-pass", cpassword: "master-pass" });
    const r = await request(app).post("/login").send({ email, password: "master-pass", client: "mobile" });
    return { Authorization: `Bearer ${r.body.token}` };
};
const upload = (auth, bytes, { query = "", password } = {}) => {
    const r = request(app).post(`/expenses/statement?async=1&filename=s.xlsx${query}`).set(auth).set("Content-Type", "application/octet-stream");
    if (password !== undefined) r.set("X-Statement-Password", encodeURIComponent(password));
    return r.send(bytes);
};
async function finish(auth, job) {
    for (let i = 0; i < 100; i++) {
        const { job: j } = (await request(app).get(`/expenses/statement/status?job=${job.id}`).set(auth)).body;
        if (j.status === "done" || j.status === "failed") return j;
        await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error("the statement check did not finish");
}
const csv = (rows) => Buffer.from(["Date,Particulars,Withdrawals,Deposits,Balance", ...rows].join("\n"));
const search = async (auth, q, extra = "") => (await request(app).get(`/expenses/statement/search?q=${encodeURIComponent(q)}${extra}`).set(auth)).body;

/** The tests pretend it is mid-November 2026, so the 4-month rule keeps the November lines whenever CI runs. */
async function atNovember(fn) {
    const realNow = Date.now;
    try { return await fn((v) => { Date.now = () => Date.parse(v || "2026-11-14T06:00:00Z"); }); } finally { Date.now = realNow; }
}

describe("a locked statement", () => {
    test("without the password it asks for it; a wrong one is refused; the right one opens it and the check runs", async () => {
        await atNovember(async (pretend) => {
            const auth = await signUp(); pretend();
            const ask = await upload(auth, LOCKED);
            expect(ask.status).toBe(422);
            expect(ask.body.code).toBe("password_required");
            const bad = await upload(auth, LOCKED, { password: "nope" });
            expect(bad.status).toBe(422);
            expect(bad.body.code).toBe("wrong_password");
            expect(await Line.countDocuments({})).toBe(0);                      // nothing was saved by the failed tries
            const ok = await upload(auth, LOCKED, { password: "secret123" });
            expect(ok.status).toBe(202);
            const job = await finish(auth, ok.body.job);
            expect(job.status).toBe("done");
            expect(job.report.lines).toBe(3);
            expect(job.report.saved).toBe(3);
        });
    });
    test("the password is not kept anywhere: not in the database, not in the job", async () => {
        await atNovember(async (pretend) => {
            const auth = await signUp(); pretend();
            const ok = await upload(auth, LOCKED, { password: "secret123" });
            const job = await finish(auth, ok.body.job);
            expect(JSON.stringify(job)).not.toMatch(/secret123/);
            for (const M of [ExpenseSettings, Statement, Line, ExpenseTx]) expect(JSON.stringify(await M.find({}).lean())).not.toMatch(/secret123/);
        });
    });
    test("a non-ASCII password works (it travels URL-encoded in a header)", async () => {
        await atNovember(async (pretend) => {
            const auth = await signUp(); pretend();
            const locked = agileLock(PLAIN, "pässwörd ₹9");
            expect((await upload(auth, locked)).body.code).toBe("password_required");
            const ok = await upload(auth, locked, { password: "pässwörd ₹9" });
            expect(ok.status).toBe(202);
            expect((await finish(auth, ok.body.job)).status).toBe("done");
        });
    });
    test("an old .xls file and a PDF are explained, not read", async () => {
        const auth = await signUp();
        const old = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(1024, 1)]);
        const r = await upload(auth, old);
        expect(r.status).toBe(400); expect(r.body.error).toMatch(/\.xlsx or \.csv/);
        expect((await request(app).post("/expenses/statement?filename=s.pdf").set(auth).set("Content-Type", "application/octet-stream").send(Buffer.from("%PDF-1.7"))).status).toBe(400);
    });
});

describe("choosing the month", () => {
    const rows = ["03-10-2026,UPI/DR/111111111111/OCTOBER SHOP,100.00,,900.00", "05-11-2026,UPI/DR/222222222222/NOVEMBER SHOP,200.00,,700.00", "09-11-2026,UPI/DR/333333333333/ANOTHER NOV SHOP,50.00,,650.00"];
    test("only that month's lines are matched and saved", async () => {
        await atNovember(async (pretend) => {
            const auth = await signUp(); pretend();
            const r = await request(app).post("/expenses/statement?filename=s.csv&month=2026-11").set(auth).set("Content-Type", "application/octet-stream").send(csv(rows));
            expect(r.status).toBe(200);
            expect(r.body.report.lines).toBe(2);
            expect(r.body.report.from).toBe("2026-11-05");
            expect((await search(auth, "shop")).total).toBe(2);
            expect((await search(auth, "october")).total).toBe(0);
            const tx = await ExpenseTx.find({}).lean();
            expect(tx.every((t) => t.month === "2026-11")).toBe(true);           // October's entry was not added
        });
    });
    test("a month the statement does not have is explained, and a bad month is refused", async () => {
        await atNovember(async (pretend) => {
            const auth = await signUp(); pretend();
            const none = await request(app).post("/expenses/statement?filename=s.csv&month=2026-09").set(auth).set("Content-Type", "application/octet-stream").send(csv(rows));
            expect(none.status).toBe(400); expect(none.body.error).toMatch(/no transactions in 2026-09/); expect(none.body.error).toMatch(/2026-10-03 to 2026-11-09/);
            expect((await request(app).post("/expenses/statement?filename=s.csv&month=nonsense").set(auth).set("Content-Type", "application/octet-stream").send(csv(rows))).status).toBe(400);
            expect(await Line.countDocuments({})).toBe(0);
        });
    });
    test("with no month the whole statement is used", async () => {
        await atNovember(async (pretend) => {
            const auth = await signUp(); pretend();
            const r = await request(app).post("/expenses/statement?filename=s.csv").set(auth).set("Content-Type", "application/octet-stream").send(csv(rows));
            expect(r.body.report.lines).toBe(3);
            expect((await search(auth, "shop")).total).toBe(3);
        });
    });
});

describe("searching the saved statements", () => {
    const rows = ["01-11-2026,UPI/DR/613112345678/Meta Verifie/pay,1200.50,,48799.50", "02-11-2026,UPI/DR/613112345679/Ramesh Kumar/food,350.00,,48449.50", "03-11-2026,NEFT salary ACME LTD,,60000.00,108449.50", "04-11-2026,UPI/DR/613112345681/Rameshwar Traders/goods,350.00,,108099.50"];
    async function saved() {
        const auth = await signUp();
        await request(app).post("/expenses/statement?filename=nov.csv").set(auth).set("Content-Type", "application/octet-stream").send(csv(rows));
        return auth;
    }
    test("by name (a little forgiving), by amount, by range and by reference, with no expiry", async () => {
        await atNovember(async (pretend) => {
            pretend(); const auth = await saved();
            // kept until the owner deletes it: no expiry index on either collection
            for (const M of [Statement, Line]) expect(M.schema.indexes().some(([, o]) => o && o.expireAfterSeconds !== undefined)).toBe(false);
            expect((await search(auth, "ramesh")).results.map((r) => r.desc.split("/")[3] || r.desc).sort()).toEqual(["Ramesh Kumar", "Rameshwar Traders"]);
            expect((await search(auth, "rmesh kumr")).results.length).toBe(1);
            expect((await search(auth, "meta verify")).results[0].amount).toBe(1200.5);
            expect((await search(auth, "350")).total).toBe(2);
            expect((await search(auth, "ramesh 350")).total).toBe(2);
            expect((await search(auth, "₹1,200.50")).total).toBe(1);
            expect((await search(auth, "1000-2000")).total).toBe(1);
            expect((await search(auth, ">50000")).results[0].desc).toMatch(/ACME/);
            expect((await search(auth, "613112345679")).results[0].desc).toMatch(/Ramesh/);
            expect((await search(auth, "zzzz")).total).toBe(0);
            expect((await search(auth, "")).total).toBe(0);
            expect((await search(auth, "ramesh", "&month=2026-10")).total).toBe(0);
            expect((await search(auth, "ramesh", "&month=2026-11")).total).toBe(2);
        });
    });
    test("the list shows each statement and the months saved; uploading it again does not double the lines", async () => {
        await atNovember(async (pretend) => {
            pretend(); const auth = await saved();
            await request(app).post("/expenses/statement?filename=nov-again.csv").set(auth).set("Content-Type", "application/octet-stream").send(csv(rows));
            const list = (await request(app).get("/expenses/statement/saved").set(auth)).body;
            expect(list.statements.length).toBe(1);                              // the first upload's lines all moved to the newest one
            expect(list.statements[0]).toMatchObject({ filename: "nov-again.csv", lines: 4, from: "2026-11-01", to: "2026-11-04" });
            expect(list.months).toEqual([{ month: "2026-11", lines: 4 }]);
            expect(await Line.countDocuments({})).toBe(4);
        });
    });
    test("the saved lines are encrypted in the database", async () => {
        await atNovember(async (pretend) => {
            pretend(); await saved();
            const raw = JSON.stringify(await Line.find({}).lean());
            // words with letters outside a-f cannot occur by chance in hex ciphertext, and the long numbers are far too specific to
            expect(raw).not.toMatch(/Ramesh|ACME|Meta Verifie|613112345679|1200\.5/);
            expect(raw).toMatch(/2026-11-02/);                                  // only the date and month stay readable
        });
    });
    test("delete a saved statement; nobody else can search or delete yours", async () => {
        await atNovember(async (pretend) => {
            pretend(); const auth = await saved();
            const other = await signUp("bob@example.com");
            expect((await search(other, "ramesh")).total).toBe(0);
            const id = (await request(app).get("/expenses/statement/saved").set(auth)).body.statements[0].id;
            expect((await request(app).delete(`/expenses/statement/saved/${id}`).set(other)).status).toBe(404);
            expect((await search(auth, "ramesh")).total).toBe(2);
            const del = await request(app).delete(`/expenses/statement/saved/${id}`).set(auth);
            expect(del.status).toBe(200); expect(del.body.removed).toBe(4);
            expect((await search(auth, "ramesh")).total).toBe(0);
            expect((await request(app).delete("/expenses/statement/saved/nope").set(auth)).status).toBe(404);
        });
    });
});
