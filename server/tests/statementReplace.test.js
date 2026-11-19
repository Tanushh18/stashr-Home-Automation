// A new statement replaces the older ones it covers (so the database does not fill with copies of one period).
const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
process.env.SECRET_KEY = "test-secret";
process.env.CRYPTO_SECRET_KEY = "test-crypto-secret";
const Statement = require("../models/expenseStatement");
const Line = require("../models/expenseStatementLine");
const saved = require("../utils/statementSearch");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { await Statement.deleteMany({}); await Line.deleteMany({}); });

const owner = new mongoose.Types.ObjectId();
const key = Buffer.alloc(32, 7);
const L = (date, amount, desc = "Shop") => ({ date, desc, amount, type: "Debit", balance: null, ref: "" });

describe("saved statements are replaced, not piled up", () => {
    test("a newer statement over the same period removes the old one", async () => {
        await saved.saveStatement(owner, key, { filename: "oct.xlsx", lines: [L("2026-10-02", 100), L("2026-10-20", 200)] });
        const fresh = await saved.saveStatement(owner, key, { filename: "oct2.xlsx", lines: [L("2026-10-01", 50), L("2026-10-30", 300)] });
        expect(fresh.replaced).toBe(1);
        const list = await saved.listStatements(owner);
        expect(list.statements.length).toBe(1);
        expect(list.statements[0].filename).toBe("oct2.xlsx");
        expect(await Line.countDocuments({ owner })).toBe(2);
    });
    test("an older statement that reaches further back keeps its other months", async () => {
        await saved.saveStatement(owner, key, { filename: "long.xlsx", lines: [L("2026-08-05", 10), L("2026-09-05", 20), L("2026-10-05", 30)] });
        const fresh = await saved.saveStatement(owner, key, { filename: "oct.xlsx", lines: [L("2026-10-01", 5), L("2026-10-31", 6)] });
        expect(fresh.replaced).toBe(0);
        expect((await saved.listStatements(owner)).statements.length).toBe(2);
    });
});
