/*
 * Money Brain: a small, self-deciding analyst. Pure functions (no database, no network, no external model), so it is private, free and
 * testable. The BANK STATEMENT IS THE SOLE TRUTH: for any month a saved statement covers, profit/loss is computed from the statement's
 * own lines; the SMS entries are used only for months (or days) no statement covers yet, and are labelled "entries only" (lower trust).
 *
 * It decides on its own: a verdict (healthy / watch / alert), the reasons, and a short ordered list of actions. Nothing here writes data.
 */
const ex = require("./expenses");

const r2 = ex.round2;
const counted = (t) => !ex.DOUBTFUL.includes(t.status);
// Money moving between the owner's own pots is neither profit nor loss.
const NEUTRAL = new Set(["Transfers", "Investments"]);

function monthOfDate(d) { return String(d || "").slice(0, 7); }
function shift(month, delta) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const daysIn = (month) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** Income, spend and net for one month from a list of {type, amount, category?} items, ignoring own-pot moves for spend. */
function totalsOf(items) {
    let income = 0, spend = 0, moved = 0;
    const by = new Map();
    for (const t of items) {
        if (t.type === "Credit") { income += t.amount; continue; }
        if (t.type !== "Debit") continue;
        if (NEUTRAL.has(t.category)) { moved += t.amount; continue; }
        spend += t.amount;
        by.set(t.category || "Uncategorized", r2((by.get(t.category || "Uncategorized") || 0) + t.amount));
    }
    return { income: r2(income), spend: r2(spend), moved: r2(moved), net: r2(income - spend), byCategory: [...by].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount) };
}

/**
 * One month's figures, statement first. A statement line carries no category, so categories come from the matching stored entry
 * (by reference, else amount+date); a statement line with no match counts as "Uncategorized" but still counts in the totals.
 */
function monthFigures(month, rows, lines) {
    const stmt = lines.filter((l) => monthOfDate(l.date) === month);
    const mine = rows.filter((t) => t.month === month && counted(t));
    if (!stmt.length) return { month, source: "entries", trust: "low", ...totalsOf(mine), lines: 0 };
    const byRef = new Map(), byKey = new Map();
    for (const t of mine) { if (t.ref) byRef.set(ex.refKey(t.ref), t); byKey.set(`${t.date}|${t.amount}|${t.type}`, t); }
    const items = stmt.map((l) => {
        const hit = (l.ref && byRef.get(ex.refKey(l.ref))) || byKey.get(`${l.date}|${l.amount}|${l.type}`);
        return { type: l.type, amount: l.amount, category: hit ? hit.category : "Uncategorized" };
    });
    return { month, source: "statement", trust: "high", ...totalsOf(items), lines: stmt.length };
}

/** The statement's own running balance: the newest balance it states, and how many lines break the chain (a sign of a misread file). */
function statementState(lines) {
    const withBal = lines.filter((l) => l.balance != null);
    const last = withBal[withBal.length - 1] || null;
    let breaks = 0;
    for (let i = 1; i < lines.length; i++) {
        const a = lines[i - 1], b = lines[i];
        if (a.balance == null || b.balance == null) continue;
        if (Math.abs(r2(a.balance + (b.type === "Credit" ? b.amount : -b.amount)) - b.balance) >= 0.01) breaks++;
    }
    return { balance: last ? last.balance : null, asOf: last ? last.date : null, breaks, lines: lines.length };
}

/**
 * rows: stored entries; lines: saved statement lines; opts: { today: "YYYY-MM-DD", months: how many months back (default 6) }
 * -> { verdict, headline, reasons[], actions[], months[], thisMonth, projection, runway, trust, balance }
 */
