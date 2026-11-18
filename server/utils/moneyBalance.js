/*
 * "Does Stashr's money add up to the bank?" Pure functions (no database): given the stored entries and the lines of the saved bank
 * statements, work out last month's closing balance, what the balance should be today, what the bank last said it was (SMS or statement),
 * the difference, and the salary cycle (money left since the salary came in).
 */
const ex = require("./expenses");

const r2 = ex.round2;
const keyOf = (t) => `${t.date} ${t.time || ""}`;
const signed = (t) => (t.type === "Credit" ? t.amount : -t.amount);
const counted = (t) => !ex.DOUBTFUL.includes(t.status);
const monthStart = (month) => `${month}-01`;

/** The balance after the last statement line dated before `date` (last month's closing), or null. Lines are in statement order. */
function closingBefore(lines, date) {
    let last = null;
    for (const l of lines) if (l.date < date && l.balance != null) last = l;
    return last ? { balance: last.balance, date: last.date, from: "statement" } : null;
}

/** With no statement: the balance before the first entry of the month that carries a balance (its balance minus its own movement), or the newest earlier balance. */
function openingFromEntries(rows, month) {
    const start = monthStart(month);
    const before = rows.filter((t) => t.balance != null && t.date < start && counted(t) && t.status !== "Flagged").sort((a, b) => keyOf(a).localeCompare(keyOf(b))).pop();
    if (before) return { balance: before.balance, date: before.date, from: "message" };
    const first = rows.filter((t) => t.balance != null && t.date >= start && t.date.slice(0, 7) === month && counted(t)).sort((a, b) => keyOf(a).localeCompare(keyOf(b)))[0];
    return first ? { balance: r2(first.balance - signed(first)), date: first.date, from: "message" } : null;
}

/**
 * rows: stored entries; lines: saved statement lines (may be empty); opts: { month: "YYYY-MM", today: "YYYY-MM-DD", bank: number|null (what the owner reads in the bank app) }
 */
function balanceReport(rows, lines, { month, today, bank = null }) {
    const start = monthStart(month);
    const opening = closingBefore(lines, start) || openingFromEntries(rows, month);
    const inMonth = rows.filter((t) => t.month === month && counted(t));
    const credits = r2(inMonth.filter((t) => t.type === "Credit").reduce((n, t) => n + t.amount, 0));
    const debits = r2(inMonth.filter((t) => t.type === "Debit").reduce((n, t) => n + t.amount, 0));
    const expected = opening ? r2(opening.balance + credits - debits) : null;

    // What the bank last said: the newest balance among the statement and the messages (a message later than the statement wins).
    const lastLine = [...lines].reverse().find((l) => l.balance != null);
    const lastMsg = rows.filter((t) => t.balance != null && t.status !== "Flagged" && t.date && t.time).sort((a, b) => keyOf(a).localeCompare(keyOf(b))).pop();
    let bankSays = null;
    if (lastLine) bankSays = { balance: lastLine.balance, date: lastLine.date, from: "statement" };
    if (lastMsg && (!lastLine || lastMsg.date > lastLine.date)) bankSays = { balance: lastMsg.balance, date: lastMsg.date, time: lastMsg.time, from: "message" };

    // Money after the bank's last word is not in its balance yet: apply it to the bank's number to get today's expected balance.
    let todayExpected = expected;
    if (bankSays) {
        const after = rows.filter((t) => counted(t) && t.date && (bankSays.from === "statement" ? t.date > bankSays.date : keyOf(t) > `${bankSays.date} ${bankSays.time}`));
        todayExpected = r2(bankSays.balance + after.reduce((n, t) => n + signed(t), 0));
    }
    const compare = bank != null && Number.isFinite(Number(bank)) ? Number(bank) : null;
    const target = compare != null ? compare : bankSays ? bankSays.balance : null;
    // difference: what Stashr's own running total says minus what the bank says (expected for the month vs. the latest bank balance)
    const reference = expected;
    let difference = null;
    if (reference != null && target != null && month === today.slice(0, 7)) difference = r2(reference - target);
    else if (reference != null && month < today.slice(0, 7)) {
        const closing = closingBefore(lines, monthStart(nextMonth(month)));
        if (closing) difference = r2(reference - closing.balance);
    }

    const doubtful = rows.filter((t) => t.month === month && !counted(t));
    const sum = (list, type) => r2(list.filter((t) => t.type === type).reduce((n, t) => n + t.amount, 0));
    return {
        month, opening, credits, debits, expectedBalance: expected, bankSays, todayExpected,
        compareWith: compare, difference, match: difference != null ? Math.abs(difference) < 0.01 : null,
        hint: hintFor({ difference, doubtful, opening, bankSays }),
        doubtful: { count: doubtful.length, debit: sum(doubtful, "Debit"), credit: sum(doubtful, "Credit") },
        salary: salaryCycle(rows, today)
    };
}

function nextMonth(m) { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; }

function hintFor({ difference, doubtful, opening, bankSays }) {
    if (!opening) return "Upload a bank statement (or wait for a bank message with a balance) so last month's closing balance is known.";
    if (!bankSays) return "No bank balance seen yet. Upload a statement to compare.";
    if (difference == null) return "";
    if (Math.abs(difference) < 0.01) return "Matches the bank.";
    const side = difference > 0 ? "more" : "less";
    const extra = doubtful.length ? ` ${doubtful.length} entr${doubtful.length === 1 ? "y is" : "ies are"} set aside (not counted); check them.` : "";
    return `Stashr shows ₹${Math.abs(difference).toFixed(2)} ${side} than the bank. Add a missing payment, or remove a repeat.${extra}`;
}

/**
 * The salary cycle: the newest salary credit (category "Salary", or the words salary/payroll) is the start; everything after it is
 * subtracted from it. -> { received, date, spent, left, credits (other money in since), days, previous: [...] } or null.
 */
function salaryCycle(rows, today) {
    const sal = rows.filter(ex.isSalary).sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    if (!sal.length) return null;
    const cycleOf = (s, endKey) => {
        const sk = keyOf(s);
        const within = rows.filter((t) => counted(t) && t !== s && keyOf(t) > sk && (!endKey || keyOf(t) < endKey));
        const spent = r2(within.filter((t) => t.type === "Debit").reduce((n, t) => n + t.amount, 0));
        const other = r2(within.filter((t) => t.type === "Credit" && !ex.isSalary(t)).reduce((n, t) => n + t.amount, 0));
        return { date: s.date, received: s.amount, spent, otherIncome: other, left: r2(s.amount + other - spent) };
    };
    const cur = sal[sal.length - 1];
    const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(cur.date)) / 86400000));
    const previous = sal.slice(0, -1).slice(-3).map((s) => cycleOf(s, keyOf(sal[sal.indexOf(s) + 1])));
    return { ...cycleOf(cur, ""), days, previous };
}

module.exports = { balanceReport, closingBefore, openingFromEntries, salaryCycle };
