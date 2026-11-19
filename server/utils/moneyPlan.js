/*
 * Money Plan: the "do more with your statement" half of the Money Brain. Pure functions again (no database, no network, no external
 * model): anomalies, recurring payments, budgets and their alerts, a salary-cycle forecast, savings goals, Meta Ads profit/loss, category
 * suggestions learned from the owner's own sorting, and a small question answerer ("how much on food last month").
 * Entries are the stored rows; `lines` are saved statement lines (the truth, see moneyBrain.js).
 */
const ex = require("./expenses");

const r2 = ex.round2;
const counted = (t) => !ex.DOUBTFUL.includes(t.status);
const NEUTRAL = new Set(["Transfers", "Investments"]);
const spendRows = (rows) => rows.filter((t) => counted(t) && t.type === "Debit" && !NEUTRAL.has(t.category));
const minutes = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t.time || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const dayNum = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000);
const addDays = (d, n) => new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const who = (t) => ex.vpaOf(t.merchant) || ex.norm(t.merchant);

/* ───────── 1. anomalies ───────── */

/** Things that look wrong or unusual: a payment charged twice, a very large one, a big one to someone new. -> [{ kind, severity, text, index }] */
function anomalies(rows, { today }) {
    const out = [];
    const debits = rows.filter((t) => counted(t) && t.type === "Debit");
    const recent = debits.filter((t) => t.date && dayNum(today) - dayNum(t.date) <= 31);
    // charged twice: same payee and amount, a few minutes apart, different references
    for (let i = 0; i < recent.length; i++) for (let j = i + 1; j < recent.length; j++) {
        const a = recent[i], b = recent[j];
        if (a.date !== b.date || a.amount !== b.amount || !who(a) || who(a) !== who(b) || (a.ref && a.ref === b.ref)) continue;
        const ma = minutes(a), mb = minutes(b);
        if (ma != null && mb != null && Math.abs(ma - mb) <= 10) out.push({ kind: "double", severity: "high", index: b.index, text: `₹${a.amount} to ${a.merchant || "the same payee"} twice ${Math.abs(ma - mb) === 0 ? "at the same minute" : `${Math.abs(ma - mb)} min apart`} on ${a.date}: one may be a double charge.` });
    }
    // very large: far above the usual payment
    const amounts = debits.map((t) => t.amount);
    const usual = median(amounts), big = Math.max(3000, usual * 8);
    for (const t of recent) if (t.amount >= big && !NEUTRAL.has(t.category)) out.push({ kind: "large", severity: "medium", index: t.index, text: `₹${t.amount} to ${t.merchant || "someone"} on ${t.date} is far above your usual payment (about ₹${Math.round(usual)}).` });
    // a new payee with a big amount
    const seenBefore = new Set(debits.filter((t) => t.date && dayNum(today) - dayNum(t.date) > 31).map(who));
    if (seenBefore.size) for (const t of recent) if (t.amount >= 2000 && who(t) && !seenBefore.has(who(t)) && !NEUTRAL.has(t.category) && !out.some((o) => o.index === t.index)) out.push({ kind: "new-payee", severity: "low", index: t.index, text: `First payment to ${t.merchant}: ₹${t.amount} on ${t.date}.` });
    return out;
}

/* ───────── 2. recurring payments ───────── */

/**
 * Payments that come back every month (rent, SIP, subscriptions): the same payee in 2+ different months, amounts within 15% of each other.
 * -> [{ payee, amount, every: "month", last, next, count, category }] sorted by amount
 */
function recurring(rows, { today }) {
    const groups = new Map();
    for (const t of rows.filter((x) => counted(x) && x.type === "Debit" && x.date)) {
        const k = who(t);
        if (!k || k.length < 3) continue;
        (groups.get(k) || groups.set(k, []).get(k)).push(t);
    }
    const out = [];
    for (const [payee, list] of groups) {
        const months = new Set(list.map((t) => t.date.slice(0, 7)));
        if (months.size < 2) continue;
        const amts = list.map((t) => t.amount), mid = median(amts);
        if (!amts.every((a) => Math.abs(a - mid) <= mid * 0.15)) continue;
        const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : 1)), last = sorted[sorted.length - 1];
        const gaps = sorted.slice(1).map((t, i) => dayNum(t.date) - dayNum(sorted[i].date)).filter((g) => g >= 20 && g <= 40);
        if (!gaps.length) continue;                                                  // several payments in one month are not a monthly habit
        let next = addDays(last.date, Math.round(median(gaps)));
        while (next < today) next = addDays(next, 30);
        out.push({ payee: last.merchant || payee, amount: r2(mid), every: "month", last: last.date, next, count: months.size, category: last.category });
    }
    return out.sort((a, b) => b.amount - a.amount);
}

