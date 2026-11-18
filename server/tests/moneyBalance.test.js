const { describe, test } = require("node:test");
const expect = require("./expect");
process.env.SECRET_KEY = process.env.SECRET_KEY || "test-secret";
process.env.CRYPTO_SECRET_KEY = process.env.CRYPTO_SECRET_KEY || "test-crypto-secret";
const ex = require("../utils/expenses");
const bal = require("../utils/moneyBalance");

const tx = (o) => ({ index: String(Math.random()), time: "", merchant: "", category: "Uncategorized", account: "X9229", method: "UPI", ref: "", balance: null, source: "SMS", status: "Unverified", note: "", flags: [], ...o, month: o.date.slice(0, 7) });

describe("SMS parsing keeps the balance", () => {
    const cases = [
        ["Debited Rs 100.00 from a/c X9229 on 21Oct26 19:42 via UPI to Meta Verifie. Ref 629482059838.Bal Rs 2507.75. -Federal Bank", { amount: 100, type: "Debit", balance: 2507.75, ref: "629482059838" }],
        ["Credited Rs 55,000.00 to a/c X9229 on 01Nov26 09:00 via NEFT from ACME PAYROLL. Ref N123456789.Bal Rs 57,507.75 -Federal Bank", { amount: 55000, type: "Credit", balance: 57507.75 }],
        ["Rs.1,250.50 debited from A/c XX9229 on 03-11-2026 via POS at AMAZON. Avl Bal INR 56,257.25", { amount: 1250.5, type: "Debit", balance: 56257.25 }],
        ["Debited INR 20 from account 9229 on 04/11/26. Balance: Rs 56237.25", { amount: 20, type: "Debit" }]
    ];
    cases.forEach(([body, want], i) => test(`variant ${i + 1}`, () => {
        const p = ex.parseSms(body);
        expect(p).not.toBeNull();
        for (const [k, v] of Object.entries(want)) expect(p[k]).toBe(v);
    }));
    test("a message whose balance does not follow is flagged, one that follows is not", () => {
        const a = ex.parseSms("Debited Rs 100.00 from a/c X9229 on 21Oct26 19:42 via UPI to Shop. Ref 629482059838.Bal Rs 2507.75 -Federal Bank");
        const ctx = { sender: "VM-FEDBNK-S", receivedAt: Date.parse("2026-10-21T14:12:00Z"), knownAccounts: ["X9229"], now: Date.parse("2026-10-22T04:00:00Z") };
        expect(ex.assess(a, { ...ctx, lastBalance: 2607.75 })).toEqual([]);
        expect(ex.assess(a, { ...ctx, lastBalance: 9999 }).join()).toMatch(/does not follow/);
    });
});

describe("one payment is never shown twice", () => {
    test("same reference written differently", () => {
        expect(ex.isTwin(tx({ date: "2026-10-21", type: "Debit", amount: 100, ref: "0629482059838" }), tx({ date: "2026-10-21", type: "Debit", amount: 100, ref: "629482059838" }))).toBe(true);
    });
    test("two messages with different references but the same balance-after are one payment", () => {
        const a = tx({ date: "2026-10-21", time: "19:42", type: "Debit", amount: 100, ref: "111111111111", balance: 2507.75 });
        const b = tx({ date: "2026-10-21", time: "19:43", type: "Debit", amount: 100, ref: "222222222222", balance: 2507.75 });
        expect(ex.isTwin(a, b)).toBe(true);
    });
    test("an SMS and a statement line (no time, no reference) are one payment", () => {
        expect(ex.isTwin(tx({ date: "2026-10-21", time: "19:42", type: "Debit", amount: 100, merchant: "Meta Verifie", ref: "629482059838" }), tx({ date: "2026-10-21", type: "Debit", amount: 100, merchant: "Meta Verified", source: "Statement" }))).toBe(true);
    });
    test("two real payments of the same amount stay two", () => {
        const a = tx({ date: "2026-10-21", time: "10:00", type: "Debit", amount: 100, ref: "111111111111", balance: 900 });
        const b = tx({ date: "2026-10-21", time: "18:00", type: "Debit", amount: 100, ref: "222222222222", balance: 800 });
        expect(ex.isTwin(a, b)).toBe(false);
        expect(ex.findDuplicates([a, b])).toEqual([]);
    });
    test("findDuplicates keeps the bank-verified one and hands over the missing detail", () => {
        const sms = tx({ date: "2026-10-21", time: "19:42", type: "Debit", amount: 100, merchant: "Meta", ref: "629482059838", balance: 2507.75 });
        const stm = tx({ date: "2026-10-21", type: "Debit", amount: 100, merchant: "Meta", status: "Verified", source: "Statement", balance: 2507.75 });
        const g = ex.findDuplicates([sms, stm]);
        expect(g.length).toBe(1);
        expect(g[0].keep).toBe(stm); expect(g[0].remove).toEqual([sms]);
        expect(g[0].fill.ref).toBe("629482059838"); expect(g[0].fill.time).toBe("19:42");
    });
});