function analyze(rows, lines, { today, months = 6 } = {}) {
    const cur = today.slice(0, 7);
    const list = [];
    for (let i = months - 1; i >= 0; i--) {
        const f = monthFigures(shift(cur, -i), rows, lines);
        if (f.lines || f.income || f.spend || f.moved) list.push({ ...f, result: f.net > 0 ? "profit" : f.net < 0 ? "loss" : "even" });
    }
    const thisMonth = list.find((m) => m.month === cur) || { month: cur, source: "entries", trust: "low", income: 0, spend: 0, moved: 0, net: 0, byCategory: [], lines: 0, result: "even" };
    const prior = list.filter((m) => m.month < cur && (m.spend > 0 || m.income > 0));
    const avg = (key) => (prior.length ? r2(prior.reduce((n, m) => n + m[key], 0) / prior.length) : null);
    const avgSpend = avg("spend"), avgIncome = avg("income");

    // pace: where this month ends if spending continues at today's rate
    const day = Math.max(1, Number(today.slice(8, 10)) || 1), total = daysIn(cur);
    const projectedSpend = r2((thisMonth.spend / day) * total);
    const expectedIncome = Math.max(thisMonth.income, avgIncome || 0);
    const projection = { spend: projectedSpend, income: expectedIncome, net: r2(expectedIncome - projectedSpend), day, of: total };

    const st = statementState(lines);
    const stale = st.asOf ? Math.round((Date.parse(today) - Date.parse(st.asOf)) / 86400000) : null;
    const dailySpend = thisMonth.spend && day ? thisMonth.spend / day : avgSpend ? avgSpend / 30 : 0;
    // no statement balance yet: the newest balance a bank message carried
    const lastMsg = rows.filter((t) => t.balance != null && t.status !== "Flagged" && t.date).sort((a, b) => `${a.date} ${a.time || ""}`.localeCompare(`${b.date} ${b.time || ""}`)).pop();
    const balance = st.balance != null ? st.balance : lastMsg ? lastMsg.balance : null;
    if (st.balance == null && lastMsg) { st.balance = lastMsg.balance; st.asOf = lastMsg.date; st.from = "message"; }
    const runway = balance != null && dailySpend > 0 ? { days: Math.floor(balance / dailySpend), balance, asOf: st.asOf } : null;
    const cycle = require("./moneyBalance").salaryCycle(rows, today);

    const doubtful = rows.filter((t) => t.month === cur && !counted(t));
    const uncategorized = rows.filter((t) => t.month === cur && counted(t) && t.type === "Debit" && (!t.category || t.category === "Uncategorized"));
    const spikes = [];
    for (const c of thisMonth.byCategory) {
        const before = prior.map((m) => (m.byCategory.find((x) => x.category === c.category) || { amount: 0 }).amount);
        if (before.length < 2) continue;
        const base = before.reduce((n, a) => n + a, 0) / before.length;
        if (c.amount >= 1000 && c.amount > base * 1.5) spikes.push({ category: c.category, amount: c.amount, usually: r2(base) });
    }

    // ── the decision ──
    const reasons = [], actions = [];
    let score = 0;                                           // 0 healthy, higher is worse
    // Salary often lands at the end of the previous month, so a calendar month can look like a loss when it is not: with a known salary, judge by the cycle.
    const inLoss = cycle ? cycle.left < 0 : thisMonth.net < 0;
    if (inLoss) { score += 2; reasons.push(cycle ? `Since your salary on ${cycle.date}: ₹${cycle.spent} spent against ₹${r2(cycle.received + cycle.otherIncome)} in, ₹${Math.abs(cycle.left)} over.` : `Loss so far this month: spent ₹${thisMonth.spend} against ₹${thisMonth.income} in.`); }
    if (projection.net < 0 && thisMonth.net >= 0) { score += 1; reasons.push(`At this pace you end the month ₹${Math.abs(projection.net)} short.`); }
    if (avgSpend && thisMonth.spend > avgSpend * 1.25 && day >= 10) { score += 1; reasons.push(`Spending is already ${Math.round((thisMonth.spend / avgSpend) * 100)}% of your usual month.`); }
    for (const s of spikes.slice(0, 2)) { score += 1; reasons.push(`${s.category} is ₹${s.amount}, usually about ₹${s.usually}.`); actions.push({ id: "cut-" + s.category, text: `Look at your ${s.category} payments: they are well above normal.` }); }
    if (runway && runway.days < 15) { score += 2; reasons.push(`The bank balance (₹${runway.balance}) lasts about ${runway.days} days at this rate.`); }
    if (st.breaks > 0) { score += 1; reasons.push(`${st.breaks} line${st.breaks === 1 ? "" : "s"} in your statement do not follow its running balance, so its figures may be wrong.`); actions.push({ id: "reupload", text: "Download the statement again as Excel or CSV and re-check." }); }
    if (!lines.length) actions.unshift({ id: "upload", text: "Upload a bank statement: until then every figure is only from messages (lower trust)." });
    else if (stale != null && stale > 31) actions.unshift({ id: "stale", text: `Your newest statement ends ${stale} days ago. Upload a newer one so this month is checked.` });
    if (doubtful.length) actions.push({ id: "review", text: `${doubtful.length} doubtful entr${doubtful.length === 1 ? "y is" : "ies are"} not counted. Review them or upload a statement to decide.` });
    if (uncategorized.length >= 5) actions.push({ id: "sort", text: `${uncategorized.length} payments this month are unsorted; sort them so the category figures are right.` });
    if (thisMonth.source === "entries" && lines.length) actions.push({ id: "month-unchecked", text: "This month is not in any statement yet, so its profit/loss comes from messages only." });

    const empty = !thisMonth.income && !thisMonth.spend && !thisMonth.lines;
    const verdict = score >= 3 ? "alert" : score >= 1 ? "watch" : "healthy";
    const word = thisMonth.result === "profit" ? `Profit ₹${thisMonth.net}` : thisMonth.result === "loss" ? `Loss ₹${Math.abs(thisMonth.net)}` : "Even";
    const src = thisMonth.source === "statement" ? " (from your statement)" : " (from messages, not yet checked by a statement)";
    const headline = empty ? `${monthLabelOf(cur)}: no payments yet.` : cycle ? `Since your salary on ${cycle.date}: ₹${cycle.spent} spent, ₹${cycle.left} left${src}.` : `${monthLabelOf(cur)}: ${word}${src}.`;
    if (!reasons.length) reasons.push("Nothing unusual: income covers spending and no category stands out.");
    return { cycle, verdict, headline, reasons, actions, months: list, thisMonth, average: { spend: avgSpend, income: avgIncome }, projection, runway, spikes, trust: thisMonth.trust, balance: st, unsorted: uncategorized.length, doubtful: doubtful.length };
}

const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabelOf(m) { const [y, mo] = m.split("-"); return `${NAMES[Number(mo) - 1]} ${y}`; }

module.exports = { analyze, monthFigures, totalsOf, statementState };
