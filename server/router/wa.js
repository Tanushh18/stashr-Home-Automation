/**
 * The WhatsApp sender's website API (signed-in owner) and the tablet's picture download (device token).
 *
 *   GET    /wa/overview                 settings, the tablet, every sheet with its counts, the last messages
 *   PUT    /wa/settings                 on/off, daily limit, window, gaps, test mode
 *   POST   /wa/sheets                   a new sheet (a list with its own messages and picture)
 *   PATCH  /wa/sheets/:id               name, on/off, limit, messages, picture
 *   DELETE /wa/sheets/:id
 *   POST   /wa/sheets/:id/recipients    add people: [{ name, phone, externalId? }] (duplicates and bad numbers are reported)
 *   POST   /wa/sheets/:id/retry         failed people go back in line
 *   POST   /wa/test                     one message now, ignoring the window, the gap and the limit ({ phone? } or the next person)
 *   GET    /wa/agent/image/:sendId      the picture for a message (tablet token)
 */
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const WaSettings = require("../models/waSettings");
const WaSheet = require("../models/waSheet");
const WaRecipient = require("../models/waRecipient");
const WaSend = require("../models/waSend");
const sender = require("../utils/waSender");
const waLeads = require("../utils/waLeads");
const automation = require("../utils/homeAutomation");

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: "Too many changes. Slow down." });
const imageLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: "Too many requests." });
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES = 5;
const MAX_IMPORT = 5000;
const validId = (id) => /^[a-f0-9]{24}$/.test(String(id || ""));
const fail = (res, e, fallback) => { if (!Number.isInteger(e.status)) console.log("[wa] request failed:", e && e.message); return res.status(Number.isInteger(e.status) ? e.status : 500).json({ error: Number.isInteger(e.status) ? e.message : fallback }); };
const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

function cleanTexts(list) {
    return (Array.isArray(list) ? list : []).map((t) => String(t || "").trim().slice(0, 900)).filter(Boolean).slice(0, 40);
}

/** A data URL for a png, jpeg or webp picture, no bigger than 2 MB. Returns { image, imageType } or throws a 400. */
function cleanImage(dataUrl) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
    if (!m) { const e = new Error("The picture must be a PNG, JPEG or WebP."); e.status = 400; throw e; }
    if (Math.floor((m[2].length * 3) / 4) > MAX_IMAGE_BYTES) { const e = new Error("The picture is over 2 MB."); e.status = 400; throw e; }
    return { image: dataUrl, imageType: m[1] };
}

async function countsFor(owner, day) {
    const rows = await WaRecipient.aggregate([{ $match: { owner } }, { $group: { _id: { sheet: "$sheet", status: "$status" }, n: { $sum: 1 } } }]);
    const bySheet = {};
    for (const r of rows) { const k = String(r._id.sheet); (bySheet[k] = bySheet[k] || {})[r._id.status] = r.n; }
    const todayRows = await WaSend.aggregate([{ $match: { owner, day, kind: "scheduled", status: { $in: ["queued", "sent"] } } }, { $group: { _id: "$sheet", n: { $sum: 1 } } }]);
    const today = {};
    for (const r of todayRows) today[String(r._id)] = r.n;
    return { bySheet, today };
}

const linkLimiter = rateLimit({ windowMs: 60 * 1000, max: 6, message: "Too many tries. Wait a minute." });

router.get("/wa/threads", authenticate, async (req, res) => { try { res.json(await waLeads.statusOf(req.rootUser._id)); } catch (e) { fail(res, e, "Could not load the We Three link."); } });
router.post("/wa/threads/connect", authenticate, linkLimiter, async (req, res) => {
    try { const b = req.body || {}; res.json(await waLeads.connect(req.rootUser._id, b.mobile, b.mpin)); } catch (e) { fail(res, e, "Could not connect to We Three."); }
});
router.delete("/wa/threads", authenticate, writeLimiter, async (req, res) => { try { await waLeads.disconnect(req.rootUser._id); res.json({ ok: true }); } catch (e) { fail(res, e, "Could not disconnect."); } });
router.get("/wa/threads/origins", authenticate, async (req, res) => { try { res.json({ origins: await waLeads.origins(req.rootUser._id) }); } catch (e) { fail(res, e, "Could not read the We Three sheets."); } });
router.post("/wa/threads/import", authenticate, writeLimiter, async (req, res) => {
    try { res.json(await waLeads.importSheet(req.rootUser._id, (req.body || {}).origin, sender.normalizePhone)); } catch (e) { fail(res, e, "Could not import that sheet."); }
});

