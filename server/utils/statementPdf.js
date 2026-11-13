/**
 * A bank statement PDF -> the same "table of text rows" a CSV or Excel statement gives, so the existing statement code (utils/expenses.js
 * statementRows -> reconcile) works on it unchanged.
 *
 * pdfRead gives every piece of text with its position. Here the lines of each page are found (same height = same line), the header line
 * is found (a line with Date, Balance and a Withdrawals/Deposits/Amount column), the header's columns define where each column is, and every
 * later line becomes a row by putting each piece of text into the column it sits in. A narration that wraps onto several lines becomes
 * several rows with only the narration filled; statementRows joins those to the line above, as it does for Excel.
 * Pure (no database): tests/pdfStatement.test.js.
 */
const pdf = require("./pdfRead");

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 8; };

/** Items of one page -> lines, top to bottom, each with its items left to right. */
function linesOf(items, size) {
    const tol = Math.max(1.5, size * 0.45);
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of sorted) {
        const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
        if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    for (const l of lines) l.items.sort((a, b) => a.x - b.x);
    return lines.sort((a, b) => b.y - a.y);
}

/** Pieces of text close together on a line (the words of a label) become one cell. */
function cellsOf(line, size) {
    const cells = [];
    for (const it of line.items) {
        const last = cells[cells.length - 1];
        if (last && it.x - last.x1 <= Math.max(2, size * 0.7)) { last.text += (it.x - last.x1 > size * 0.12 ? " " : "") + it.text; last.x1 = Math.max(last.x1, it.x2); }
        else cells.push({ x0: it.x, x1: it.x2, text: it.text });
    }
    return cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, " ").trim() })).filter((c) => c.text);
}

const isHeader = (cells) => {
    const t = cells.map((c) => c.text.toLowerCase()).join(" | ");
    return /date/.test(t) && /balance/.test(t) && /(withdraw|deposit|debit|credit|amount|\bdr\b|\bcr\b)/.test(t) && cells.length >= 4;
};

/** The extra lines of a two-line header ("Tran" / "Type"): lines right under the header with no digits that sit inside its columns. */
function headerExtra(lines, from, columns, size) {
    const extra = [];
    let prevY = lines[from - 1].y;
    for (let i = from; i < lines.length; i++) {
        const l = lines[i];
        if (prevY - l.y > size * 1.9) break;
        const cells = cellsOf(l, size);
        if (!cells.length || cells.some((c) => /\d/.test(c.text)) || !cells.every((c) => columns.some((col) => c.x0 <= col.x1 + 3 && c.x1 >= col.x0 - 3))) break;
        extra.push(cells); prevY = l.y;
    }
    return extra;
}

/** Where each column is: from its header's left and right edge to the middle of the gap to the next one. */
function regionsOf(columns) {
    return columns.map((c, i) => ({
        ...c,
        lo: i === 0 ? -Infinity : (columns[i - 1].x1 + c.x0) / 2,
        hi: i === columns.length - 1 ? Infinity : (c.x1 + columns[i + 1].x0) / 2
    }));
}

const columnOf = (regions, it) => {
    let best = -1, bestOverlap = 0;
    regions.forEach((r, i) => { const o = Math.min(it.x2 || it.x, r.hi) - Math.max(it.x, r.lo); if (o > bestOverlap) { best = i; bestOverlap = o; } });
    if (best >= 0) return best;
    const mid = (it.x + (it.x2 || it.x)) / 2;
    regions.forEach((r, i) => { if (mid >= r.lo && mid <= r.hi) best = i; });
    return best;
};

const PAGE_NO = /^\s*(page\s*)?\d+\s*(of|\/)\s*\d+\s*$|^\s*page\s*\d+\s*$/i;

/** -> { table, columns, rows } where table is [header labels, ...rows] of strings. Throws .code "no_table" when no header line is found. */
function tableFromDoc(doc) {
    const size = median(doc.pages.flatMap((p) => p.items.map((i) => i.size).filter((s) => s > 1)));
    let regions = null, labels = null;
    const rows = [];
    for (const page of doc.pages) {
        const lines = linesOf(page.items, size);
        let started = regions !== null;                // a later page without its own header continues the same columns
        for (let li = 0; li < lines.length; li++) {
            const cells = cellsOf(lines[li], size);
            if (!cells.length) continue;
            if (isHeader(cells)) {
                const extra = headerExtra(lines, li + 1, cells, size);
                const cols = cells.map((c) => ({ ...c }));
                for (const e of extra) for (const c of e) { const col = cols.find((x) => c.x0 <= x.x1 + 3 && c.x1 >= x.x0 - 3); if (col) col.text += " " + c.text; }
                regions = regionsOf(cols); labels = cols.map((c) => c.text);
                li += extra.length; started = true;
                continue;
            }
            if (!started) continue;
            if (cells.length === 1 && PAGE_NO.test(cells[0].text)) continue;
            const row = labels.map(() => []);
            for (const it of lines[li].items) { const c = columnOf(regions, it); if (c >= 0) row[c].push(it); }
            rows.push(row.map((parts) => {
                let s = "", prev = null;
                for (const it of parts.sort((a, b) => a.x - b.x)) { s += (prev && it.x - prev.x2 > size * 0.12 ? " " : "") + it.text; prev = it; }
                return s.replace(/\s+/g, " ").trim();
            }));
        }
    }
    if (!regions) throw Object.assign(new Error("Could not find the table in this PDF (a line with Date, Balance and Withdrawals/Deposits). Download the statement as Excel or CSV from net banking instead."), { code: "no_table", status: 400 });
    return { table: [labels, ...rows.filter((r) => r.some(Boolean))], columns: labels, rows: rows.length };
}

/** Opens the PDF (with its password if it has one) and returns the statement table. Throws the pdfRead error codes, or "no_table". */
function tableFromPdf(buffer, password) {
    return tableFromDoc(pdf.openPdf(buffer, password)).table;
}

module.exports = { tableFromPdf, tableFromDoc, linesOf, cellsOf, regionsOf, isPdf: pdf.isPdf };