/* ───────── 3. budgets and their alerts ───────── */

/** budgets: { [category]: limit }. -> [{ category, limit, spent, pct, level: ok|near|over }] (near = 80%+) */
function budgetStatus(rows, budgets, month) {
    const spent = new Map();
    for (const t of spendRows(rows.filter((x) => x.month === month))) spent.set(t.category, r2((spent.get(t.category) || 0) + t.amount));
    return Object.entries(budgets || {}).filter(([, v]) => Number(v) > 0).map(([category, v]) => {
        const limit = Number(v), s = spent.get(category) || 0, pct = Math.round((s / limit) * 100);
        return { category, limit, spent: s, pct, level: pct >= 100 ? "over" : pct >= 80 ? "near" : "ok" };
    }).sort((a, b) => b.pct - a.pct);
}

/**
 * Which alerts to send now, each at most once per month and level. sent: { "2026-11|Food|near": true }.
 * -> [{ key, text }] (the caller sends them and records the keys)
 */
function dueAlerts(status, month, sent = {}) {
    const out = [];
    for (const b of status) {
        if (b.level === "ok") continue;
        for (const lvl of b.level === "over" ? ["near", "over"] : ["near"]) {
            const key = `${month}|${b.category}|${lvl}`;
            if (sent[key]) continue;
            if (lvl === "near" && b.level === "over") { out.push({ key, silent: true }); continue; }       // skipped straight past 80%: mark it, say only "over"
            out.push({ key, text: lvl === "over" ? `${b.category}: over budget. ₹${b.spent} spent of ₹${b.limit} (${b.pct}%).` : `${b.category}: ${b.pct}% of the budget used (₹${b.spent} of ₹${b.limit}).` });
        }
    }
    return out;
}

/* ───────── 4. salary-cycle forecast ───────── */

/**
 * cycle: the moneyBalance.salaryCycle() result; rec: recurring(); -> { left, daysToSalary, dueBills, safePerDay, status } or null
 * The next salary is expected on the same day of the next month.
 */
function salaryForecast(cycle, rec, { today }) {
    if (!cycle) return null;
    // salary comes on about the same day each month: the next one is this one's date, one calendar month on (clamped to the month's end)
    const [y, m, d] = cycle.date.split("-").map(Number);
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let next = new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
    if (next < today) next = addDays(today, 1);
    const daysToSalary = Math.max(1, dayNum(next) - dayNum(today));
    const dueBills = r2(rec.filter((r) => r.next >= today && r.next < next).reduce((n, r) => n + r.amount, 0));
    const free = r2(cycle.left - dueBills);
    const safePerDay = free > 0 ? r2(free / daysToSalary) : 0;
    const status = free <= 0 ? "short" : safePerDay < 300 ? "tight" : "fine";
    return { nextSalary: next, daysToSalary, left: cycle.left, dueBills, free, safePerDay, status };
}

/* ───────── 5. savings goals ───────── */

/** goals: [{ name, target, saved }]; monthlyNet: what you keep in an average month. -> each with months left and a plain sentence. */
function goalProgress(goals, monthlyNet) {
    return (goals || []).filter((g) => Number(g.target) > 0).map((g) => {
        const target = Number(g.target), saved = Math.max(0, Number(g.saved) || 0), left = Math.max(0, r2(target - saved));
        const months = left === 0 ? 0 : monthlyNet > 0 ? Math.ceil(left / monthlyNet) : null;
        return { name: String(g.name || "Goal").slice(0, 60), target, saved, left, pct: Math.min(100, Math.round((saved / target) * 100)), months,
            text: left === 0 ? "Reached." : months == null ? "At the current rate nothing is left over each month, so this goal does not move." : `About ${months} month${months === 1 ? "" : "s"} at ₹${Math.round(monthlyNet)} saved a month.` };
    });
}

/* ───────── 6. Meta Ads profit or loss ───────── */

