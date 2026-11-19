const { describe, test } = require("node:test");
const expect = require("./expect");
process.env.SECRET_KEY = process.env.SECRET_KEY || "test-secret";
process.env.CRYPTO_SECRET_KEY = process.env.CRYPTO_SECRET_KEY || "test-crypto-secret";
const plan = require("../utils/moneyPlan");

let n = 0;
const tx = (o) => ({ index: String(++n), time: "", merchant: "", category: "Uncategorized", status: "Unverified", ref: "", ...o, month: o.date.slice(0, 7) });
const D = (o) => tx({ type: "Debit", ...o });
const C = (o) => tx({ type: "Credit", ...o });
const today = "2026-11-15";

describe("anomalies", () => {
    test("the same payee and amount twice within minutes is a double charge", () => {
        const rows = [D({ date: "2026-11-10", time: "10:00", amount: 499, merchant: "Netflix", ref: "1" }), D({ date: "2026-11-10", time: "10:03", amount: 499, merchant: "Netflix", ref: "2" })];
        expect(plan.anomalies(rows, { today }).some((a) => a.kind === "double")).toBe(true);
    });
    test("a payment far above the usual is large; a normal one is not", () => {
        const rows = [...Array.from({ length: 8 }, (_, i) => D({ date: `2026-11-0${i + 1}`, amount: 100, merchant: "Tea" })), D({ date: "2026-11-12", amount: 9000, merchant: "Gadget Shop" })];
        const a = plan.anomalies(rows, { today });
        expect(a.filter((x) => x.kind === "large").length).toBe(1);
    });
});

describe("recurring payments", () => {
    test("the same amount to the same payee in several months is monthly, and the next date is in the future", () => {
        const rows = ["2026-08-05", "2026-09-05", "2026-10-05"].map((date) => D({ date, amount: 15000, merchant: "Landlord Sharma" }));
        const r = plan.recurring(rows, { today });
        expect(r.length).toBe(1);
        expect(r[0].next).toBe("2026-12-05");
    });
    test("several payments in one month are not a monthly habit", () => {
        const rows = [D({ date: "2026-11-01", amount: 50, merchant: "Chai Point" }), D({ date: "2026-11-02", amount: 50, merchant: "Chai Point" })];
        expect(plan.recurring(rows, { today }).length).toBe(0);
    });
});

describe("budgets", () => {
    const rows = [D({ date: "2026-11-02", amount: 850, category: "Food" }), D({ date: "2026-11-03", amount: 400, category: "Travel" })];
    test("levels ok / near / over", () => {
        const s = plan.budgetStatus(rows, { Food: 1000, Travel: 300, Health: 500 }, "2026-11");
        expect(s.find((b) => b.category === "Food").level).toBe("near");
        expect(s.find((b) => b.category === "Travel").level).toBe("over");
        expect(s.find((b) => b.category === "Health").level).toBe("ok");
    });
    test("each alert is sent once per month and level", () => {
        const s = plan.budgetStatus(rows, { Food: 1000 }, "2026-11");
        const first = plan.dueAlerts(s, "2026-11", {});
        expect(first.length).toBe(1);
        expect(plan.dueAlerts(s, "2026-11", { [first[0].key]: true }).length).toBe(0);
    });
    test("going straight to over says only over", () => {
        const s = plan.budgetStatus(rows, { Travel: 300 }, "2026-11");
        const due = plan.dueAlerts(s, "2026-11", {});
        expect(due.filter((d) => d.text).length).toBe(1);
        expect(due.find((d) => d.text).text).toMatch(/over budget/);
    });
});

describe("salary forecast and goals", () => {
    test("what is safe to spend per day until the next salary, after bills that fall due", () => {
        const cycle = { date: "2026-11-01", left: 12000, previous: [{ date: "2026-10-01" }, { date: "2026-09-01" }] };
        const rec = [{ payee: "Rent", amount: 3000, next: "2026-11-20" }];
        const f = plan.salaryForecast(cycle, rec, { today });
        expect(f.nextSalary).toBe("2026-12-01");
        expect(f.daysToSalary).toBe(16);
        expect(f.dueBills).toBe(3000);
        expect(f.safePerDay).toBe(562.5);
        expect(f.status).toBe("fine");
    });
    test("goals say how many months are left", () => {
        const g = plan.goalProgress([{ name: "Bike", target: 50000, saved: 20000 }], 7500);
        expect(g[0].months).toBe(4);
        expect(plan.goalProgress([{ name: "x", target: 100 }], 0)[0].months).toBe(null);
    });
});

describe("meta ads, learning and questions", () => {
    test("ad spend against income that is not salary", () => {
        const rows = [D({ date: "2026-10-03", amount: 2000, category: "Meta Ads", merchant: "Meta Verifie" }), C({ date: "2026-10-09", amount: 5000, merchant: "Client A" }), C({ date: "2026-10-01", amount: 60000, merchant: "ACME PAYROLL", category: "Salary" })];
        const m = plan.metaAds(rows);
        expect(m[0].adSpend).toBe(2000);
        expect(m[0].otherIncome).toBe(5000);
        expect(m[0].roi).toBe(2.5);
    });
    test("an unsorted payee follows the category similar payees already have", () => {
        const rows = [D({ date: "2026-10-01", amount: 200, merchant: "swiggy order", category: "Food" }), D({ date: "2026-10-02", amount: 250, merchant: "swiggy instamart", category: "Food" }), D({ date: "2026-11-02", amount: 300, merchant: "Swiggy Genie" })];
        const s = plan.suggestCategories(rows);
        expect(s[0].category).toBe("Food");
    });
    test("plain-word questions are answered from the numbers", () => {
        const rows = [D({ date: "2026-10-02", amount: 300, category: "Food", merchant: "Cafe" }), D({ date: "2026-10-09", amount: 200, category: "Food", merchant: "Dhaba" }), C({ date: "2026-10-01", amount: 1000, merchant: "Pay" })];
        expect(plan.ask("how much did I spend on food last month", rows, { today }).answer).toMatch(/₹500 on Food last month/);
        expect(plan.ask("income in october", rows, { today }).answer).toMatch(/₹1000/);
        expect(plan.ask("profit last month", rows, { today }).answer).toMatch(/profit of ₹500/);
        expect(plan.ask("gibberish", rows, { today }).answer).toBe(null);
    });
});
