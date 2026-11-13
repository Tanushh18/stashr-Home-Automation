/**
 * Saved bank statements: keeping their lines (encrypted) and searching them later by name or amount, a little forgivingly.
 * The matching rules are pure functions (tests/statementSearch.test.js); the database parts take the account's data key.
 */
const crypto = require("crypto");
const Statement = require("../models/expenseStatement");
const Line = require("../models/expenseStatementLine");
const { sealJSONWithKey, unsealJSONWithKey } = require("../models/EncDecManager");

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/** Edit distance between two short words. */
function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return Math.max(m, n);
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[n];
}

const toAmount = (t) => { const v = Number(String(t).replace(/[₹,\s]|rs\.?|inr/gi, "")); return Number.isFinite(v) ? v : null; };

/**
 * What the person typed -> { words: [..], amount: { eq? min? max? }, digits: [..] }.
 *   "ramesh", "meta verify"          words, matched forgivingly
 *   "1200", "₹1,200.50", "rs 350"    an amount (exact)
 *   "500-1000", ">500", "<=2000"     an amount range
 *   "613112345678"                   9 or more digits: part of a UPI/reference number
 * Words and an amount can be mixed ("ramesh 350").
 */
function parseQuery(q) {
    const text = String(q || "").trim().toLowerCase();
    const out = { words: [], amount: {}, digits: [] };
    let rest = text;
    const range = /(?:₹|rs\.?\s*)?([\d,]+(?:\.\d+)?)\s*(?:-|–|to)\s*(?:₹|rs\.?\s*)?([\d,]+(?:\.\d+)?)/.exec(rest);
    if (range && toAmount(range[1]) != null && toAmount(range[2]) != null) {
        const a = toAmount(range[1]), b = toAmount(range[2]);
        out.amount = { min: Math.min(a, b), max: Math.max(a, b) };
        rest = rest.replace(range[0], " ");
    }
    for (const m of [...rest.matchAll(/(>=|<=|>|<)\s*(?:₹|rs\.?\s*)?([\d,]+(?:\.\d+)?)/g)]) {
        const v = toAmount(m[2]);
        if (v == null) continue;
        if (m[1][0] === ">") out.amount.min = v; else out.amount.max = v;
        rest = rest.replace(m[0], " ");
    }
    for (const tok of rest.replace(/[^\w.,₹]+/g, " ").split(/\s+/).filter(Boolean)) {
        const plain = tok.replace(/[₹,]/g, "");
        if (/^\d{9,}$/.test(plain)) out.digits.push(plain);
        else if (/^\d+(\.\d{1,2})?$/.test(plain) && out.amount.min === undefined && out.amount.max === undefined) out.amount = { eq: Number(plain) };
        else if (/^(rs|inr|₹)$/.test(tok)) continue;
        else { const w = norm(tok); if (w) out.words.push(w); }
    }
    return out;
}

/** 0 when the word is nowhere in the line, else how well it fits (1 = exactly there). Short words must be exact; longer ones may have a slip or two. */
function wordScore(word, descNorm, descWords) {
    if (descNorm.includes(word)) return descWords.some((d) => d.startsWith(word)) ? 1 : 0.95;
    if (word.length < 4) return 0;
    const allow = word.length >= 8 ? 2 : 1;
    let best = 0;
    for (const d of descWords) {
        const whole = lev(word, d);
        if (whole <= allow) best = Math.max(best, 1 - (whole / Math.max(word.length, 3)) * 0.6);
        // a word typed as the start of a longer one, with a slip ("verify" for "verifie")
        if (d.length > word.length) { const head = lev(word, d.slice(0, word.length)); if (head <= allow) best = Math.max(best, 0.9 * (1 - (head / Math.max(word.length, 3)) * 0.6)); }
    }
    return best;
}

/** How well one saved line fits the query: 0 = not at all (left out), else 0..1 (higher = better). */
function scoreLine(query, line) {
    const a = query.amount, amt = Number(line.amount);
    if (a.eq !== undefined && Math.abs(amt - a.eq) > 0.005) return 0;
    if (a.min !== undefined && amt < a.min - 0.005) return 0;
    if (a.max !== undefined && amt > a.max + 0.005) return 0;
    const hay = `${line.desc || ""} ${line.ref || ""}`;
    for (const d of query.digits) if (!hay.includes(d)) return 0;
    const descNorm = norm(line.desc), descWords = descNorm.split(" ").filter(Boolean);
    let total = 0;
    for (const w of query.words) { const s = wordScore(w, descNorm, descWords); if (s === 0) return 0; total += s; }
    return query.words.length ? total / query.words.length : 1;
}

