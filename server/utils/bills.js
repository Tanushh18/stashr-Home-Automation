/**
 * Bills: the pure parts (checking the fields, due-state, monthly repeat, reading an amount and due date out of bill text) and the
 * once-a-day Telegram note. Nothing here logs an account number.
 */
const Bill = require("../models/bill");
const { sealJSONWithKey, unsealJSONWithKey } = require("../models/EncDecManager");

const DAY = 86400000;
const DEFAULT_DAYS = 3;
const NOTIFY_FROM_MINUTE = 9 * 60;                       // the daily Telegram note goes out from 09:00 India time
const ist = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
const minutesIST = (ms) => { const d = new Date(ms + 5.5 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const dayNum = (s) => Math.round(Date.parse(`${s}T00:00:00Z`) / DAY);
const daysBetween = (from, to) => dayNum(to) - dayNum(from);

/** "2026-01-31" + 1 month = "2026-02-28" (the day is kept as far as the month allows). */
function addMonth(day, n = 1) {
    const [y, m, d] = day.split("-").map(Number);
    const t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = (t % 12) + 1;
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

const err = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

/** Checks a body for create (full) or update (partial). Returns the cleaned fields, or throws a 400. */
function cleanFields(b, { partial = false } = {}) {
    b = b || {};
    const out = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
    if (!partial || has("name")) { out.name = clean(b.name, 80); if (!out.name) throw err("Give the bill a name (the provider)."); }
    if (!partial || has("dueDate")) { if (!isDay(b.dueDate)) throw err("Pick the due date."); out.dueDate = b.dueDate; }
    if (has("billDate")) { if (b.billDate && !isDay(b.billDate)) throw err("The bill date is not a valid date."); out.billDate = b.billDate || ""; }
    if (has("amount")) {
        if (b.amount === "" || b.amount === null) out.amount = null;
        else { const n = Number(b.amount); if (!Number.isFinite(n) || n < 0 || n > 1e9) throw err("Enter the amount as a number."); out.amount = Math.round(n * 100) / 100; }
    }
    if (has("repeat")) out.repeat = b.repeat === true;
    if (has("account")) out.account = clean(b.account, 60);
    if (has("notes")) out.notes = clean(b.notes, 300);
    const bd = out.billDate !== undefined ? out.billDate : "";
    if (out.dueDate && bd && bd > out.dueDate) throw err("The due date cannot be before the bill date.");
    return out;
}

const openSecret = (key, enc) => { if (!enc) return { account: "", notes: "" }; try { return { account: "", notes: "", ...unsealJSONWithKey(key, enc) }; } catch (e) { return { account: "", notes: "", broken: true }; } };
const seal = (key, s) => sealJSONWithKey(key, { account: s.account || "", notes: s.notes || "" });

/** overdue | today | soon (within `days`) | later | paid, and how many days away. */
function stateOf(bill, today, days = DEFAULT_DAYS) {
    if (bill.status === "paid") return { state: "paid", days: null };
    const d = daysBetween(today, bill.dueDate);
    return { state: d < 0 ? "overdue" : d === 0 ? "today" : d <= days ? "soon" : "later", days: d };
}

/** What the website and the apps get: the account number is opened here and only here. */
function publicBill(doc, key, today, days = DEFAULT_DAYS) {
    const s = openSecret(key, doc.enc);
    const st = stateOf(doc, today, days);
    return { id: String(doc._id), name: doc.name, account: s.account, notes: s.notes, amount: doc.amount, billDate: doc.billDate, dueDate: doc.dueDate, status: doc.status, paidAt: doc.paidAt, paidAmount: doc.paidAmount, repeat: Boolean(doc.repeat), inMoney: Boolean(doc.txIndex), state: st.state, daysLeft: st.days };
}

const dueSort = (a, b) => (a.status === b.status ? a.dueDate.localeCompare(b.dueDate) : a.status === "unpaid" ? -1 : 1);

const money = (n) => (n == null ? "" : ` ₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** One line per bill for the Telegram note. Never has the account number. */
function noteText(bills, today) {
    const lines = bills.map((b) => {
        const d = daysBetween(today, b.dueDate);
        const when = d < 0 ? `overdue by ${-d} day${d === -1 ? "" : "s"}` : d === 0 ? "due today" : d === 1 ? "due tomorrow" : `due in ${d} days`;
        return `• ${esc(b.name)}${money(b.amount)} - ${when} (${b.dueDate})`;
    });
    return `🧾 <b>STASHR BILLS</b>\n${lines.join("\n")}`;
}

/** Unpaid bills overdue or due within `days` for one owner, soonest first. */
async function dueList(owner, today, days = DEFAULT_DAYS) {
    const limit = ist(Date.parse(`${today}T00:00:00Z`) + days * DAY - 5.5 * 3600000 + 5.5 * 3600000);
    return Bill.find({ owner, status: "unpaid", dueDate: { $lte: limit } }).sort({ dueDate: 1 }).lean();
}

/**
 * Once a day (from 09:00 India time) sends each owner one Telegram note of the bills that are overdue or due within 3 days.
 * `send(owner, text)` is injected (the real one is the user's Telegram bot). Returns how many owners were told.
 */
async function dailyNote({ now = Date.now(), send, days = DEFAULT_DAYS } = {}) {
    if (minutesIST(now) < NOTIFY_FROM_MINUTE) return 0;
    const today = ist(now);
    const owners = await Bill.distinct("owner", { status: "unpaid", dueDate: { $lte: addMonth(today, 1) } });
    let told = 0;
    for (const owner of owners) {
        const due = (await dueList(owner, today, days)).filter((b) => b.notifiedDay !== today);
        if (!due.length) continue;
        // claim first (a second server or a second minute cannot repeat it), then send
        const claimed = [];
        for (const b of due) { const r = await Bill.updateOne({ _id: b._id, notifiedDay: { $ne: today } }, { $set: { notifiedDay: today } }); if (r.modifiedCount) claimed.push(b); }
        if (!claimed.length) continue;
        let ok = false;
        try { ok = await send(owner, noteText(claimed, today)); } catch (e) { console.log("[bills] telegram note failed:", e && e.message); }
        if (ok) told++; else await Bill.updateMany({ _id: { $in: claimed.map((b) => b._id) } }, { $set: { notifiedDay: "" } });
    }
    return told;
}

/* ───────── reading a bill (pasted email/SMS text or the text of a PDF) ───────── */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DATE_RE = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})|(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3})[a-z]*[\s,\-]+(\d{2,4})|([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/;
const DATE_G = new RegExp(DATE_RE.source, "g");

function toDay(m) {
    let d, mo, y;
    if (m[1]) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else if (m[4]) { d = +m[4]; mo = MONTHS[m[5].toLowerCase()]; y = +m[6]; }
    else { mo = MONTHS[m[7].toLowerCase()]; d = +m[8]; y = +m[9]; }
    if (!mo || mo > 12 || d < 1 || d > 31) return "";
    if (y < 100) y += 2000;
    const s = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return isDay(s) ? s : "";
}
/** The first date found in `text`, as YYYY-MM-DD ("" when none). */
const firstDate = (text) => { const m = DATE_RE.exec(text); return m ? toDay(m) : ""; };

/** Text of the bill -> { name?, amount, dueDate, billDate, account } with "" / null for what was not found. Never guesses a date without a year. */
function parseBillText(raw) {
    const text = String(raw || "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").slice(0, 60000);
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const after = (label, len = 70) => { const out = []; for (const m of text.matchAll(label)) out.push(text.slice(m.index + m[0].length, m.index + m[0].length + len)); return out; };
    const AMOUNT = /(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
    let amount = null;
    for (const seg of after(/(?:amount\s+(?:payable|due)|total\s+payable(?:\s+amount)?|total\s+(?:amount\s+)?(?:payable|due)|net\s+(?:amount\s+)?payable|bill\s+amount|amount\s+to\s+(?:be\s+)?paid|total\s+bill|pay\s+(?:rs\.?|inr|₹))\W{0,12}/gi)) {
        const m = AMOUNT.exec(seg); const n = m ? Number(m[1].replace(/,/g, "")) : NaN;
        if (Number.isFinite(n) && n > 0 && n < 1e8) { amount = n; break; }
    }
    if (amount === null) { const m = /(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i.exec(text); if (m) amount = Number(m[1].replace(/,/g, "")) || null; }
    let dueDate = "";
    for (const seg of after(/(?:due\s*date|pay\s*(?:by|before|on)|last\s*date(?:\s*(?:of|for)\s*payment)?|payment\s*due(?:\s*date)?|due\s*on|due\s*by)\W{0,12}/gi, 40)) { dueDate = firstDate(seg); if (dueDate) break; }
    let billDate = "";
    for (const seg of after(/(?:bill\s*(?:issue\s*)?date|date\s*of\s*issue|invoice\s*date|statement\s*date|date\s*of\s*bill|billed\s*on|bill\s*generated\s*on)\W{0,12}/gi, 40)) { billDate = firstDate(seg); if (billDate) break; }
    let account = "";
    const accRe = /(?:consumer|customer|account|a\/c|ca|k)\s*(?:no\.?|number|id|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/ ]{3,28})/i;
    for (const l of lines) { const m = accRe.exec(l); if (!m) continue; const v = m[1].trim().replace(/\s{2,}.*$/, "").replace(/\s+(?=[A-Za-z]{3,})[A-Za-z].*$/, ""); if (/\d{4}/.test(v)) { account = v.trim(); break; } }
    return { amount, dueDate, billDate, account, found: Boolean(amount || dueDate || account) };
}

/** All the text of a PDF (every page, top to bottom) for parseBillText. */
function pdfText(buffer, password) {
    const pdf = require("./pdfRead"), sp = require("./statementPdf");
    const doc = pdf.openPdf(buffer, password);
    const out = [];
    for (const page of doc.pages) {
        const sizes = page.items.map((i) => i.size).filter(Boolean).sort((a, b) => a - b);
        const size = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 8;
        for (const line of sp.linesOf(page.items, size)) out.push(line.items.map((i) => i.text).join(" "));
    }
    return out.join("\n");
}

module.exports = { DEFAULT_DAYS, ist, isDay, daysBetween, addMonth, cleanFields, openSecret, seal, stateOf, publicBill, dueSort, dueList, noteText, dailyNote, parseBillText, firstDate, pdfText, minutesIST };
