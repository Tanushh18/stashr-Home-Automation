/**
 * The WhatsApp sender. Stashr decides who gets a message and when; the tablet (Stashr Hub) only opens the chat and presses
 * Send. The minute sweep calls tickAll(); each message is claimed in the database first, so two servers sharing one
 * database never queue the same one twice. A message counts as sent only when the tablet's result says so.
 */
const mongoose = require("mongoose");
const HomeDevice = require("../models/homeDevice");
const WaSettings = require("../models/waSettings");
const WaSheet = require("../models/waSheet");
const WaRecipient = require("../models/waRecipient");
const WaSend = require("../models/waSend");
const automation = require("./homeAutomation");
const home = require("./home");

const QUEUED_GIVE_UP_MS = 6 * 60 * 1000;     // a message the tablet never answered is marked failed after this
const MAX_ATTEMPTS = 2;                      // tries per person for a failure that is not "not on WhatsApp"

/** "9810012345", "+91 98100 12345" or "09810012345" -> "919810012345". null when it cannot be a mobile number. */
function normalizePhone(raw) {
    const d = String(raw || "").replace(/\D/g, "");
    if (d.length === 10) return `91${d}`;
    if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
    if (d.length >= 12 && d.length <= 14) return d;
    return null;
}

const minutesOf = (hhmm) => automation.toMinutes(hhmm);

/** Minutes in the sending window (to is later than from, same day). */
function windowMinutes(s) {
    const a = minutesOf(s.from), b = minutesOf(s.to);
    return a !== null && b !== null && b > a ? b - a : 0;
}

/** True when `minutes` (since midnight, local) is inside the window. */
function inWindow(s, minutes) {
    const a = minutesOf(s.from), b = minutesOf(s.to);
    return a !== null && b !== null && minutes >= a && minutes < b;
}

/**
 * Minutes to wait after a message. The daily limit is spread over the window (window / limit), jittered by 25%, then held
 * between the gap limits (6 to 12 minutes by default). `random` is injectable so it can be tested.
 */
function nextGapMinutes(s, random = Math.random) {
    const gapMin = Math.max(1, Number(s.gapMin) || 6);
    const gapMax = Math.max(gapMin, Number(s.gapMax) || 12);
    const win = windowMinutes(s);
    const limit = Math.max(1, Number(s.dailyLimit) || 1);
    const base = win > 0 ? win / limit : (gapMin + gapMax) / 2;
    const jitter = base * (0.75 + random() * 0.5);
    return Math.min(gapMax, Math.max(gapMin, jitter));
}

async function settingsOf(owner) {
    const found = await WaSettings.findOne({ owner }).lean();
    if (found) return found;
    try { return (await WaSettings.create({ owner })).toObject(); }
    catch (e) { return WaSettings.findOne({ owner }).lean(); }
}

/** The tablet that sends: an online Stashr Hub for this account. */
async function tabletOf(owner, now = Date.now()) {
    const hubs = await HomeDevice.find({ owner, kind: "hub", online: true }).lean();
    return hubs.find((d) => (d.status || {}).agent === "stashr-hub" && home.isOnline(d, now)) || null;
}

/** Messages the tablet never answered are marked failed, and the person goes back in line. */
async function expireQueued(owner, now = Date.now()) {
    const stale = await WaSend.find({ owner, status: "queued", queuedAt: { $lt: new Date(now - QUEUED_GIVE_UP_MS) } }).lean();
    for (const s of stale) await finishSend(s._id, false, "The tablet did not answer", now);
}

/**
 * Records the tablet's answer for one message. A number that is not on WhatsApp is skipped for good; any other failure
 * puts the person back in line once, then marks them failed. Returns the updated send, or null when it was already done.
 */