/** Ad spend against the money that is not salary and not your own transfers coming in, per month. -> [{ month, adSpend, otherIncome, net, roi }] */
function metaAds(rows) {
    const months = [...new Set(rows.filter((t) => t.category === "Meta Ads" && counted(t)).map((t) => t.month))].sort();
    return months.map((month) => {
        const m = rows.filter((t) => t.month === month && counted(t));
        const adSpend = r2(m.filter((t) => t.category === "Meta Ads" && t.type === "Debit").reduce((n, t) => n + t.amount, 0));
        const otherIncome = r2(m.filter((t) => t.type === "Credit" && !ex.isSalary(t) && !NEUTRAL.has(t.category)).reduce((n, t) => n + t.amount, 0));
        return { month, adSpend, otherIncome, net: r2(otherIncome - adSpend), roi: adSpend > 0 ? r2(otherIncome / adSpend) : null };
    });
}

/* ───────── 7. learn categories from the owner's own sorting ───────── */

const tokens = (s) => ex.norm(s).split(" ").filter((w) => w.length >= 3 && !/^(upi|the|and|pvt|ltd|bank|payment|to|from)$/.test(w));

/**
 * For payments still "Uncategorized": the category that payees with similar words already have in the owner's sorted history.
 * Only suggests when one category clearly wins (2+ matching payments, 70%+ of them). -> [{ index, merchant, category, confidence }]
 */
function suggestCategories(rows) {
    const sorted = rows.filter((t) => t.category && t.category !== "Uncategorized" && t.category !== "Other");
    const score = new Map();                                    // token -> Map(category -> count)
    for (const t of sorted) for (const w of new Set(tokens(t.merchant))) { const m = score.get(w) || score.set(w, new Map()).get(w); m.set(t.category, (m.get(t.category) || 0) + 1); }
    const out = [];
    const seen = new Set();
    for (const t of rows.filter((x) => (!x.category || x.category === "Uncategorized") && x.type === "Debit")) {
        const key = who(t);
        if (!key || seen.has(key)) continue;
        const votes = new Map();
        for (const w of new Set(tokens(t.merchant))) for (const [c, n] of score.get(w) || []) votes.set(c, (votes.get(c) || 0) + n);
        const total = [...votes.values()].reduce((a, b) => a + b, 0);
        const [cat, n] = [...votes].sort((a, b) => b[1] - a[1])[0] || [];
        if (cat && n >= 2 && n / total >= 0.7) { seen.add(key); out.push({ index: t.index, merchant: t.merchant, category: cat, confidence: Math.round((n / total) * 100) }); }
    }
    return out;
}

/* ───────── 8. ask in plain words ───────── */

