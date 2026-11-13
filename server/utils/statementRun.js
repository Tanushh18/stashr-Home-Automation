/*
 * Checking a bank statement against the stored entries, start to finish. It takes the store (and the optional sheet copy) from the caller
 * and says where it is through progress(), so the website can show a bar while it runs in the background, and so it can be tested
 * with an in-memory store (tests/statementRun.test.js).
 */
const ex = require("./expenses");

/**
 * The whole statement check: read the file, keep only what the limits allow, pair every line with a stored entry (the statement is the
 * truth), write the changes in small batches and add what the messages missed. `progress({ stage, text, pct })` says how far it is.
 * Throws an Error with .status 400 and a plain message when the file is not usable.
 */
async function processStatement({ s, st, copy, bytes, rules = [], cutoff = "", month = "", saveSummary = async () => {}, saveLines = async () => {}, progress = () => {} }) {
    const bad = (message) => Object.assign(new Error(message), { status: 400 });
    progress({ stage: "reading", text: "Reading the statement…", pct: 8 });
    let table;
    try { table = bytes.subarray(0, 2).toString() === "PK" ? ex.parseXlsx(bytes) : ex.parseCsv(bytes.toString("utf8")); }
    catch (e) { throw bad(e.message || "Could not read that file."); }
    let stmt;
    try { stmt = ex.statementRows(table); } catch (e) { throw bad(e.message); }
    // the month the owner chose to match: only that month's lines are used (and saved), so only that month's entries are checked and corrected
    if (month) {
        const all = stmt;
        stmt = stmt.filter((x) => x.date.slice(0, 7) === month);
        if (!stmt.length) throw bad(`This statement has no transactions in ${month}` + (all.length ? ` (it covers ${all[0].date} to ${all[all.length - 1].date}). Pick another month, or choose the whole statement.` : "."));
    }
    const everyLine = stmt;                                   // what is kept for searching later, before the start date and the 4-month rule cut it
    // only as much of the statement as the limits allow: the start date, and (Stashr storage) the 4-month rule
    const limited = ex.limitStatement(stmt, { startDate: s.startDate, cutoff, keepsOld: st.keepsOld });
    stmt = limited.kept;
    if (!stmt.length) throw bad("No transactions found in that statement (after your start date" + (st.keepsOld ? "" : " and within the last 4 months") + ").");

    progress({ stage: "matching", text: `Matching ${stmt.length} statement lines with your entries…`, pct: 25 });
    const rows = await st.list();
    const { updates, additions, report } = ex.reconcile(rows, stmt, rules);
    const items = [];
    for (const u of updates) {
        // the statement is the truth: whatever it says (date, amount, name, balance, status...) is written, but only where it differs
        const cur = rows.find((t) => String(t.index) === String(u.index));
        const fields = {};
        for (const [k, v] of Object.entries(u.fields || { status: u.status, note: u.note })) {
            if (JSON.stringify(cur ? cur[k] : undefined) !== JSON.stringify(v)) fields[k] = v;
        }
        if (Object.keys(fields).length) items.push({ index: u.index, fields, tx: cur });
    }

    const BATCH = 25;
    for (let i = 0; i < items.length; i += BATCH) {
        const chunk = items.slice(i, i + BATCH);
        progress({ stage: "saving", text: `Saving the corrections (${Math.min(i + BATCH, items.length)} of ${items.length})…`, pct: 35 + 45 * (i / Math.max(items.length, 1)) });
        await st.updateMany(chunk);
        if (copy) copy.update(chunk.filter((it) => it.tx));
    }
    const txs = additions.map((t) => ex.makeTx(t, t.category, "Statement", "Verified", "Added from your statement (no message was found)", 0, []));
    if (txs.length) progress({ stage: "adding", text: `Adding ${txs.length} payments the messages missed…`, pct: 85 });
    const saved = await st.append(txs);
    if (copy) copy.append(saved.stored);

    progress({ stage: "finishing", text: "Finishing…", pct: 95 });
    report.skipped = { beforeStart: limited.beforeStart, tooOld: limited.tooOld, startDate: s.startDate || "", cutoff: st.keepsOld ? "" : cutoff };
        const summary = { at: new Date().toISOString(), skipped: report.skipped, from: report.from, to: report.to, lines: report.lines, verified: report.verified, mismatched: report.mismatched, added: report.added, renamed: report.renamed, notInStatement: report.notInStatement, months: report.months, allMonthsMatch: report.allMonthsMatch, closingBalance: report.closingBalance, balanceBreakCount: report.balanceBreakCount };
    await saveSummary(summary);
    try { await saveLines({ lines: everyLine, month }); report.saved = everyLine.length; }
    catch (e) { console.error("[expenses] could not keep the statement lines for searching:", e && e.message); report.saved = 0; }
    return { report };
}

module.exports = { processStatement };
