/*
 * Money from bank messages and statements: parsing, categories and the reconcile logic. Pure functions (no database, no network)
 * so they can be tested; utils/sheets.js talks to Google Sheets and router/expenses.js ties it together.
 */
const zlib = require("zlib");

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const kit = require("./statementKit");
const num = (s) => Number(String(s).replace(/[,\s]/g, ""));
const round2 = (n) => Math.round(n * 100) / 100;

/** "21Oct26", "21-Oct-2026", "21/10/2026", "21-10-26", "2026-10-21" -> "2026-10-21" or null. */
function parseDate(text) {
    const t = String(text || "").trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = /^(\d{1,2})[\s\-\/.]?([A-Za-z]{3})[A-Za-z]*[\s\-\/.]?(\d{2,4})/.exec(t);
    if (m && MONTHS[m[2].toLowerCase()]) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
    m = /^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2,4})/.exec(t);
    if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}`;
    if (/^\d{5}(\.\d+)?$/.test(t)) {                      // an Excel serial date
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000);
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    return null;
}

/**
 * One bank SMS -> { date, time, amount, type: "Debit"|"Credit", counterparty, account, method, ref, balance } or null when it is not a
 * money message (an OTP, an offer…). Built from the Federal Bank format
 *   "Debited Rs 100.00 from a/c X9229 on 21Oct26 19:42 via UPI to Meta Verifie. Ref 629482059838.Bal Rs 2507.75. Not you?Call … -Federal Bank"
 * but tolerant of the usual variants (Credited, ATM/POS/IMPS/NEFT, other date styles).
 */
function parseSms(body) {
    const text = String(body || "").replace(/\s+/g, " ").trim();
    if (!text || /\b(otp|one time password|verification code)\b/i.test(text)) return null;
    const dir = /\b(debited|credited|withdrawn|spent|received|deposited)\b/i.exec(text);
    const amt = /(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d{1,2})?)/i.exec(text);
    if (!dir || !amt) return null;
    if (!/(a\/c|account|federal)/i.test(text)) return null;
    const type = /debited|withdrawn|spent/i.test(dir[1]) ? "Debit" : "Credit";
    const acc = /(?:a\/c|account)\s*(?:no\.?)?\s*[Xx*]*\s*(\d{3,4})\b/i.exec(text);
    const when = /\bon\s+(\d{1,2}\s?[A-Za-z]{3}\s?\d{2,4}|\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})(?:\s+(\d{1,2}:\d{2})(?::\d{2})?)?/i.exec(text);
    const method = /\bvia\s+(UPI|IMPS|NEFT|RTGS|ATM|POS|ECS|NACH)\b/i.exec(text) || /\b(UPI|IMPS|NEFT|RTGS|ATM|POS)\b/i.exec(text);
    const afterWhen = text.slice(when ? text.indexOf(when[0]) + when[0].length : 0);
    const party = /\b(?:via\s+\w+\s+)?(?:to|from|at)\s+(.+?)\s*\.\s*(?:Ref|UPI|Bal|Avl|Not you|Call|-)/i.exec(afterWhen) || /\b(?:to|from|at)\s+(.+?)\s*\.?\s*$/i.exec(afterWhen);
    const ref = /\bRef(?:erence)?\s*(?:No\.?|#|:)?\s*:?\s*([A-Za-z0-9]{6,})/i.exec(text);
    const bal = /\b(?:Bal(?:ance)?|Avl\.?\s*Bal)\s*(?:is\s*)?(?:Rs\.?|INR|₹)?\s*([\d,]+\.\d{2})/i.exec(text);
    return {
        date: when ? parseDate(when[1]) : null, time: when && when[2] ? when[2] : "",
        amount: round2(num(amt[1])), type, counterparty: party ? party[1].trim().slice(0, 60) : "", account: acc ? "X" + acc[1] : "",
        method: method ? method[1].toUpperCase() : "Other", ref: ref ? ref[1] : "", balance: bal ? round2(num(bal[1])) : null
    };
}

/* ───────── is this message believable? ───────── */

/** A bank's sender id looks like "VM-FEDBNK-S" or "FEDBNK"; a phone number does not. */
const bankSender = (a) => { const t = String(a || "").trim(); return t !== "" && !/^\+?[\d\s-]{6,}$/.test(t) && /^[A-Za-z]{2}-[A-Za-z0-9]{3,10}(-[A-Za-z])?$|^[A-Za-z0-9]{4,10}$/.test(t) && /[A-Za-z]/.test(t); };
const ist = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);

/**
 * Reasons to doubt one parsed message (an empty list = it looks genuine). ctx: { sender, receivedAt (ms), knownAccounts, lastBalance
 * (balance after the previous transaction, or null) }. A doubtful entry is written as "Flagged", kept out of the totals and checked
 * against the next bank statement.
 */
function assess(tx, ctx = {}) {
    const f = [];
    if (ctx.sender !== undefined && !bankSender(ctx.sender)) f.push("Came from a phone number, not the bank's sender name");
    if (!tx.date) f.push("No date in the message");
    if (tx.method === "UPI" && !/^\d{12}$/.test(tx.ref || "")) f.push("UPI message without a 12-digit reference");
    else if (!tx.ref && tx.method !== "UPI") f.push("No reference number");
    if (ctx.knownAccounts && ctx.knownAccounts.length && tx.account && !ctx.knownAccounts.includes(tx.account)) f.push(`Account ${tx.account} is not one of your accounts (${ctx.knownAccounts.join(", ")})`);
    if (tx.date && tx.date > ist(ctx.now || Date.now())) f.push("Dated in the future");
    if (ctx.receivedAt && tx.date) {
        const diff = Math.abs(Date.parse(tx.date + "T12:00:00+05:30") - ctx.receivedAt) / 86400000;
        if (diff > 2.5) f.push(`The message arrived ${Math.round(diff)} days away from the date written in it`);
    }
    if (tx.method === "UPI" && tx.amount > 100000) f.push("UPI amount above the 1 lakh limit");
    if (ctx.lastBalance != null && tx.balance != null) {
        const expect = round2(ctx.lastBalance + (tx.type === "Credit" ? tx.amount : -tx.amount));
        if (Math.abs(expect - tx.balance) >= 0.01) f.push(`Balance ${tx.balance} does not follow the previous one (${ctx.lastBalance} ${tx.type === "Credit" ? "+" : "-"} ${tx.amount} = ${expect}); a message may be missing`);
    }
    return f;
}

/* ───────── categories ───────── */

const DEFAULT_CATEGORIES = ["Meta Ads", "Food", "Groceries", "Travel", "Shopping", "Bills & Recharge", "Subscriptions", "Health", "Education", "Rent & Home", "Investments", "Transfers", "Cash", "Salary & Income", "Other", "Uncategorized"];
// keyword (lower case, found inside the merchant text) -> category. The owner's own rules win over these.
const DEFAULT_RULES = [
    ["meta", "Meta Ads"], ["facebook", "Meta Ads"], ["fb ads", "Meta Ads"], ["instagram", "Meta Ads"],
    ["swiggy", "Food"], ["zomato", "Food"], ["restaurant", "Food"], ["cafe", "Food"], ["domino", "Food"], ["pizza", "Food"], ["mcdonald", "Food"], ["kfc", "Food"], ["burger", "Food"], ["biryani", "Food"], ["bakery", "Food"], ["starbucks", "Food"], ["chai", "Food"], ["dhaba", "Food"], ["eatsure", "Food"],
    ["zepto", "Groceries"], ["blinkit", "Groceries"], ["bigbasket", "Groceries"], ["dmart", "Groceries"], ["instamart", "Groceries"], ["grocer", "Groceries"], ["kirana", "Groceries"], ["supermarket", "Groceries"], ["mart", "Groceries"], ["vegetable", "Groceries"], ["milk", "Groceries"],
    ["uber", "Travel"], ["ola", "Travel"], ["rapido", "Travel"], ["irctc", "Travel"], ["redbus", "Travel"], ["makemytrip", "Travel"], ["indigo", "Travel"], ["metro", "Travel"], ["fuel", "Travel"], ["petrol", "Travel"], ["hpcl", "Travel"], ["iocl", "Travel"], ["bpcl", "Travel"], ["fastag", "Travel"],
    ["amazon", "Shopping"], ["flipkart", "Shopping"], ["myntra", "Shopping"], ["ajio", "Shopping"], ["meesho", "Shopping"], ["nykaa", "Shopping"], ["reliance", "Shopping"],
    ["jio", "Bills & Recharge"], ["airtel", "Bills & Recharge"], ["vodafone", "Bills & Recharge"], ["bsnl", "Bills & Recharge"], ["electric", "Bills & Recharge"], ["bescom", "Bills & Recharge"], ["bses", "Bills & Recharge"], ["recharge", "Bills & Recharge"], ["broadband", "Bills & Recharge"], ["excitel", "Bills & Recharge"], ["gas", "Bills & Recharge"], ["water", "Bills & Recharge"], ["dth", "Bills & Recharge"], ["tata play", "Bills & Recharge"],
    ["netflix", "Subscriptions"], ["spotify", "Subscriptions"], ["hotstar", "Subscriptions"], ["prime video", "Subscriptions"], ["youtube", "Subscriptions"], ["google play", "Subscriptions"], ["google one", "Subscriptions"], ["apple", "Subscriptions"], ["openai", "Subscriptions"], ["anthropic", "Subscriptions"], ["render", "Subscriptions"], ["github", "Subscriptions"], ["namecheap", "Subscriptions"], ["godaddy", "Subscriptions"],
    ["pharm", "Health"], ["apollo", "Health"], ["medic", "Health"], ["hospital", "Health"], ["clinic", "Health"], ["1mg", "Health"], ["lab", "Health"], ["dental", "Health"], ["doctor", "Health"],
    ["school", "Education"], ["college", "Education"], ["course", "Education"], ["udemy", "Education"], ["coaching", "Education"], ["fees", "Education"],
    ["rent", "Rent & Home"], ["maintenance", "Rent & Home"], ["society", "Rent & Home"], ["furniture", "Rent & Home"],
    ["zerodha", "Investments"], ["groww", "Investments"], ["upstox", "Investments"], ["mutual", "Investments"], ["sip", "Investments"], ["lic", "Investments"], ["insurance", "Investments"],
    ["tea", "Food"], ["chai", "Food"], ["coffee", "Food"], ["sweets", "Food"], ["bakery", "Food"], ["juice", "Food"], ["dhaba", "Food"], ["canteen", "Food"], ["tiffin", "Food"], ["dairy", "Food"], ["bbnow", "Groceries"], ["vegetable", "Groceries"],
    ["petrol", "Travel"], ["hpcl", "Travel"], ["bpcl", "Travel"], ["iocl", "Travel"], ["fastag", "Travel"], ["toll", "Travel"], ["parking", "Travel"],
    ["recharge", "Bills & Recharge"], ["broadband", "Bills & Recharge"], ["fibernet", "Bills & Recharge"], ["tata play", "Bills & Recharge"], ["dth", "Bills & Recharge"], ["gym", "Health"],
    ["atm", "Cash"], ["cash", "Cash"], ["bank charges", "Other"], ["salary", "Salary & Income"], ["interest", "Salary & Income"], ["refund", "Salary & Income"]
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();

/** category of a merchant: the owner's rules first (longest match), then the defaults, else "Uncategorized". */
function categorize(merchant, type, method, userRules = []) {
    const m = norm(merchant);
    if (method === "ATM") return "Cash";
    if (m) {
        const own = (userRules || []).filter((r) => r && r.match && m.includes(norm(r.match))).sort((a, b) => norm(b.match).length - norm(a.match).length)[0];
        if (own) return own.category;
        const words = m.split(" ");
        for (const [k, cat] of DEFAULT_RULES) {
            if (k.length <= 3 ? words.includes(k) || words.some((w) => w.startsWith(k) && k.length === 3 && w.length <= 6) : m.includes(k)) return cat;
        }
    }
    return "Uncategorized";
}

/** The UPI id inside a merchant text ("Name (abc.def@ybl)", "abc@ybl"): its name part, normalised, or "". Handles are cut short in bank texts, the part before @ is not. */
function vpaOf(merchant) {
    const m = /([a-z0-9][a-z0-9._-]{2,})@[a-z]{2,}/i.exec(String(merchant || ""));
    return m ? norm(m[1]) : "";
}

/** Names that say nothing about who was paid: a rule made from them would sort unrelated payments together. */
const GENERIC = new Set(["", "no remark", "upi", "unknown", "payment", "transfer", "received", "paid", "money", "upi payment", "cash", "na", "none"]);

/**
 * What a rule is made from, so that one choice sorts every payment to or from the same place, past and future:
 * the UPI id when there is one (the same person or shop has one id however the name is spelt, and whichever bank handle follows it),
 * else the first two words of the name. "" for a name that says nothing ("No Remark"): those are sorted one by one.
 */
function ruleKey(merchant) {
    const v = vpaOf(merchant);
    if (v && v.replace(/ /g, "").length >= 5) return v;
    const k = norm(merchant).split(" ").slice(0, 2).join(" ");
    return GENERIC.has(k) || k.length < 3 ? "" : k;
}

/* ───────── sheet rows ───────── */

const HEADERS = ["Date", "Time", "Amount", "Type", "Merchant", "Category", "Account", "Method", "Reference", "Balance", "Source", "Status", "Note", "Month", "SMS received", "Flags"];

function rowFromTx(t, category, source = "SMS", status = "Unverified", note = "", receivedAt = 0, flags = []) {
    return [t.date || "", t.time || "", t.amount, t.type, t.counterparty || "", category, t.account || "", t.method || "", t.ref || "", t.balance == null ? "" : t.balance, source, status, note, (t.date || "").slice(0, 7), receivedAt ? new Date(receivedAt).toISOString() : "", (flags || []).join(" | ")];
}

/** One transaction as a plain object (what the stores keep and the API returns): `p` is a parsed message or a statement line. */
function makeTx(p, category, source = "SMS", status = "Unverified", note = "", receivedAt = 0, flags = []) {
    return { date: p.date || "", time: p.time || "", amount: p.amount, type: p.type, merchant: p.counterparty !== undefined ? p.counterparty : (p.merchant || ""), category, account: p.account || "", method: p.method || "", ref: p.ref || "",
        balance: p.balance == null ? null : p.balance, source, status, note, month: (p.date || "").slice(0, 7), received: receivedAt ? new Date(receivedAt).toISOString() : "", flags: [...flags] };
}
/** The sheet row for such an object. */
const txToRow = (t) => rowFromTx({ ...t, counterparty: t.merchant }, t.category, t.source, t.status, t.note, t.received ? Date.parse(t.received) : 0, t.flags || []);

function txFromRow(r, index) {
    return { index, date: String(r[0] || ""), time: String(r[1] || ""), amount: Number(r[2]) || 0, type: String(r[3] || ""), merchant: String(r[4] || ""), category: String(r[5] || "Uncategorized"),
        account: String(r[6] || ""), method: String(r[7] || ""), ref: String(r[8] || ""), balance: r[9] === "" || r[9] == null ? null : Number(r[9]), source: String(r[10] || ""), status: String(r[11] || ""), note: String(r[12] || ""), month: String(r[13] || String(r[0] || "").slice(0, 7)), received: String(r[14] || ""), flags: String(r[15] || "") ? String(r[15]).split(" | ") : [] };
}

/**
 * Two phones can hold different halves of the same month. An entry saved before the other half arrived was flagged because its balance
 * did not follow the one before it (that one was missing). Once the missing messages are in, an entry flagged ONLY for that reason
 * and whose balance now follows is cleared. Returns [{ index, fields, tx }] for the store's updateMany.
 */
function reclearBalanceFlags(all) {
    const key = (t) => `${t.date} ${t.time || ""}`;
    const withBal = all.filter((t) => t.balance != null && t.date).sort((a, b) => key(a).localeCompare(key(b)));
    const out = [];
    for (const t of all) {
        const flags = t.flags || [];
        if (t.status !== "Flagged" || !flags.length || !flags.every((f) => /^Balance .* does not follow/.test(f))) continue;
        let prev = null;
        for (const o of withBal) { if (o === t || key(o) >= key(t)) { if (o !== t && key(o) >= key(t)) break; continue; } prev = o; }
        if (!prev || t.balance == null) continue;
        const expect = round2(prev.balance + (t.type === "Credit" ? t.amount : -t.amount));
        if (Math.abs(expect - t.balance) < 0.01) out.push({ index: t.index, fields: { status: "Unverified", flags: [], note: "Balance now follows: the missing messages came from another phone" }, tx: t });
    }
    return out;
}

const sameTx = (a, b) => (a.ref && b.ref ? a.ref === b.ref : a.date === b.date && a.time === b.time && a.amount === b.amount && norm(a.merchant) === norm(b.merchant));

/** Entries that are not counted in the totals until the owner decides: doubtful messages, and rows the bank statement did not confirm. */
const DOUBTFUL = ["Flagged", "Not in statement", "Mismatch"];

function summarize(rows) {
    const by = new Map();
    let debit = 0, credit = 0, flagged = 0;
    for (const t of rows) {
        if (DOUBTFUL.includes(t.status)) { flagged++; continue; }     // doubtful entries are not counted until they are confirmed
        if (t.type === "Debit") { debit += t.amount; const e = by.get(t.category) || { category: t.category, amount: 0, count: 0 }; e.amount = round2(e.amount + t.amount); e.count++; by.set(t.category, e); }
        else if (t.type === "Credit") credit += t.amount;
    }
    return { flagged, debit: round2(debit), credit: round2(credit), net: round2(credit - debit), byCategory: [...by.values()].sort((a, b) => b.amount - a.amount) };
}

/* ───────── bank statements (CSV or Excel) ───────── */

/** CSV text -> rows of text; the delimiter (comma, tab, semicolon, pipe) is found from the file itself. */
function parseCsv(text) { return kit.parseDelimited(text); }

/** A tiny .xlsx reader (zip + XML, no libraries): the first worksheet as rows of text. */
function parseXlsx(buf) {
    const files = {};
    let end = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error("This is not an Excel file.");
    let p = buf.readUInt32LE(end + 16);
    const count = buf.readUInt16LE(end + 10);
    for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
        const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
        const name = buf.toString("utf8", p + 46, p + 46 + nlen);
        if (/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(name)) {
            const lh = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
            const data = buf.subarray(lh, lh + csize);
            files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
        }
        p += 46 + nlen + elen + clen;
    }
    const un = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    const shared = [...(files["xl/sharedStrings.xml"] || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => un(m[1]));
    const sheetName = Object.keys(files).filter((k) => k.startsWith("xl/worksheets/")).sort()[0];
    if (!sheetName) throw new Error("No sheet found in the Excel file.");
    const col = (ref) => ref.replace(/\d+/g, "").split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const rows = [];
    for (const r of files[sheetName].matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const ref = /r="([A-Z]+\d+)"/.exec(c[1]), t = /t="(\w+)"/.exec(c[1]);
            const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] || ""), is = /<is>([\s\S]*?)<\/is>/.exec(c[2] || "");
            cells[ref ? col(ref[1]) : cells.length] = t && t[1] === "s" && v ? shared[Number(v[1])] : is ? un(is[1]) : v ? un(v[1]) : "";
        }
        if (cells.some((x) => x && String(x).trim())) rows.push(Array.from(cells, (x) => x ?? ""));
    }
    return rows;
}

/**
 * Rows of text -> [{ date, desc, amount, type, balance, ref }], oldest first. The header row is found by what its cells mean (Date /
 * Particulars / Withdrawals / Deposits / Balance, or one Amount column with Dr/Cr), whatever the bank calls them. A narration that
 * continues on the next row (no date there) is joined to the line above, opening/closing balance rows and totals are skipped, and a
 * statement listed newest first is turned round (checked against its own running balance when the dates cannot tell).
 */
function statementRows(table) {
    const low = (v) => String(v ?? "").toLowerCase().replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
    const rolesOf = (cells) => {
        const r = { date: -1, valueDate: -1, desc: -1, deb: -1, cred: -1, amt: -1, dc: -1, bal: -1, id: -1 };
        cells.forEach((c, i) => {
            if (!c) return;
            if (/^value ?date$|^val date$/.test(c)) { if (r.valueDate < 0) r.valueDate = i; }
            else if (/^(txn|tran|trans|transaction|posting|post)? ?date$/.test(c)) { if (r.date < 0) r.date = i; }
            else if (/dr ?\/ ?cr|cr ?\/ ?dr|^type$|^indicator$|debit ?\/ ?credit|credit ?\/ ?debit/.test(c)) { if (r.dc < 0) r.dc = i; }
            else if (/particular|narration|description|details|remark/.test(c)) { if (r.desc < 0) r.desc = i; }
            else if (/withdraw|debit|paid out|^dr( amount| amt)?$|amount dr|^dr amt/.test(c)) { if (r.deb < 0) r.deb = i; }
            else if (/deposit|credit|paid in|^cr( amount| amt)?$|amount cr|^cr amt/.test(c)) { if (r.cred < 0) r.cred = i; }
            else if (/balance/.test(c)) { if (r.bal < 0 || /closing|running/.test(c)) r.bal = i; }
            else if (/^(txn |tran |transaction )?(amount|amt)/.test(c)) { if (r.amt < 0) r.amt = i; }
            else if (/tran(saction)? ?id|ref|utr|chq|cheque|instrument/.test(c)) { if (r.id < 0) r.id = i; }
        });
        return r;
    };
    let h = -1, R = null;
    for (let i = 0; i < Math.min(table.length, 80); i++) {
        const r = rolesOf(table[i].map(low));
        if (r.date >= 0 && r.bal >= 0 && (r.deb >= 0 || r.cred >= 0 || r.amt >= 0)) { h = i; R = r; break; }
    }
    if (h < 0) throw new Error("Could not find the table in this statement. Download it as Excel or CSV from net banking (columns like Date, Particulars, Withdrawals, Deposits, Balance).");
    const body = table.slice(h + 1);
    if (R.desc < 0) {                                         // no recognisable narration column: the widest text column is it
        let best = -1, bestLen = 0;
        for (let c = 0; c < (table[h] || []).length; c++) {
            if ([R.date, R.valueDate, R.deb, R.cred, R.amt, R.dc, R.bal, R.id].includes(c)) continue;
            const len = body.slice(0, 40).reduce((n, r) => n + String(r[c] ?? "").length, 0);
            if (len > bestLen) { best = c; bestLen = len; }
        }
        R.desc = best;
    }
    const dateOf = (r) => parseDate(r[R.date]) || (R.valueDate >= 0 ? parseDate(r[R.valueDate]) : null);
    const out = [];
    let last = null;
    for (const r of body) {
        const text = R.desc >= 0 ? String(r[R.desc] ?? "").replace(/\s+/g, " ").trim() : "";
        const date = dateOf(r);
        const dv = R.deb >= 0 ? kit.money(r[R.deb]) : null, cv = R.cred >= 0 ? kit.money(r[R.cred]) : null, av = R.amt >= 0 ? kit.money(r[R.amt]) : null;
        const hasAmount = Boolean((dv && dv !== 0) || (cv && cv !== 0) || (av && av !== 0));
        if (!date || !hasAmount) {
            // the rest of the narration on the next row; anything else (opening balance, totals, notes) is not a transaction
            if (last && text && !hasAmount && !(r[R.bal] != null && String(r[R.bal]).trim()) && !/total|opening|closing|brought forward|carried|statement/i.test(text)) last.desc = `${last.desc} ${text}`.trim();
            continue;
        }
        let amount = 0, type = "";
        if (dv && dv !== 0) { amount = Math.abs(dv); type = "Debit"; }
        else if (cv && cv !== 0) { amount = Math.abs(cv); type = "Credit"; }
        else {
            amount = Math.abs(av);
            const ind = R.dc >= 0 ? String(r[R.dc] ?? "") : String(r[R.amt] ?? "");
            type = /\bdr\b|debit|withdraw/i.test(ind) ? "Debit" : /\bcr\b|credit|deposit/i.test(ind) ? "Credit" : av < 0 ? "Debit" : "Credit";
        }
        const idCell = R.id >= 0 ? String(r[R.id] ?? "") : "";
        const ref = (/\b(\d{12})\b/.exec(`${text} ${idCell}`) || /\b([A-Z]{4}[A-Z0-9]\d{11})\b/.exec(`${text} ${idCell}`) || [])[1] || "";
        const bal = R.bal >= 0 ? kit.money(r[R.bal]) : null;
        last = { date, desc: text, amount: round2(amount), type, balance: bal == null ? null : round2(bal), ref };
        out.push(last);
    }
    // oldest first: by the dates, or (a single day) by whichever order the running balance follows
    const breaks = (a) => { let n = 0; for (let i = 1; i < a.length; i++) { if (a[i - 1].balance == null || a[i].balance == null) continue; if (Math.abs(round2(a[i - 1].balance + (a[i].type === "Credit" ? a[i].amount : -a[i].amount)) - a[i].balance) >= 0.01) n++; } return n; };
    let ordered = out;
    if (out.length > 1) {
        const first = out[0].date, end = out[out.length - 1].date;
        if (first > end) ordered = out.slice().reverse();
        else if (first === end) { const rev = out.slice().reverse(); if (breaks(rev) < breaks(out)) ordered = rev; }
    }
    return ordered;
}

/**
 * Which statement lines Stashr may take: nothing before the start date the owner chose, and, in Stashr storage, nothing older than
 * the 4-month limit (a Google Sheet keeps older rows in its Archive tab, so only the start date applies there).
 * -> { kept, beforeStart, tooOld }
 */
function limitStatement(stmt, { startDate = "", cutoff = "", keepsOld = false } = {}) {
    let beforeStart = 0, tooOld = 0;
    const kept = [];
    for (const x of stmt) {
        if (startDate && x.date < startDate) { beforeStart++; continue; }
        if (!keepsOld && cutoff && x.date < cutoff) { tooOld++; continue; }
        kept.push(x);
    }
    return { kept, beforeStart, tooOld };
}

/**
 * The bank statement is the truth. Every statement line is paired with one stored entry (the same reference, or failing that the same
 * type and amount within a day with the references not in conflict; the same day and a similar name win). The paired entry is made to
 * say what the statement says: its date, amount, type, running balance and, when the message said "unknown" or cut the name short, its
 * headline; it becomes "Verified". A line with no entry is added. An entry inside the statement's dates that no line matches is
 * "Not in statement" (left out of the totals until the owner decides). Also reports, month by month, whether Stashr's totals now
 * equal the statement's, and where the statement's own running balance breaks.
 *
 * -> { updates: [{ index, status, note, fields }], additions: [tx fields], report }
 */
function reconcile(sheetRows, stmt, userRules = [], opts = {}) {
    const used = new Set();
    const updates = [], additions = [];
    const dates = stmt.map((s) => s.date).sort();
    const from = dates[0], to = dates[dates.length - 1];
    // A statement does not have to be the whole history, and one taken today may stop in the middle of today. What it does not have is
    // only judged for the days it covers completely: entries of today (the statement's last day, when that is today) are left alone.
    const dayBefore = (iso) => new Date(Date.parse(iso + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    const settledTo = opts.today && to >= opts.today ? dayBefore(to) : to;
    // For months that are over, the statement is the only truth: even an entry the owner confirmed by hand is set aside when it is not in it.
    const pastMonth = (d) => Boolean(opts.today) && d.slice(0, 7) < opts.today.slice(0, 7);
    const info = stmt.map((s) => kit.describeLine(s.desc));
    const dayGap = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
    const pairs = new Map();                                  // statement line index -> stored entry

    stmt.forEach((s, i) => {                                  // 1. the same reference
        if (!s.ref) return;
        const hit = sheetRows.find((t) => !used.has(t.index) && t.ref && t.ref === s.ref);
        if (hit) { pairs.set(i, hit); used.add(hit.index); }
    });
    for (const maxGap of [0, 1]) {                            // 2. the same day first, then a day either side
        stmt.forEach((s, i) => {
            if (pairs.has(i)) return;
            let best = null, bestScore = -1;
            for (const t of sheetRows) {
                if (used.has(t.index) || t.type !== s.type || Math.abs(t.amount - s.amount) >= 0.005) continue;
                if (t.ref && s.ref && t.ref !== s.ref) continue;                       // two different payments that happen to cost the same
                if (dayGap(t.date, s.date) > maxGap) continue;
                const score = kit.nameMatch(t.merchant, info[i].merchant) * 3 + (t.ref && s.ref ? 5 : 0);
                if (score > bestScore) { best = t; bestScore = score; }
            }
            if (best) { pairs.set(i, best); used.add(best.index); }
        });
    }

    let verified = 0, mismatched = 0, renamed = 0;
    const finalRows = [];
    stmt.forEach((s, i) => {
        const t = pairs.get(i);
        if (!t) return;
        const fields = {}, notes = [];
        if (t.date !== s.date) { fields.date = s.date; fields.month = s.date.slice(0, 7); notes.push(`date ${t.date} → ${s.date}`); }
        const wrong = Math.abs(t.amount - s.amount) >= 0.005 || t.type !== s.type;
        if (Math.abs(t.amount - s.amount) >= 0.005) { fields.amount = s.amount; notes.push(`amount ${t.amount} → ${s.amount}`); }
        if (t.type !== s.type) { fields.type = s.type; notes.push(`${t.type} → ${s.type}`); }
        if (!t.ref && s.ref) fields.ref = s.ref;
        if (s.balance != null && t.balance !== s.balance) fields.balance = s.balance;
        const name = kit.betterName(t.merchant, info[i].merchant);
        if (name && name !== t.merchant) { fields.merchant = name; renamed++; }
        if ((!t.method || t.method === "Other") && info[i].method !== "Other") fields.method = info[i].method;
        if (!t.category || t.category === "Uncategorized") {
            const c = categorize(fields.merchant || t.merchant, s.type, fields.method || t.method, userRules);
            if (c !== "Uncategorized") fields.category = c;
        }
        fields.status = "Verified"; fields.flags = [];
        // a note is only touched when there is something to say, or an old warning to clear; "Added from your statement" and the owner's own notes stay
        if (notes.length) fields.note = `Corrected from the bank statement: ${notes.join(", ")}`;
        else if (/^(Not found in the statement|Verified; balance|Statement says)/.test(t.note || "")) fields.note = "";
        updates.push({ index: t.index, status: "Verified", note: fields.note !== undefined ? fields.note : t.note || "", fields });
        if (wrong) mismatched++; else verified++;
        finalRows.push({ ...t, ...fields });
    });
    stmt.forEach((s, i) => {
        if (pairs.has(i)) return;
        const merchant = info[i].merchant || s.desc.slice(0, 40);
        const t = { date: s.date, time: "", amount: s.amount, type: s.type, counterparty: merchant, account: "", method: info[i].method, ref: s.ref, balance: s.balance };
        const add = { ...t, category: categorize(merchant, s.type, info[i].method, userRules) };
        additions.push(add);
        finalRows.push({ date: s.date, amount: s.amount, type: s.type, status: "Verified", category: add.category });
    });
    // entries the statement does not have (inside its dates; the owner's own "Confirmed" and earlier-verified rows are left alone)
    // (an entry an EARLIER statement or message verified is not safe either: when this newer statement is the truth for these dates and does
    // not have it, it is a duplicate or from another account, and keeping it counted is what made months "differ". Only the owner's own
    // "Confirmed" stays. Nothing is deleted: it is set aside, listed under Needs checking, and the owner decides.)
    const missing = sheetRows.filter((t) => !used.has(t.index) && t.date >= from && t.date <= settledTo && (t.status !== "Confirmed" || pastMonth(t.date)));
    for (const t of missing) {
        const note = t.status === "Confirmed" ? "Not in your bank statement (you had confirmed it, but that month is over and the statement is the truth)" : t.status === "Verified" ? "Not found in the newer statement you sent (an earlier check had verified it)" : "Not found in the statement you sent";
        updates.push({ index: t.index, status: "Not in statement", note, fields: { status: "Not in statement", note } });
    }
    for (const t of sheetRows) {
        if (!used.has(t.index) && t.date >= from && t.date <= to) finalRows.push(missing.includes(t) ? { ...t, status: "Not in statement" } : t);
    }

    const breaks = [];
    for (let i = 1; i < stmt.length; i++) {
        const a = stmt[i - 1], b = stmt[i];
        if (a.balance == null || b.balance == null) continue;
        const expect = round2(a.balance + (b.type === "Credit" ? b.amount : -b.amount));
        if (Math.abs(expect - b.balance) >= 0.01) breaks.push({ date: b.date, desc: b.desc.slice(0, 50), expected: expect, got: b.balance });
    }

    // does each month now add up to the statement? (only the days the statement covers)
    const byMonth = new Map();
    for (const s of stmt) {
        if (s.date > settledTo) continue;
        const m = byMonth.get(s.date.slice(0, 7)) || { month: s.date.slice(0, 7), statementDebit: 0, statementCredit: 0, lines: 0 };
        if (s.type === "Debit") m.statementDebit = round2(m.statementDebit + s.amount); else m.statementCredit = round2(m.statementCredit + s.amount);
        m.lines++; byMonth.set(m.month, m);
    }
    const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => {
        const mine = summarize(finalRows.filter((t) => t.date && t.date.slice(0, 7) === m.month && t.date >= from && t.date <= settledTo));
        const aside = missing.filter((t) => t.date.slice(0, 7) === m.month);
        const asideSum = (type) => round2(aside.filter((t) => t.type === type).reduce((n, t) => n + Number(t.amount || 0), 0));
        return { ...m, setAside: aside.length, setAsideDebit: asideSum("Debit"), setAsideCredit: asideSum("Credit"), stashrDebit: round2(mine.debit), stashrCredit: round2(mine.credit), match: Math.abs(mine.debit - m.statementDebit) < 0.01 && Math.abs(mine.credit - m.statementCredit) < 0.01 };
    });

    return { updates, additions, report: { from, to, lines: stmt.length, verified, mismatched, added: additions.length, renamed, notInStatement: missing.length, months, allMonthsMatch: months.every((m) => m.match),
        closingBalance: stmt.length ? stmt[stmt.length - 1].balance : null, balanceBreaks: breaks.slice(0, 20), balanceBreakCount: breaks.length } };
}

module.exports = { vpaOf, makeTx, txToRow, assess, bankSender, ist, parseDate, parseSms, categorize, ruleKey, norm, DEFAULT_CATEGORIES, DEFAULT_RULES, HEADERS, rowFromTx, txFromRow, sameTx, reclearBalanceFlags, DOUBTFUL, limitStatement, summarize, parseCsv, parseXlsx, statementRows, reconcile, round2 };