describe("balance report and salary", () => {
    const lines = [
        { date: "2026-10-30", desc: "x", amount: 100, type: "Debit", balance: 5000 },
        { date: "2026-10-31", desc: "y", amount: 500, type: "Debit", balance: 4500 }
    ];
    const rows = [
        tx({ date: "2026-11-01", time: "09:00", type: "Credit", amount: 50000, merchant: "ACME PAYROLL", category: "Salary", balance: 54500 }),
        tx({ date: "2026-11-02", time: "10:00", type: "Debit", amount: 1000, merchant: "Shop", balance: 53500 }),
        tx({ date: "2026-11-03", time: "10:00", type: "Debit", amount: 500, merchant: "Cafe", balance: 53000 })
    ];
    test("last month's closing + this month = what the bank says", () => {
        const r = bal.balanceReport(rows, lines, { month: "2026-11", today: "2026-11-05" });
        expect(r.opening.balance).toBe(4500); expect(r.opening.from).toBe("statement");
        expect(r.credits).toBe(50000); expect(r.debits).toBe(1500);
        expect(r.expectedBalance).toBe(53000);
        expect(r.bankSays.balance).toBe(53000);
        expect(r.difference).toBe(0); expect(r.match).toBe(true);
    });
    test("a missing payment shows as a difference, and the owner's bank figure can be compared", () => {
        const r = bal.balanceReport(rows.slice(0, 2), lines, { month: "2026-11", today: "2026-11-05", bank: 53000 });
        expect(r.expectedBalance).toBe(53500); expect(r.difference).toBe(500); expect(r.match).toBe(false);
        expect(r.hint).toMatch(/₹500\.00 more/);
    });
    test("set-aside entries are not counted but are reported", () => {
        const r = bal.balanceReport([...rows, tx({ date: "2026-11-04", type: "Debit", amount: 77, status: "Flagged" })], lines, { month: "2026-11", today: "2026-11-05" });
        expect(r.debits).toBe(1500); expect(r.doubtful.count).toBe(1); expect(r.doubtful.debit).toBe(77);
    });
    test("no statement: the opening comes from the first message's balance", () => {
        const r = bal.balanceReport(rows, [], { month: "2026-11", today: "2026-11-05" });
        expect(r.opening.balance).toBe(4500); expect(r.opening.from).toBe("message"); expect(r.match).toBe(true);
    });
    test("salary cycle: salary minus everything after it", () => {
        const r = bal.balanceReport(rows, lines, { month: "2026-11", today: "2026-11-05" });
        expect(r.salary.received).toBe(50000); expect(r.salary.spent).toBe(1500); expect(r.salary.left).toBe(48500); expect(r.salary.days).toBe(4);
        expect(ex.isSalary(tx({ date: "2026-11-01", type: "Credit", amount: 1, merchant: "Monthly salary Nov" }))).toBe(true);
        expect(ex.isSalary(tx({ date: "2026-11-01", type: "Debit", amount: 1, merchant: "salary" }))).toBe(false);
        expect(ex.categorize("ACME payroll", "Credit", "NEFT")).toBe("Salary");
    });
});