async function finishSend(sendId, ok, message, now = Date.now()) {
    const send = await WaSend.findOneAndUpdate({ _id: sendId, status: "queued" },
        { $set: { status: ok ? "sent" : "failed", result: String(message || "").slice(0, 200), doneAt: new Date(now) } }, { new: true });
    if (!send) return null;
    if (!send.recipient) return send;                               // a test to a number: no list entry to update
    if (ok) {
        await WaRecipient.updateOne({ _id: send.recipient }, { $set: { status: "sent", sentAt: new Date(now), error: "" } });
        return send;
    }
    const notOnWhatsApp = /not on whatsapp|isn't on whatsapp|invalid/i.test(String(message || ""));
    const r = await WaRecipient.findById(send.recipient).lean();
    if (!r) return send;
    const again = !notOnWhatsApp && (r.attempts || 0) < MAX_ATTEMPTS;
    await WaRecipient.updateOne({ _id: r._id }, { $set: { status: notOnWhatsApp ? "skipped" : again ? "pending" : "failed", error: String(message || "").slice(0, 200) } });
    return send;
}

/** The next person to message: sheets are served in turn (the one with the fewest sends today first), within each sheet's own limit. */
async function pickRecipient(owner, day) {
    const sheets = await WaSheet.find({ owner, enabled: true }).lean();
    const ranked = [];
    for (const sh of sheets) {
        const today = await WaSend.countDocuments({ owner, sheet: sh._id, day, status: { $in: ["queued", "sent"] }, kind: "scheduled" });
        if (sh.dailyLimit > 0 && today >= sh.dailyLimit) continue;
        ranked.push({ sh, today });
    }
    ranked.sort((a, b) => a.today - b.today);
    for (const { sh } of ranked) {
        for (let tries = 0; tries < 20; tries++) {
            const r = await WaRecipient.findOneAndUpdate({ owner, sheet: sh._id, status: "pending" },
                { $set: { status: "queued", queuedAt: new Date() }, $inc: { attempts: 1 } }, { sort: { order: 1, _id: 1 }, new: true });
            if (!r) break;
            // Never the same number twice, even when it is in two sheets.
            const dup = await WaRecipient.exists({ owner, phone: r.phone, _id: { $ne: r._id }, status: { $in: ["queued", "sent"] } });
            if (dup) { await WaRecipient.updateOne({ _id: r._id }, { $set: { status: "skipped", error: "Already messaged from another list" } }); continue; }
            return { sheet: sh, recipient: r };
        }
    }
    return null;
}

