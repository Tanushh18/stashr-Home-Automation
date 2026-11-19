const { describe, test } = require("node:test");
const expect = require("./expect");
process.env.SECRET_KEY = process.env.SECRET_KEY || "test-secret";
process.env.CRYPTO_SECRET_KEY = process.env.CRYPTO_SECRET_KEY || "test-crypto-secret";
const brain = require("../utils/moneyBrain");

const tx = (o) => ({ index: String(Math.random()), category: "Uncategorized", status: "Unverified", ref: "", ...o, month: o.date.slice(0, 7) });
const line = (o) => ({ balance: null, ref: "", ...o });

describe("Money Brain", () => {
    test("the statement is the truth for a month it covers", () => {
        const rows = [tx({ date: "2026-11-02", type: "Debit", amount: 999, category: "Food" })];
        const lines = [line({ date: "2026-11-01", type: "Credit", amount: 50000, balance: 50000 }), line({ date: "2026-11-02", type: "Debit", amount: 300, balance: 49700 })];
        const r = brain.analyze(rows, lines, { today: "2026-11-10" });
        expect(r.thisMonth.source).toBe("statement");
        expect(r.thisMonth.spend).toBe(300);
        expect(r.thisMonth.net).toBe(49700);
        expect(r.thisMonth.result).toBe("profit");
    });
    test("a loss month is an alert-worthy loss and own-pot moves are not spend", () => {
        const rows = [tx({ date: "2026-11-02", type: "Credit", amount: 1000 }), tx({ date: "2026-11-03", type: "Debit", amount: 5000, category: "Shopping" }), tx({ date: "2026-11-04", type: "Debit", amount: 7000, category: "Investments" })];
        const r = brain.analyze(rows, [], { today: "2026-11-10" });
        expect(r.thisMonth.source).toBe("entries");
        expect(r.thisMonth.result).toBe("loss");
        expect(r.thisMonth.spend).toBe(5000);
        expect(r.verdict).not.toBe("healthy");
        expect(r.actions.some((a) => a.id === "upload")).toBe(true);
    });
    test("doubtful entries are not counted", () => {
        const rows = [tx({ date: "2026-11-02", type: "Debit", amount: 400, status: "Flagged" })];
        expect(brain.analyze(rows, [], { today: "2026-11-10" }).thisMonth.spend).toBe(0);
    });
});
