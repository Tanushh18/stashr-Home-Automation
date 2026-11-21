/**
 * My bills: what to pay and by when (signed-in owner).
 *
 *   GET    /bills?days=3          every bill (unpaid by due date, then paid) and the ones due soon/overdue
 *   GET    /bills/due?days=3      only what is overdue or due within `days` (the banner)
 *   POST   /bills                 { name, dueDate, billDate?, amount?, account?, notes?, repeat? }
 *   PATCH  /bills/:id             any of those fields
 *   DELETE /bills/:id
 *   POST   /bills/:id/pay         { amount?, date? } the money goes out as an expense in Money, the bill becomes paid (monthly: next month's bill appears)
 *   POST   /bills/:id/unpay       back to unpaid and the Money entry is removed
 *   POST   /bills/read            { text } or raw PDF bytes (octet-stream): the amount, dates and number it finds; nothing is saved
 * The account number is sealed with the account's data key and is never logged.
 */
const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const Bill = require("../models/bill");
const bills = require("../utils/bills");
const ex = require("../utils/expenses");

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many changes. Slow down." });
const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: "Too many tries. Wait a minute." });
const validId = (id) => /^[a-f0-9]{24}$/.test(String(id || ""));
const fail = (res, e, fallback) => { if (!Number.isInteger(e.status)) console.log("[bills] request failed:", e && e.message); return res.status(Number.isInteger(e.status) ? e.status : 500).json({ error: Number.isInteger(e.status) ? e.message : fallback }); };
const daysOf = (q) => { const n = Number(q); return Number.isFinite(n) ? Math.min(30, Math.max(0, Math.round(n))) : bills.DEFAULT_DAYS; };
const nowOf = (req) => (typeof req.app.get("billsNow") === "function" ? req.app.get("billsNow")() : Date.now());   // tests set the clock

async function mine(req) {
    if (!validId(req.params.id)) throw Object.assign(new Error("Bill not found."), { status: 404 });
    const doc = await Bill.findOne({ _id: req.params.id, owner: req.rootUser._id });
    if (!doc) throw Object.assign(new Error("Bill not found."), { status: 404 });
    return doc;
}
const expenses = () => require("./expenses");

async function view(req, docs, days) {
    const key = await req.rootUser.getDataKey(), today = bills.ist(nowOf(req));
    return docs.map((d) => bills.publicBill(d, key, today, days));
}

router.get("/bills", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const days = daysOf(req.query.days), today = bills.ist(nowOf(req));
        const docs = await Bill.find({ owner: req.rootUser._id }).sort({ dueDate: 1 }).limit(500).lean();
        const list = (await view(req, docs, days)).sort(bills.dueSort);
        res.json({ today, days, bills: list, due: list.filter((b) => b.state === "overdue" || b.state === "today" || b.state === "soon") });
    } catch (e) { fail(res, e, "Could not load the bills."); }
});

router.get("/bills/due", authenticate, async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        const days = daysOf(req.query.days), today = bills.ist(nowOf(req));
        const docs = await bills.dueList(req.rootUser._id, today, days);
        const due = (await view(req, docs, days)).map(({ account, notes, ...rest }) => rest);       // the banner never needs the number
        res.json({ today, days, due });
    } catch (e) { fail(res, e, "Could not load the bills."); }
});

router.post("/bills", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id;
        if (await Bill.countDocuments({ owner }) >= 500) return res.status(400).json({ error: "That is a lot of bills. Delete old ones first." });
        const f = bills.cleanFields(req.body);
        const key = await req.rootUser.getDataKey();
        const doc = await Bill.create({ owner, name: f.name, dueDate: f.dueDate, billDate: f.billDate || "", amount: f.amount === undefined ? null : f.amount, repeat: Boolean(f.repeat), enc: bills.seal(key, f) });
        res.json((await view(req, [doc], bills.DEFAULT_DAYS))[0]);
    } catch (e) { fail(res, e, "Could not add the bill."); }
});

router.patch("/bills/:id", authenticate, writeLimiter, async (req, res) => {
    try {
        const doc = await mine(req);
        const f = bills.cleanFields(req.body, { partial: true });
        const key = await req.rootUser.getDataKey();
        for (const k of ["name", "dueDate", "billDate", "amount", "repeat"]) if (f[k] !== undefined) doc[k] = f[k];
        if (doc.billDate && doc.billDate > doc.dueDate) return res.status(400).json({ error: "The due date cannot be before the bill date." });
        if (f.account !== undefined || f.notes !== undefined) { const cur = bills.openSecret(key, doc.enc); doc.enc = bills.seal(key, { account: f.account !== undefined ? f.account : cur.account, notes: f.notes !== undefined ? f.notes : cur.notes }); }
        if (f.dueDate !== undefined) doc.notifiedDay = "";      // a new due date can be told about again
        await doc.save();
        res.json((await view(req, [doc], bills.DEFAULT_DAYS))[0]);
    } catch (e) { fail(res, e, "Could not save the bill."); }
});