/** The text for one person: one of the sheet's messages at random, {name} filled in. */
function textFor(sheet, recipient, random = Math.random) {
    const list = (sheet.texts || []).filter((t) => String(t || "").trim());
    if (!list.length) return "";
    const raw = list[Math.min(list.length - 1, Math.floor(random() * list.length))];
    const first = String(recipient.name || "").trim().split(/\s+/)[0] || "";
    return raw.replace(/\{name\}/gi, first).replace(/[ \t]+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim().slice(0, 900);
}

/** Queues one message on the tablet and records it. Returns the send, or null when the tablet queue refused it. */
async function dispatch({ owner, tablet, sheet, recipient, phone, name, text, kind, day, now }) {
    const send = await WaSend.create({ owner, sheet: sheet && sheet._id, recipient: recipient && recipient._id, phone, name: name || "", text, kind, day, device: tablet._id, queuedAt: new Date(now) });
    const entry = await automation.queue(tablet, "send_wa", { phone, text, sendId: String(send._id), image: Boolean(sheet && sheet.image) });
    if (!entry) {
        await WaSend.updateOne({ _id: send._id }, { $set: { status: "failed", result: "The tablet queue is full", doneAt: new Date(now) } });
        if (recipient) await WaRecipient.updateOne({ _id: recipient._id }, { $set: { status: "pending" }, $inc: { attempts: -1 } });
        return null;
    }
    await WaSend.updateOne({ _id: send._id }, { $set: { commandId: entry.id } });
    return send;
}

/** One minute of the sender for one account. Returns what it did, so tests and the website can show it. */
async function tickOwner(owner, now = Date.now(), random = Math.random) {
    const s = await settingsOf(owner);
    const local = automation.localParts(now, s.timezone);
    const note = async (status, extra = {}) => { await WaSettings.updateOne({ owner }, { $set: { status, lastTickAt: new Date(now), ...extra } }); return { did: "wait", status }; };
    if (!s.enabled) return note("Off");
    await expireQueued(owner, now);
    if (await WaSend.exists({ owner, status: "queued" })) return note("Waiting for the tablet to finish a message");
    if (!s.testMode) {
        if (!inWindow(s, local.minutes)) return note(`Outside ${s.from} to ${s.to}`);
        const sent = await WaSend.countDocuments({ owner, day: local.date, status: { $in: ["queued", "sent"] }, kind: "scheduled" });
        if (sent >= s.dailyLimit) return note(`Done for today (${sent} of ${s.dailyLimit})`);
        if (s.nextDueAt && new Date(s.nextDueAt).getTime() > now) return note(`Next message at ${new Date(s.nextDueAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: s.timezone })}`);
    }
    const tablet = await tabletOf(owner, now);
    if (!tablet) return note("The tablet is offline");
    if (!(await automation.claim(`wa:${owner}:${Math.floor(now / 30000)}`))) return { did: "wait", status: "claimed elsewhere" };
    const picked = await pickRecipient(owner, local.date);
    if (!picked) return note("Nobody is left to message");
    const text = textFor(picked.sheet, picked.recipient, random);
    if (!text && !picked.sheet.image) {
        await WaRecipient.updateOne({ _id: picked.recipient._id }, { $set: { status: "pending" }, $inc: { attempts: -1 } });
        return note(`"${picked.sheet.name}" has no message or picture yet`);
    }
    const send = await dispatch({ owner, tablet, sheet: picked.sheet, recipient: picked.recipient, phone: picked.recipient.phone, name: picked.recipient.name, text, kind: "scheduled", day: local.date, now });
    if (!send) return note("The tablet queue is full");
    const gap = s.testMode ? 0.25 : nextGapMinutes(s, random);
    await WaSettings.updateOne({ owner }, { $set: { nextDueAt: new Date(now + gap * 60000), status: `Sent to the tablet: ${picked.recipient.name || picked.recipient.phone}`, lastTickAt: new Date(now) } });
    return { did: "queued", send, sheet: picked.sheet.name };
}

async function tickAll(now = Date.now()) {
    const owners = await WaSettings.distinct("owner", { enabled: true });
    for (const owner of owners) {
        try { await tickOwner(owner, now); } catch (e) { console.log("[wa] sender failed:", e.message); }
    }
}

/** The tablet's answer for a command it ran. Called for every ack of a hub; ignores everything that is not a WhatsApp send. */
async function onAck(device, ack, now = Date.now()) {
    const cmd = (device.commands || []).find((c) => c.id === ack.id && c.type === "send_wa");
    if (!cmd) return null;
    const send = await WaSend.findOne({ commandId: ack.id, status: "queued" }).lean();
    if (!send) return null;
    return finishSend(send._id, Boolean(ack.ok), ack.message, now);
}

/** A test to one number or to the next person: the same path as a real send, ignoring the window, the gap and the limit. */
async function sendTest(owner, { phone, sheetId, now = Date.now() } = {}) {
    const s = await settingsOf(owner);
    const tablet = await tabletOf(owner, now);
    if (!tablet) { const e = new Error("The tablet is offline"); e.status = 409; throw e; }
    if (await WaSend.exists({ owner, status: "queued" })) { const e = new Error("A message is already being sent"); e.status = 409; throw e; }
    const local = automation.localParts(now, s.timezone);
    if (phone) {
        const p = normalizePhone(phone);
        if (!p) { const e = new Error("That is not a valid mobile number"); e.status = 400; throw e; }
        const sheet = sheetId ? await WaSheet.findOne({ _id: sheetId, owner }).lean() : null;
        const text = sheet ? textFor(sheet, { name: "" }) : "Test message from Stashr";
        return dispatch({ owner, tablet, sheet, recipient: null, phone: p, name: "", text, kind: "test", day: local.date, now });
    }
    const picked = await pickRecipient(owner, local.date);
    if (!picked) { const e = new Error("Nobody is left to message"); e.status = 409; throw e; }
    const text = textFor(picked.sheet, picked.recipient);
    return dispatch({ owner, tablet, sheet: picked.sheet, recipient: picked.recipient, phone: picked.recipient.phone, name: picked.recipient.name, text, kind: "test", day: local.date, now });
}

module.exports = { normalizePhone, windowMinutes, inWindow, nextGapMinutes, settingsOf, tabletOf, finishSend, pickRecipient, textFor, tickOwner, tickAll, onAck, sendTest, expireQueued };