const WORD_MONTH = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function shiftMonth(m, d) { const [y, mo] = m.split("-").map(Number); const x = new Date(Date.UTC(y, mo - 1 + d, 1)); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`; }

/**
 * "how much did I spend on food last month", "income in october", "biggest payment this month", "spent on swiggy".
 * Answers only from the owner's own numbers, in words; nothing is sent anywhere. -> { answer, rows? } or { answer: null }
 */
function ask(question, rows, { today, categories = ex.DEFAULT_CATEGORIES }) {
    const q = String(question || "").toLowerCase();
    const cur = today.slice(0, 7);
    let month = cur, label = "this month";
    if (/last month|previous month/.test(q)) { month = shiftMonth(cur, -1); label = "last month"; }
    const named = WORD_MONTH.findIndex((w) => new RegExp(`\\b${w}[a-z]*\\b`).test(q));
    if (named >= 0) { const y = Number(cur.slice(0, 4)); const cand = `${y}-${String(named + 1).padStart(2, "0")}`; month = cand > cur ? `${y - 1}-${String(named + 1).padStart(2, "0")}` : cand; label = `in ${WORD_MONTH[named]}`; }
    const inMonth = rows.filter((t) => t.month === month && counted(t));
    const cat = categories.find((c) => q.includes(c.toLowerCase()));
    const sum = (list) => r2(list.reduce((n, t) => n + t.amount, 0));
    if (/biggest|largest|highest|top/.test(q)) {
        const top = spendRows(inMonth).sort((a, b) => b.amount - a.amount).slice(0, 3);
        return top.length ? { answer: `Your biggest payments ${label}: ` + top.map((t) => `₹${t.amount} to ${t.merchant || "someone"} (${t.date})`).join("; ") + ".", rows: top.map((t) => t.index) } : { answer: `No payments ${label}.` };
    }
    if (/where|breakdown|category|categories|what.*(spend|spent)|split/.test(q) && !cat) {
        const by = new Map();
        for (const t of spendRows(inMonth)) by.set(t.category || "Uncategorized", r2((by.get(t.category || "Uncategorized") || 0) + t.amount));
        const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 4), total = sum(spendRows(inMonth));
        return top.length ? { answer: `Of ₹${total} spent ${label}: ` + top.map(([c, v]) => `${c} ₹${v} (${Math.round((v / total) * 100)}%)`).join(", ") + "." } : { answer: `No spending ${label}.` };
    }
    if (/income|earn|received|credited|salary/.test(q)) { const c = inMonth.filter((t) => t.type === "Credit"); return { answer: `You received ₹${sum(c)} ${label} (${c.length} credit${c.length === 1 ? "" : "s"}).` }; }
    if (/save|saving|left|profit|loss|net/.test(q)) { const inc = sum(inMonth.filter((t) => t.type === "Credit")), sp = sum(spendRows(inMonth)); return { answer: `${label[0].toUpperCase() + label.slice(1)}: ₹${inc} in, ₹${sp} spent, so ${inc - sp >= 0 ? "a profit of" : "a loss of"} ₹${Math.abs(r2(inc - sp))}.` }; }
    if (cat) { const c = inMonth.filter((t) => t.type === "Debit" && t.category === cat); return { answer: `You spent ₹${sum(c)} on ${cat} ${label} (${c.length} payment${c.length === 1 ? "" : "s"}).`, rows: c.map((t) => t.index) }; }
    const word = tokens(q.replace(/\b(how|much|did|spend|spent|on|to|for|in|last|this|month|paid|pay)\b/g, " ")).find((w) => inMonth.some((t) => ex.norm(t.merchant).includes(w)));
    if (word) { const c = inMonth.filter((t) => t.type === "Debit" && ex.norm(t.merchant).includes(word)); return { answer: `You paid ₹${sum(c)} to "${word}" ${label} (${c.length} payment${c.length === 1 ? "" : "s"}).`, rows: c.map((t) => t.index) }; }
    if (/spen|spent|expense|cost|paid/.test(q)) return { answer: `You spent ₹${sum(spendRows(inMonth))} ${label}.` };
    return { answer: null };
}

/**
 * A short plain-English digest of the month from the brain's own numbers (always available, no AI needed), and a compact line of totals
 * (categories and amounts only: no names, no references) that an optional AI can rephrase.
 */
function digest(v) {
    const m = v.thisMonth, parts = [];
    parts.push(v.headline);
    const top = m.byCategory.slice(0, 3).filter((c) => c.amount > 0);
    if (top.length) parts.push(`Most went to ${top.map((c) => `${c.category} (₹${c.amount})`).join(", ")}.`);
    if (v.average && v.average.spend && m.spend) parts.push(`That is ${Math.round((m.spend / v.average.spend) * 100)}% of your usual month's spending (₹${Math.round(v.average.spend)}).`);
    if (v.forecast) parts.push(v.forecast.status === "short" ? "You are likely to run short before the next salary." : `You can safely spend about ₹${Math.round(v.forecast.safePerDay)} a day until the next salary.`);
    if (v.anomalies && v.anomalies.length) parts.push(`${v.anomalies.length} payment${v.anomalies.length === 1 ? "" : "s"} look unusual.`);
    const bad = (v.budgets || []).filter((b) => b.level !== "ok");
    if (bad.length) parts.push(`Budget watch: ${bad.map((b) => `${b.category} ${b.pct}%`).join(", ")}.`);
    parts.push(v.verdict === "healthy" ? "Overall: healthy." : v.verdict === "watch" ? "Overall: keep an eye on it." : "Overall: needs attention.");
    const compact = `Month ${m.month}: in ₹${m.income}, spent ₹${m.spend}, net ₹${m.net}. ` + top.map((c) => `${c.category} ${c.amount}`).join(", ") + `. Verdict ${v.verdict}.`;
    return { text: parts.join(" "), compact: compact.slice(0, 380) };
}

module.exports = { digest, anomalies, recurring, budgetStatus, dueAlerts, salaryForecast, goalProgress, metaAds, suggestCategories, ask };
