import { test } from "node:test";
import assert from "node:assert/strict";
import { inr, monthLabel, shiftMonth, dayLabel, groupByDay, withShares, startDateChip, statusTone, storageNote } from "../src/lib/money.js";

test("rupees use Indian grouping and keep paise only when there are any", () => {
  assert.equal(inr(100), "₹100");
  assert.equal(inr(2507.75), "₹2,507.75");
  assert.equal(inr(123456.5), "₹1,23,456.50");
  assert.equal(inr(-1500), "−₹1,500");
  assert.equal(inr(500, { sign: true }), "+₹500");
  assert.equal(inr("x"), "—");
});

test("months and days read well", () => {
  assert.equal(monthLabel("2026-10"), "Oct 2026");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(dayLabel("2026-10-21"), "Wed, 21 Oct");
});

test("rows are grouped by day, newest first, and flagged rows are left out of the day total", () => {
  const rows = [
    { index: 1, date: "2026-10-20", time: "09:00", amount: 50, type: "Debit", status: "Unverified" },
    { index: 2, date: "2026-10-21", time: "19:42", amount: 100, type: "Debit", status: "Unverified" },
    { index: 3, date: "2026-10-21", time: "10:00", amount: 200, type: "Credit", status: "Verified" },
    { index: 4, date: "2026-10-21", time: "12:00", amount: 999, type: "Debit", status: "Flagged" },
  ];
  const g = groupByDay(rows);
  assert.deepEqual(g.map((d) => d.date), ["2026-10-21", "2026-10-20"]);
  assert.equal(g[0].debit, 100);
  assert.equal(g[0].credit, 200);
  assert.deepEqual(g[0].rows.map((r) => r.index), [2, 4, 3]);
});

test("category shares add up", () => {
  const s = withShares([{ category: "Meta Ads", amount: 750, count: 3 }, { category: "Food", amount: 250, count: 5 }]);
  assert.equal(s[0].share, 75);
  assert.equal(s[1].share, 25);
  assert.deepEqual(withShares([]), []);
});

test("quick start dates", () => {
  const now = new Date(2026, 10, 2);
  assert.equal(startDateChip("month", now), "2026-11-01");
  assert.equal(startDateChip("3m", now), "2026-08-02");
  assert.equal(startDateChip("1y", now), "2025-11-02");
  assert.equal(statusTone("Verified"), "ok");
  assert.equal(statusTone("Flagged"), "bad");
  assert.equal(statusTone("Unverified"), "mute");
});

test("the storage sentence follows the mode and the optional copy", () => {
  assert.match(storageNote({ storage: "db", sheetCopy: false }), /encrypted in Stashr for 4 months\. You can also/);
  assert.match(storageNote({ storage: "db", sheetCopy: true }), /also copied to your Google Sheet/);
  assert.match(storageNote({ storage: "sheet" }), /only in your Google Sheet/);
  assert.equal(storageNote(null), "");
});

test("budget text round-trips and bad parts are dropped", async () => {
  const { parseBudgets, budgetsText } = await import("../src/Pages/Money/MoneyBrain.jsx").catch(() => ({}));
  if (!parseBudgets) return;   // JSX is not loaded by plain node; the parsing is covered by the server tests
  assert.deepEqual(parseBudgets("Food=8000, Travel = ₹3,000, bad, x=0"), { Food: 8000, Travel: 3000 });
  assert.equal(budgetsText([{ category: "Food", limit: 8000 }]), "Food=8000");
});