router.get("/wa/overview", authenticate, async (req, res) => {
    try {
        const owner = req.rootUser._id;
        const settings = await sender.settingsOf(owner);
        const local = automation.localParts(Date.now(), settings.timezone);
        const sheets = await WaSheet.find({ owner }).select("-image").sort({ name: 1 }).lean();
        const imageCounts = {};
        for (const row of await WaSheet.aggregate([{ $match: { owner } }, { $project: { n: { $cond: [{ $gt: [{ $size: { $ifNull: ["$images", []] } }, 0] }, { $size: "$images" }, { $cond: [{ $ne: ["$image", ""] }, 1, 0] }] } } }])) imageCounts[String(row._id)] = row.n;
        const withImage = new Set(Object.keys(imageCounts).filter((k) => imageCounts[k] > 0));
        const { bySheet, today } = await countsFor(owner, local.date);
        const tablet = await sender.tabletOf(owner);
        const recent = await WaSend.find({ owner }).sort({ createdAt: -1 }).limit(30).lean();
        const sentToday = await WaSend.countDocuments({ owner, day: local.date, kind: "scheduled", status: { $in: ["queued", "sent"] } });
        res.json({
            settings, today: local.date, sentToday, tablet: tablet ? { id: tablet._id, name: tablet.name } : null,
            sheets: sheets.map((s) => {
                const c = bySheet[String(s._id)] || {};
                return { ...s, hasImage: withImage.has(String(s._id)), imageCount: imageCounts[String(s._id)] || 0, counts: { pending: c.pending || 0, queued: c.queued || 0, sent: c.sent || 0, failed: c.failed || 0, skipped: c.skipped || 0 }, sentToday: today[String(s._id)] || 0 };
            }),
            recent: recent.map((r) => ({ id: r._id, phone: r.phone, name: r.name, status: r.status, kind: r.kind, result: r.result, at: r.createdAt, doneAt: r.doneAt }))
        });
    } catch (e) { fail(res, e, "Could not load the sender."); }
});

router.put("/wa/settings", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, b = req.body || {};
        const set = {};
        if (typeof b.enabled === "boolean") set.enabled = b.enabled;
        if (typeof b.testMode === "boolean") set.testMode = b.testMode;
        if (b.dailyLimit !== undefined) set.dailyLimit = clamp(b.dailyLimit, 0, 60, 13);
        if (typeof b.reportEnabled === "boolean") set.reportEnabled = b.reportEnabled;
        if (b.reportNumbers !== undefined) {
            const raw = Array.isArray(b.reportNumbers) ? b.reportNumbers : String(b.reportNumbers || "").split(/[,\n;]+/);
            const nums = [...new Set(raw.map((n) => sender.normalizePhone(n)).filter(Boolean))].slice(0, 5);
            if (raw.some((n) => String(n).trim()) && !nums.length) return res.status(400).json({ error: "Enter valid mobile numbers for the report." });
            set.reportNumbers = nums;
        }
        if (b.gapMin !== undefined) set.gapMin = clamp(b.gapMin, 1, 120, 6);
        if (b.gapMax !== undefined) set.gapMax = clamp(b.gapMax, 1, 240, 12);
        for (const k of ["from", "to"]) if (b[k] !== undefined) { if (!automation.okTime(b[k])) return res.status(400).json({ error: `"${k}" must be a time like 10:00.` }); set[k] = b[k]; }
        const cur = await sender.settingsOf(owner);
        const next = { ...cur, ...set };
        if (next.gapMax < next.gapMin) return res.status(400).json({ error: "The longest gap must not be shorter than the shortest." });
        if (sender.windowMinutes(next) <= 0) return res.status(400).json({ error: "The end time must be later than the start time." });
        if (set.enabled === true && !cur.enabled) set.nextDueAt = null;           // turning on: the first message may go now
        const doc = await WaSettings.findOneAndUpdate({ owner }, { $set: set }, { new: true, upsert: true }).lean();
        res.json(doc);
    } catch (e) { fail(res, e, "Could not save the settings."); }
});