/** lines: [{ ...fields, date }] -> the best `limit`, best first, newest first among equals. */
function search(lines, q, { limit = 100 } = {}) {
    const query = parseQuery(q);
    if (!query.words.length && !query.digits.length && query.amount.eq === undefined && query.amount.min === undefined && query.amount.max === undefined) return { total: 0, results: [] };
    const hits = [];
    for (const l of lines) { const score = scoreLine(query, l); if (score > 0) hits.push({ ...l, score: Math.round(score * 100) / 100 }); }
    hits.sort((a, b) => b.score - a.score || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return { total: hits.length, results: hits.slice(0, Math.max(1, Math.min(500, limit))) };
}

/* ───────── keeping the lines ───────── */

const lineHash = (dataKey, l) => crypto.createHmac("sha256", dataKey).update(`${l.date}|${l.type}|${l.amount}|${l.balance ?? ""}|${l.ref}|${norm(l.desc)}`).digest("hex");

/**
 * Saves the lines of a statement that was just checked. lines: [{ date, desc, amount, type, balance, ref }].
 * Lines already saved (same date, amount, balance and text) move to this upload instead of being doubled.
 */
async function saveStatement(owner, dataKey, { filename = "", month = "", lines = [] }) {
    if (!lines.length) return null;
    const dates = lines.map((l) => l.date).sort();
    const st = await Statement.create({ owner, filename: String(filename).slice(0, 120), month, from: dates[0], to: dates[dates.length - 1] });
    const ops = lines.map((l) => ({
        updateOne: {
            filter: { owner, hash: lineHash(dataKey, l) },
            update: { $set: { statement: st._id, month: l.date.slice(0, 7), date: l.date, enc: sealJSONWithKey(dataKey, { desc: l.desc, amount: l.amount, type: l.type, balance: l.balance, ref: l.ref }) } },
            upsert: true
        }
    }));
    for (let i = 0; i < ops.length; i += 500) await Line.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    return st;
}

/** The saved statements with the number of lines each still holds; one whose lines all moved to a newer upload is dropped. */
async function listStatements(owner) {
    const counts = Object.fromEntries((await Line.aggregate([{ $match: { owner } }, { $group: { _id: "$statement", n: { $sum: 1 } } }])).map((r) => [String(r._id), r.n]));
    const all = await Statement.find({ owner }).sort({ uploadedAt: -1 }).lean();
    const keep = [];
    for (const s of all) { if (!counts[String(s._id)]) await Statement.deleteOne({ _id: s._id }); else keep.push({ id: String(s._id), filename: s.filename, month: s.month, from: s.from, to: s.to, uploadedAt: s.uploadedAt, lines: counts[String(s._id)] }); }
    const months = Object.entries((await Line.aggregate([{ $match: { owner } }, { $group: { _id: "$month", n: { $sum: 1 } } }])).reduce((o, r) => ({ ...o, [r._id]: r.n }), {})).map(([month, lines]) => ({ month, lines })).sort((a, b) => (a.month < b.month ? 1 : -1));
    return { statements: keep, months };
}

async function removeStatement(owner, id) {
    const st = await Statement.findOneAndDelete({ _id: id, owner });
    if (!st) return null;
    const r = await Line.deleteMany({ owner, statement: st._id });
    return { removed: r.deletedCount || 0 };
}

/** Decrypts the owner's saved lines (optionally one month, or one statement) and searches them. */
async function searchSaved(owner, dataKey, q, { month = "", statement = "", limit = 100 } = {}) {
    const filter = { owner };
    if (/^\d{4}-\d{2}$/.test(month)) filter.month = month;
    if (statement) filter.statement = statement;
    const rows = await Line.find(filter).lean();
    const names = Object.fromEntries((await Statement.find({ owner }).select("filename").lean()).map((s) => [String(s._id), s.filename]));
    const lines = [];
    for (const r of rows) {
        let secret;
        try { secret = unsealJSONWithKey(dataKey, r.enc); } catch (e) { continue; }
        lines.push({ id: String(r._id), date: r.date, month: r.month, file: names[String(r.statement)] || "", ...secret });
    }
    return { ...search(lines, q, { limit }), searched: lines.length };
}

/** Puts the lines of one day back in the order the bank had them, by following the running balance (each line starts where another ended). */
function orderDay(day) {
    if (day.length < 2 || day.some((l) => l.balance == null)) return day;
    const signed = (l) => (l.type === "Credit" ? l.amount : -l.amount);
    const before = (l) => Math.round((l.balance - signed(l)) * 100) / 100;
    const ends = new Set(day.map((l) => Math.round(l.balance * 100) / 100));
    const starts = day.filter((l) => !ends.has(before(l)));
    if (starts.length !== 1) return day;
    const out = [starts[0]], left = day.filter((l) => l !== starts[0]);
    while (left.length) {
        const last = Math.round(out[out.length - 1].balance * 100) / 100;
        const next = left.findIndex((l) => before(l) === last);
        if (next < 0) return day;
        out.push(left.splice(next, 1)[0]);
    }
    return out;
}

/** Every saved line of the owner (optionally one month), decrypted and in statement order: [{ date, desc, amount, type, balance, ref }]. */
async function loadLines(owner, dataKey, { month = "" } = {}) {
    const filter = { owner };
    if (/^\d{4}-\d{2}$/.test(month)) filter.month = month;
    const days = new Map();
    for (const r of await Line.find(filter).lean()) {
        let secret;
        try { secret = unsealJSONWithKey(dataKey, r.enc); } catch (e) { continue; }
        const l = { date: r.date, desc: secret.desc, amount: secret.amount, type: secret.type, balance: secret.balance == null ? null : secret.balance, ref: secret.ref || "" };
        if (!days.has(l.date)) days.set(l.date, []);
        days.get(l.date).push(l);
    }
    return [...days.keys()].sort().flatMap((d) => orderDay(days.get(d)));
}

module.exports = { loadLines, orderDay, parseQuery, scoreLine, search, lev, saveStatement, listStatements, removeStatement, searchSaved };