router.delete("/bills/:id", authenticate, writeLimiter, async (req, res) => {
    try { const doc = await mine(req); await doc.deleteOne(); res.json({ ok: true }); } catch (e) { fail(res, e, "Could not delete the bill."); }
});

// Pay: the expense goes into Money first, then the bill is marked. A repeat bill makes next month's.
router.post("/bills/:id/pay", authenticate, writeLimiter, async (req, res) => {
    try {
        const doc = await mine(req), owner = req.rootUser._id, b = req.body || {};
        if (doc.status === "paid") return res.status(409).json({ error: "This bill is already paid." });
        const now = nowOf(req), today = ex.ist(now);
        const amount = ex.round2(Number(b.amount !== undefined && b.amount !== "" ? b.amount : doc.amount));
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return res.status(400).json({ error: "Enter the amount you paid." });
        const date = ex.parseDate(b.date || today);
        if (!date || date > ex.ist(now + 86400000)) return res.status(400).json({ error: "Pick a date that is not in the future." });
        const R = expenses();
        const s = await R.settingsOf(owner);
        const { st, copy } = await R.storeFor(req, s);
        if (st.mode === "db" && date < R.cutoffDate(now)) return res.status(400).json({ error: "That date is older than 4 months; Stashr keeps only the last 4 months in Money." });
        const tx = ex.makeTx({ date, time: "", amount, type: "Debit", counterparty: doc.name, account: "", method: "Bill", ref: `bill:${doc._id}:${doc.dueDate}`, balance: null }, "Bills & Recharge", "Manual", "Confirmed", `Bill: ${doc.name}`, 0, []);
        const saved = await st.append([tx]);
        if (!saved.added && !saved.duplicates) return res.status(500).json({ error: "Could not add it to Money." });
        if (copy && saved.stored[0]) copy.append(saved.stored[0]);
        doc.status = "paid"; doc.paidAt = date; doc.paidAmount = amount; doc.txIndex = saved.stored[0] ? saved.stored[0].index : "";
        if (doc.amount == null) doc.amount = amount;
        await doc.save();
        let next = null;
        if (doc.repeat) {
            const due = bills.addMonth(doc.dueDate, 1);
            if (!(await Bill.exists({ owner, nextOf: doc._id }))) {
                next = await Bill.create({ owner, name: doc.name, enc: doc.enc, amount: doc.amount, billDate: doc.billDate ? bills.addMonth(doc.billDate, 1) : "", dueDate: due, repeat: true, nextOf: doc._id });
            }
        }
        res.json({ bill: (await view(req, [doc], bills.DEFAULT_DAYS))[0], next: next ? (await view(req, [next], bills.DEFAULT_DAYS))[0] : null });
    } catch (e) { fail(res, e, "Could not mark the bill paid."); }
});

router.post("/bills/:id/unpay", authenticate, writeLimiter, async (req, res) => {
    try {
        const doc = await mine(req);
        if (doc.status !== "paid") return res.status(409).json({ error: "This bill is not paid." });
        if (doc.txIndex) {
            try { const R = expenses(); const { st } = await R.storeFor(req, await R.settingsOf(req.rootUser._id)); await st.remove(doc.txIndex); } catch (e) { console.log("[bills] could not remove the Money entry"); }
        }
        doc.status = "unpaid"; doc.paidAt = ""; doc.paidAmount = null; doc.txIndex = "";
        await doc.save();
        await Bill.deleteOne({ owner: req.rootUser._id, nextOf: doc._id, status: "unpaid" });     // the repeat made by paying it
        res.json((await view(req, [doc], bills.DEFAULT_DAYS))[0]);
    } catch (e) { fail(res, e, "Could not undo."); }
});

// Reads pasted bill text (an email or SMS) or an uploaded bill PDF. Nothing is stored; the form is filled from what is found.
router.post("/bills/read", authenticate, readLimiter, express.raw({ type: "application/octet-stream", limit: "6mb" }), async (req, res) => {
    try {
        let text = "";
        if (Buffer.isBuffer(req.body) && req.body.length) {
            let password = "";
            try { password = decodeURIComponent(String(req.get("x-bill-password") || "")); } catch (e) { password = ""; }
            try { text = bills.pdfText(req.body, password); }
            catch (e) {
                if (e.code === "password_required") return res.status(422).json({ code: "password_required", error: "This PDF is locked. Enter its password (often your date of birth or mobile number; see the bill)." });
                if (e.code === "wrong_password") return res.status(422).json({ code: "wrong_password", error: "That password did not unlock the PDF." });
                return res.status(400).json({ error: e.code === "no_text" ? "This PDF is a scan (a picture), so it has no text to read. Paste the text of the bill email instead." : "Could not read that PDF. Paste the text of the bill instead." });
            }
        } else text = String((req.body && req.body.text) || "");
        if (!text.trim()) return res.status(400).json({ error: "Paste the bill text or choose the bill PDF." });
        res.json(bills.parseBillText(text));
    } catch (e) { fail(res, e, "Could not read the bill."); }
});

module.exports = router;