router.post("/wa/sheets", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id, b = req.body || {};
        const name = String(b.name || "").trim().slice(0, 80);
        if (!name) return res.status(400).json({ error: "Give the sheet a name." });
        const doc = { owner, name, source: ["leads", "contacts", "manual"].includes(b.source) ? b.source : "manual", dailyLimit: clamp(b.dailyLimit, 0, 60, 0), texts: cleanTexts(b.texts) };
        if (b.image) { const c = cleanImage(b.image); doc.images = [{ data: c.image, mime: c.imageType }]; }
        const sheet = await WaSheet.create(doc);
        res.status(201).json({ id: sheet._id });
    } catch (e) { if (e && e.code === 11000) return res.status(409).json({ error: "A sheet with that name already exists." }); fail(res, e, "Could not create the sheet."); }
});

router.patch("/wa/sheets/:id", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ error: "Sheet not found." });
        const b = req.body || {}, set = {};
        if (typeof b.name === "string" && b.name.trim()) set.name = b.name.trim().slice(0, 80);
        if (typeof b.enabled === "boolean") set.enabled = b.enabled;
        if (b.dailyLimit !== undefined) set.dailyLimit = clamp(b.dailyLimit, 0, 60, 0);
        if (b.texts !== undefined) set.texts = cleanTexts(b.texts);
        const filter = { _id: req.params.id, owner: req.rootUser._id };
        const ops = { $set: set };
        if (b.image === "") { set.image = ""; set.imageType = ""; set.images = []; }                                  // remove every picture
        else if (b.addImage) {                                                                                       // add one picture (up to 5)
            const c = cleanImage(b.addImage);
            const cur = await WaSheet.findOne(filter).select("images image imageType").lean();
            if (!cur) return res.status(404).json({ error: "Sheet not found." });
            const list = sender.imagesOf(cur);
            if (list.length >= MAX_IMAGES) return res.status(400).json({ error: `A sheet can have up to ${MAX_IMAGES} pictures.` });
            set.images = [...list, { data: c.image, mime: c.imageType }]; set.image = ""; set.imageType = "";
        } else if (b.copyImage) {                                                                                    // reuse a picture another sheet already has
            const from = b.copyImage || {}, i = Number(from.index);
            if (!validId(from.sheet)) return res.status(404).json({ error: "Picture not found." });
            const [cur, src] = await Promise.all([
                WaSheet.findOne(filter).select("images image imageType").lean(),
                WaSheet.findOne({ _id: from.sheet, owner: req.rootUser._id }).select("images image imageType").lean()
            ]);
            if (!cur) return res.status(404).json({ error: "Sheet not found." });
            const pics = sender.imagesOf(src);
            if (!src || !Number.isInteger(i) || i < 0 || i >= pics.length) return res.status(404).json({ error: "Picture not found." });
            const list = sender.imagesOf(cur);
            if (list.some((p) => p.data === pics[i].data)) return res.status(409).json({ error: "This sheet already has that picture." });
            if (list.length >= MAX_IMAGES) return res.status(400).json({ error: `A sheet can have up to ${MAX_IMAGES} pictures.` });
            set.images = [...list, { data: pics[i].data, mime: pics[i].mime }]; set.image = ""; set.imageType = "";
        } else if (b.removeImage !== undefined) {                                                                    // remove one picture by position
            const cur = await WaSheet.findOne(filter).select("images image imageType").lean();
            if (!cur) return res.status(404).json({ error: "Sheet not found." });
            const list = sender.imagesOf(cur), i = Number(b.removeImage);
            if (!Number.isInteger(i) || i < 0 || i >= list.length) return res.status(400).json({ error: "No such picture." });
            set.images = list.filter((_, k) => k !== i); set.image = ""; set.imageType = "";
        } else if (b.image) { const c = cleanImage(b.image); set.images = [{ data: c.image, mime: c.imageType }]; set.image = ""; set.imageType = ""; }
        const doc = await WaSheet.findOneAndUpdate(filter, ops, { new: true }).select("-image -images").lean();
        if (!doc) return res.status(404).json({ error: "Sheet not found." });
        res.json(doc);
    } catch (e) { if (e && e.code === 11000) return res.status(409).json({ error: "A sheet with that name already exists." }); fail(res, e, "Could not save the sheet."); }
});

/** Every picture the account's sheets already hold (names and positions only), so one can be reused on another sheet. */
router.get("/wa/pictures", authenticate, async (req, res) => {
    try {
        const rows = await WaSheet.find({ owner: req.rootUser._id }).select("name images image imageType").sort({ name: 1 }).lean();
        const out = [];
        for (const s of rows) sender.imagesOf(s).forEach((_, index) => out.push({ sheet: String(s._id), sheetName: s.name, index }));
        res.json({ pictures: out });
    } catch (e) { fail(res, e, "Could not load the pictures."); }
});

/** One saved picture as a data URL, for the picker's preview. */
router.get("/wa/pictures/:sheet/:index", authenticate, async (req, res) => {
    try {
        if (!validId(req.params.sheet)) return res.status(404).json({ error: "Picture not found." });
        const s = await WaSheet.findOne({ _id: req.params.sheet, owner: req.rootUser._id }).select("images image imageType").lean();
        const pics = sender.imagesOf(s), i = Number(req.params.index);
        if (!s || !Number.isInteger(i) || i < 0 || i >= pics.length) return res.status(404).json({ error: "Picture not found." });
        res.json({ image: pics[i].data });
    } catch (e) { fail(res, e, "Could not load the picture."); }
});

router.delete("/wa/sheets/:id", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ error: "Sheet not found." });
        const owner = req.rootUser._id;
        if (await WaRecipient.exists({ owner, sheet: req.params.id, status: "queued" })) return res.status(409).json({ error: "A message from this sheet is being sent. Try again in a minute." });
        const gone = await WaSheet.deleteOne({ _id: req.params.id, owner });
        if (!gone.deletedCount) return res.status(404).json({ error: "Sheet not found." });
        await WaRecipient.deleteMany({ owner, sheet: req.params.id });
        res.json({ ok: true });
    } catch (e) { fail(res, e, "Could not delete the sheet."); }
});

router.post("/wa/sheets/:id/recipients", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ error: "Sheet not found." });
        const owner = req.rootUser._id;
        const sheet = await WaSheet.findOne({ _id: req.params.id, owner }).select("_id").lean();
        if (!sheet) return res.status(404).json({ error: "Sheet not found." });
        const list = Array.isArray(req.body && req.body.recipients) ? req.body.recipients.slice(0, MAX_IMPORT) : [];
        let invalid = 0;
        const seen = new Set(), rows = [];
        const last = await WaRecipient.findOne({ owner, sheet: sheet._id }).sort({ order: -1 }).select("order").lean();
        let order = (last && last.order) || 0;
        for (const r of list) {
            const phone = sender.normalizePhone(r && r.phone);
            if (!phone) { invalid++; continue; }
            if (seen.has(phone)) continue;
            seen.add(phone);
            rows.push({ owner, sheet: sheet._id, name: String((r && r.name) || "").trim().slice(0, 120), phone, externalId: String((r && r.externalId) || "").slice(0, 80), order: ++order });
        }
        let added = 0;
        if (rows.length) {
            try { const out = await WaRecipient.insertMany(rows, { ordered: false }); added = out.length; }
            catch (e) { added = (e.insertedDocs || []).length || (e.result && e.result.insertedCount) || 0; if (!(e && (e.code === 11000 || e.writeErrors))) throw e; }
        }
        res.json({ added, duplicates: rows.length - added, invalid, total: list.length });
    } catch (e) { fail(res, e, "Could not add the people."); }
});

// For testing: puts every person of a sheet back in line (sent, failed and skipped become pending) so the same test number can be messaged again.
router.post("/wa/sheets/:id/reset", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ error: "Sheet not found." });
        const owner = req.rootUser._id;
        if (await WaRecipient.exists({ owner, sheet: req.params.id, status: "queued" })) return res.status(409).json({ error: "A message from this sheet is being sent. Try again in a minute." });
        const out = await WaRecipient.updateMany({ owner, sheet: req.params.id, status: { $in: ["sent", "failed", "skipped"] } },
            { $set: { status: "pending", attempts: 0, error: "" }, $unset: { sentAt: 1, markedAt: 1 } });
        res.json({ reset: out.modifiedCount || 0 });
    } catch (e) { fail(res, e, "Could not reset the sheet."); }
});

router.post("/wa/sheets/:id/retry", authenticate, writeLimiter, async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ error: "Sheet not found." });
        const out = await WaRecipient.updateMany({ owner: req.rootUser._id, sheet: req.params.id, status: "failed" }, { $set: { status: "pending", attempts: 0, error: "" } });
        res.json({ requeued: out.modifiedCount || 0 });
    } catch (e) { fail(res, e, "Could not requeue."); }
});

// Sends today's report again, to every report number, right away (the next sweep queues it).
router.post("/wa/report/now", authenticate, writeLimiter, async (req, res) => {
    try {
        const owner = req.rootUser._id;
        const s = await sender.settingsOf(owner);
        const day = automation.localParts(Date.now(), s.timezone).date;
        if (await WaSend.exists({ owner, status: "queued" })) return res.status(409).json({ error: "A message is being sent. Try again in a minute." });
        await WaSend.deleteMany({ owner, day, kind: "report", status: { $ne: "queued" } });
        await WaSettings.updateOne({ owner }, { $set: { reportNowDay: day } }, { upsert: true });
        res.status(202).json({ ok: true });
    } catch (e) { fail(res, e, "Could not start the report."); }
});

router.post("/wa/test", authenticate, writeLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        const send = await sender.sendTest(req.rootUser._id, { phone: b.phone, sheetId: validId(b.sheetId) ? b.sheetId : undefined });
        if (!send) return res.status(409).json({ error: "The tablet could not take the message." });
        res.status(202).json({ id: send._id, phone: send.phone });
    } catch (e) { fail(res, e, "Could not send the test."); }
});

router.get("/wa/sends/:id", authenticate, async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ error: "Not found." });
        const s = await WaSend.findOne({ _id: req.params.id, owner: req.rootUser._id }).lean();
        if (!s) return res.status(404).json({ error: "Not found." });
        res.json({ id: s._id, phone: s.phone, name: s.name, status: s.status, result: s.result, kind: s.kind, queuedAt: s.queuedAt, doneAt: s.doneAt });
    } catch (e) { fail(res, e, "Could not load that message."); }
});

// The tablet downloads the picture for the message it is about to send. Only a message queued for this tablet.
router.get("/wa/agent/image/:sendId", imageLimiter, (req, res, next) => require("./home").agentAuth(req, res, next), async (req, res) => {
    try {
        if (!validId(req.params.sendId)) return res.status(404).end();
        const send = await WaSend.findOne({ _id: req.params.sendId, device: req.device._id }).select("sheet imageIndex").lean();
        if (!send || !send.sheet) return res.status(404).end();
        const sheet = await WaSheet.findById(send.sheet).select("image imageType images").lean();
        const pictures = sender.imagesOf(sheet);
        if (!pictures.length) return res.status(404).end();
        const pic = pictures[Math.min(pictures.length - 1, Math.max(0, Number(send.imageIndex) || 0))];
        const buf = Buffer.from(pic.data.slice(pic.data.indexOf(",") + 1), "base64");
        res.set("Content-Type", pic.mime || "image/jpeg").set("Cache-Control", "private, max-age=600").send(buf);
    } catch (e) { res.status(500).end(); }
});

module.exports = router;
