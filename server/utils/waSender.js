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
const waLeads = require("./waLeads");
const WaLink = require("../models/waLink");
const home = require("./home");
const steps = require("./waSteps");
const rhythm = require("./waRhythm");

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
 * Minutes to wait after a message: a different gap every time, anywhere between the shortest and the longest gap, leaning
 * towards the gap that spreads the day's messages over the day's window, with a longer break now and then (see waRhythm.js).
 * `plan` is today's plan (its own window and number of messages); `random` is injectable so it can be tested.
 */
function nextGapMinutes(s, random = rhythm.secureRandom, plan = null) {
    const win = plan ? Math.max(0, plan.end - plan.start) : windowMinutes(s);
    return rhythm.nextGap({ gapMin: s.gapMin, gapMax: s.gapMax, windowMinutes: win, target: plan ? plan.target : s.dailyLimit }, random);
}

/** Rest days a week (0 to 3; 2 for an account that never chose). */
const restPerWeek = (s) => Math.min(rhythm.MAX_REST_DAYS, Math.max(0, Number.isFinite(Number(s && s.restDaysPerWeek)) ? Math.round(Number(s.restDaysPerWeek)) : 2));

/**
 * This week's and next week's rest days, picked once and kept in the settings so every server and the website agree.
 * A week that is picked once it has begun only uses today (when nothing went out yet today) and the days after it, with its
 * fair share of the rest days. Two servers picking at once: the first one's pick is kept. Returns the weeks kept.
 */
async function ensureRest(owner, s, local, random = rhythm.secureRandom) {
    const perWeek = restPerWeek(s);
    const thisWeek = rhythm.weekOf(local.date);
    let weeks = (s.restWeeks || []).slice();
    for (const week of [thisWeek, rhythm.addDays(thisWeek, 7)]) {
        if (weeks.some((w) => w.week === week)) continue;
        const all = rhythm.daysOfWeek(week);
        let free = all, count = perWeek;
        if (week === thisWeek) {
            const sentToday = await WaSend.exists({ owner, day: local.date, kind: "scheduled" });
            free = all.filter((d) => d > local.date || (d === local.date && !sentToday));
            count = rhythm.shareOf(perWeek, free.length, random);
        }
        const days = rhythm.planWeek({ week, perWeek, count, free, history: weeks, random });
        const entry = { week, days, perWeek, count: days.length };
        await WaSettings.updateOne({ owner, "restWeeks.week": { $ne: week } }, { $push: { restWeeks: { $each: [entry], $sort: { week: 1 }, $slice: -8 } } });
        weeks = ((await WaSettings.findOne({ owner }).select("restWeeks").lean()) || {}).restWeeks || [];
    }
    return weeks;
}

/**
 * Picks the rest days again ("Pick other days", or a new number of rest days a week): what is left of this week and all of next
 * week. Rest days that are over stay as they were, and today stays a sending day once something went out today.
 */
async function replanRest(owner, now = Date.now(), random = rhythm.secureRandom) {
    const s = await settingsOf(owner);
    const local = automation.localParts(now, s.timezone);
    const perWeek = restPerWeek(s);
    const thisWeek = rhythm.weekOf(local.date), nextWeek = rhythm.addDays(thisWeek, 7);
    const sentToday = await WaSend.exists({ owner, day: local.date, kind: "scheduled" });
    const earlier = (s.restWeeks || []).filter((w) => w.week < thisWeek);
    const cur = (s.restWeeks || []).find((w) => w.week === thisWeek);
    const fixed = perWeek > 0 && cur ? cur.days.filter((d) => d < local.date) : [];
    const free = rhythm.daysOfWeek(thisWeek).filter((d) => d > local.date || (d === local.date && !sentToday));
    // A week that started with its fair share keeps it; a new number of rest days a week moves it by the difference.
    const wanted = cur && Number.isFinite(cur.count) ? cur.count + (perWeek - (Number.isFinite(cur.perWeek) ? cur.perWeek : perWeek)) : perWeek;
    const count = perWeek === 0 ? 0 : Math.min(fixed.length + free.length, Math.max(fixed.length, wanted));
    const days = rhythm.planWeek({ week: thisWeek, perWeek, count, fixed, free, history: earlier, random });
    const current = { week: thisWeek, days, perWeek, count: days.length };
    const next = rhythm.planWeek({ week: nextWeek, perWeek, count: perWeek, history: [...earlier, current], random });
    const weeks = [...earlier, current, { week: nextWeek, days: next, perWeek, count: next.length }].slice(-8);
    await WaSettings.updateOne({ owner }, { $set: { restWeeks: weeks } });
    return weeks;
}

/** Today's plan (how many messages, when sending starts and stops), picked once a day and again when the window or the limit changes. */
async function ensureDayPlan(owner, s, local, random = rhythm.secureRandom) {
    const p = s.dayPlan;
    if (p && p.day === local.date && p.basis === rhythm.basisOf(s)) return p;
    const plan = rhythm.dayPlanFor(s, local.date, random);
    await WaSettings.updateOne({ owner, $or: [{ "dayPlan.day": { $ne: local.date } }, { "dayPlan.basis": { $ne: plan.basis } }] }, { $set: { dayPlan: plan } });
    const kept = ((await WaSettings.findOne({ owner }).select("dayPlan").lean()) || {}).dayPlan;
    return kept && kept.day === local.date && kept.basis === plan.basis ? kept : plan;
}

/** The plan that holds when there is none yet (the whole window, the whole limit). */
const plainPlan = (s, date) => ({ day: date, target: Math.max(0, Number(s.dailyLimit) || 0), start: minutesOf(s.from) || 0, end: minutesOf(s.to) || 0 });

/**
 * Today's rhythm for one account: the rest days of this week and next week, whether today is one of them, today's plan, and the
 * next day that sends. Makes the weeks and the plan the first time they are asked for.
 */
async function rhythmOf(owner, s, local, random = rhythm.secureRandom) {
    const weeks = await ensureRest(owner, s, local, random);
    const plan = await ensureDayPlan(owner, s, local, random);
    return describeRhythm(s, local, weeks, plan);
}

/** What rhythmOf returns, from what is already known (pure). */
function describeRhythm(s, local, weeks, plan) {
    const perWeek = restPerWeek(s);
    const restDays = perWeek > 0 ? [...new Set((weeks || []).flatMap((w) => w.days || []))].sort() : [];
    const rest = restDays.includes(local.date);
    const thisWeek = rhythm.weekOf(local.date);
    return {
        perWeek, rest, plan: plan || plainPlan(s, local.date), restDays,
        nextSendDay: rhythm.nextSendingDay(local.date, restDays),
        weeks: [thisWeek, rhythm.addDays(thisWeek, 7)].map((week) => ({
            week, days: rhythm.daysOfWeek(week).map((date) => ({ date, label: rhythm.dayLabel(date), rest: restDays.includes(date), past: date < local.date, today: date === local.date }))
        }))
    };
}

/** "tomorrow" or "on Tue 17 Nov". */
const whenDay = (today, date) => (rhythm.daysBetween(today, date) === 1 ? "tomorrow" : `on ${rhythm.dayLabel(date)}`);

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

/**
 * Only these failures mean WhatsApp certainly did not send the message, so the person can safely go back in line.
 * Anything else (no answer, "pressed Send but WhatsApp did not confirm") might have sent it: trying again could
 * message the same person twice, so those are marked failed and wait for you.
 */
const SAFE_TO_RETRY = /before pressing send|accessibility settings|not installed|another message is being sent|could not save the picture|picture is not available|not a valid number|nothing to send/i;
const safeToRetry = (message) => SAFE_TO_RETRY.test(String(message || ""));

/** Messages the tablet never answered. If the tablet never picked the command up, the person goes back in line; if it did, the message may have gone out, so it is marked failed (never retried by itself). */
async function expireQueued(owner, now = Date.now()) {
    const stale = await WaSend.find({ owner, status: "queued", queuedAt: { $lt: new Date(now - QUEUED_GIVE_UP_MS) } }).lean();
    for (const s of stale) {
        let picked = true;
        if (s.device && s.commandId) {
            const d = await HomeDevice.findOne({ _id: s.device, "commands.id": s.commandId }, { "commands.$": 1 }).lean();
            picked = Boolean(d && d.commands && d.commands[0] && d.commands[0].status !== "pending");
        }
        await finishSend(s._id, false, picked ? "No answer from the tablet after it took the message (it may have been sent: check WhatsApp)" : "The tablet never picked the message up. Before pressing Send", now, picked ? null : "never");
    }
}

/**
 * Records the tablet's answer for one message. A number that is not on WhatsApp is skipped for good; any other failure
 * puts the person back in line once, then marks them failed. Returns the updated send, or null when it was already done.
 */
async function finishSend(sendId, ok, message, now = Date.now(), special = null) {
    const send = await WaSend.findOneAndUpdate({ _id: sendId, status: "queued" },
        { $set: { status: ok ? "sent" : "failed", result: String(message || "").slice(0, 200), doneAt: new Date(now) } }, { new: true });
    if (!send) return null;
    const withImage = Boolean(send.imageIndex > 0 || (send.steps || []).some((x) => x.key === "picked" && /picture \d/.test(x.note || "")));
    const got = special === "never" ? steps.neverDelivered(withImage) : steps.fromAnswer(Boolean(ok), message, { withImage });
    // An answer means the tablet did receive it, even when its report and its answer came together.
    const delivered = (send.steps || []).some((x) => x.key === "delivered") || special === "never" ? [] : [steps.step("delivered", "ok")];
    await addSteps(send._id, [...delivered, ...got.steps], now, ok ? "" : got.where);
    if (!send.recipient) return send;                               // a test to a number: no list entry to update
    if (ok) {
        await WaRecipient.updateOne({ _id: send.recipient }, { $set: { status: "sent", sentAt: new Date(now), error: "" } });
        waLeads.writeBack(send.owner, 3).catch(() => {});             // the mark goes to We Three right away; a failure is retried by the sweep
        return send;
    }
    const notOnWhatsApp = /not on whatsapp|isn't on whatsapp|invalid/i.test(String(message || ""));
    const r = await WaRecipient.findById(send.recipient).lean();
    if (!r) return send;
    const again = !notOnWhatsApp && safeToRetry(message) && (r.attempts || 0) < MAX_ATTEMPTS;
    await WaRecipient.updateOne({ _id: r._id }, { $set: { status: notOnWhatsApp ? "skipped" : again ? "pending" : "failed", error: String(message || "").slice(0, 200) } });
    if (notOnWhatsApp) waLeads.writeBack(send.owner, 3).catch(() => {});
    return send;
}

/** People are picked at random among the next ones in line, so a list is never worked through in order (numbers in sequence look like a bot). */
const PICK_FROM = 25;

/**
 * The next person to message: sheets are served in turn (the one with the fewest sends today first, a tie decided at random),
 * within each sheet's own limit; in a sheet, one of the next 25 people in line at random.
 */
async function pickRecipient(owner, day, random = rhythm.secureRandom) {
    const sheets = await WaSheet.find({ owner, enabled: true }).lean();
    const ranked = [];
    for (const sh of sheets) {
        const today = await WaSend.countDocuments({ owner, sheet: sh._id, day, status: { $in: ["queued", "sent"] }, kind: "scheduled" });
        if (sh.dailyLimit > 0 && today >= sh.dailyLimit) continue;
        ranked.push({ sh, today, tie: random() });
    }
    ranked.sort((a, b) => a.today - b.today || a.tie - b.tie);
    for (const { sh } of ranked) {
        for (let tries = 0; tries < 20; tries++) {
            const line = await WaRecipient.find({ owner, sheet: sh._id, status: "pending" }).sort({ order: 1, _id: 1 }).limit(PICK_FROM).select("_id").lean();
            if (!line.length) break;
            const chosen = line[Math.min(line.length - 1, Math.floor(random() * line.length))]._id;
            const r = await WaRecipient.findOneAndUpdate({ _id: chosen, status: "pending" },
                { $set: { status: "queued", queuedAt: new Date() }, $inc: { attempts: 1 } }, { new: true });
            if (!r) continue;                                                   // another server took that person a moment ago
            // Never the same number twice, even when it is in two sheets.
            const dup = await WaRecipient.exists({ owner, phone: r.phone, _id: { $ne: r._id }, status: { $in: ["queued", "sent"] } });
            if (dup) { await WaRecipient.updateOne({ _id: r._id }, { $set: { status: "skipped", error: "Already messaged from another list" } }); continue; }
            return { sheet: sh, recipient: r };
        }
    }
    return null;
}

/** Every picture of a sheet, the older single `image` included. */
function imagesOf(sheet) {
    const list = (sheet && Array.isArray(sheet.images) ? sheet.images : []).filter((i) => i && i.data);
    if (!list.length && sheet && sheet.image) return [{ data: sheet.image, mime: sheet.imageType || "image/jpeg" }];
    return list;
}

/** The text for one person: one of the sheet's messages at random, {name} filled in. */
function textFor(sheet, recipient, random = rhythm.secureRandom) {
    const list = (sheet.texts || []).filter((t) => String(t || "").trim());
    if (!list.length) return "";
    const raw = list[Math.min(list.length - 1, Math.floor(random() * list.length))];
    const first = String(recipient.name || "").trim().split(/\s+/)[0] || "";
    return raw.replace(/\{name\}/gi, first).replace(/[ \t]+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim().slice(0, 900);
}

/** Adds steps to a send's timeline (each stamped with the time). */
async function addSteps(sendId, list, now = Date.now(), where = "") {
    if (!list.length) return;
    const at = new Date(now);
    const set = where ? { failedWhere: where } : {};
    await WaSend.updateOne({ _id: sendId }, { $push: { steps: { $each: list.map((x) => ({ ...x, at })) } }, ...(where ? { $set: set } : {}) });
}

/** The tablet fetched these commands: the "delivered" step of every WhatsApp message among them. */
async function onDelivered(commandIds, now = Date.now()) {
    const ids = (commandIds || []).filter(Boolean);
    if (!ids.length) return;
    await WaSend.updateMany({ commandId: { $in: ids }, status: "queued", "steps.key": { $ne: "delivered" } },
        { $push: { steps: { key: "delivered", label: steps.LABELS.delivered, state: "ok", note: "", at: new Date(now) } } });
}

/** Queues one message on the tablet and records it. Returns the send, or null when the tablet queue refused it. */
async function dispatch({ owner, tablet, sheet, recipient, phone, name, text, kind, day, now, random = rhythm.secureRandom }) {
    const pictures = imagesOf(sheet);
    const imageIndex = pictures.length ? Math.min(pictures.length - 1, Math.floor(random() * pictures.length)) : 0;
    const send = await WaSend.create({ owner, sheet: sheet && sheet._id, recipient: recipient && recipient._id, phone, name: name || "", text, kind, day, device: tablet._id, queuedAt: new Date(now), imageIndex });
    await addSteps(send._id, [steps.step("picked", "ok", `${name || phone}${pictures.length ? `, picture ${imageIndex + 1} of ${pictures.length}` : ", no picture"}`)], now);
    const entry = await automation.queue(tablet, "send_wa", { phone, text, sendId: String(send._id), image: pictures.length > 0 });
    if (!entry) {
        await addSteps(send._id, [steps.step("queued", "failed", "The tablet's queue is full.")], now, "server");
        await WaSend.updateOne({ _id: send._id }, { $set: { status: "failed", result: "The tablet queue is full", doneAt: new Date(now) } });
        if (recipient) await WaRecipient.updateOne({ _id: recipient._id }, { $set: { status: "pending" }, $inc: { attempts: -1 } });
        return null;
    }
    await WaSend.updateOne({ _id: send._id }, { $set: { commandId: entry.id } });
    await addSteps(send._id, [steps.step("queued", "ok", `Tablet "${tablet.name || "Hub"}"`)], now);
    return send;
}

/** One minute of the sender for one account. Returns what it did, so tests and the website can show it. */
async function tickOwner(owner, now = Date.now(), random = rhythm.secureRandom) {
    const s = await settingsOf(owner);
    const local = automation.localParts(now, s.timezone);
    const day = await rhythmOf(owner, s, local, random);
    // The nightly report may go out even when sending was switched off in the evening.
    if (!(await WaSend.exists({ owner, status: "queued" }))) {
        const tab = await tabletOf(owner, now);
        if (tab && (await automation.claim(`warep:${owner}:${Math.floor(now / 30000)}`))) {
            const rep = await reportTick(owner, s, local, now, tab, day);
            if (rep) return { did: "report", send: rep };
        }
    }
    const note = async (status, extra = {}) => { await WaSettings.updateOne({ owner }, { $set: { status, lastTickAt: new Date(now), ...extra } }); return { did: "wait", status }; };
    if (!s.enabled) return note("Off");
    await expireQueued(owner, now);
    if (await WaSend.exists({ owner, status: "queued" })) return note("Waiting for the tablet to finish a message");
    if (!s.testMode) {
        const p = day.plan, again = `Sending again ${whenDay(local.date, day.nextSendDay)} from ${s.from}`;
        if (day.rest) return note(`Rest day today (picked at random): nothing goes out. ${again}`);
        if (!inWindow(s, local.minutes)) return note(`Outside ${s.from} to ${s.to}`);
        if (local.minutes < p.start) return note(`Today starts at ${rhythm.hhmm(p.start)} (a random time after ${s.from})`);
        if (local.minutes >= p.end) return note(`Stopped for today at ${rhythm.hhmm(p.end)} (a random time before ${s.to}). ${again}`);
        const sent = await WaSend.countDocuments({ owner, day: local.date, status: { $in: ["queued", "sent"] }, kind: "scheduled" });
        if (sent >= p.target) return note(`Done for today (${sent} of ${p.target}${p.target < s.dailyLimit ? `: today's random number, under the limit of ${s.dailyLimit}` : ""})`);
        if (s.nextDueAt && new Date(s.nextDueAt).getTime() > now) return note(`Next message at ${new Date(s.nextDueAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: s.timezone })}`);
    }
    const tablet = await tabletOf(owner, now);
    if (!tablet) return note("The tablet is offline");
    if (!(await automation.claim(`wa:${owner}:${Math.floor(now / 30000)}`))) return { did: "wait", status: "claimed elsewhere" };
    const picked = await pickRecipient(owner, local.date, random);
    if (!picked) return note("Nobody is left to message");
    const text = textFor(picked.sheet, picked.recipient, random);
    if (!text && !imagesOf(picked.sheet).length) {
        await WaRecipient.updateOne({ _id: picked.recipient._id }, { $set: { status: "pending" }, $inc: { attempts: -1 } });
        return note(`"${picked.sheet.name}" has no message or picture yet`);
    }
    const send = await dispatch({ owner, tablet, sheet: picked.sheet, recipient: picked.recipient, phone: picked.recipient.phone, name: picked.recipient.name, text, kind: "scheduled", day: local.date, now, random });
    if (!send) return note("The tablet queue is full");
    const gap = s.testMode ? 0.25 : nextGapMinutes(s, random, day.plan);
    await WaSettings.updateOne({ owner }, { $set: { nextDueAt: new Date(now + gap * 60000), status: `Sent to the tablet: ${picked.recipient.name || picked.recipient.phone}`, lastTickAt: new Date(now) } });
    return { did: "queued", send, sheet: picked.sheet.name };
}

/**
 * When each sheet's next message goes out, for the website. Mirrors tickOwner and pickRecipient without changing anything:
 * the account-wide gate first (off, tablet offline, a rest day, before today's start or after today's stop, done for today, waiting
 * for the gap), then the order the sheets are served in (the one with the fewest sends today first). `day` is rhythmOf's answer
 * (without it: no rest days, the whole window and the whole limit). Returns { next, sheets: { [id]: plan } } with plan { state, at, reason }.
 * state: "next" (this sheet is next), "later" (in turn, `at` is an estimate), "blocked" (reason says why).
 */
function schedulePlan({ settings: s, local, now, tablet, sentToday, waiting, sheets, today, pendingBy, day = null }) {
    const d = day || { rest: false, plan: plainPlan(s, local.date), nextSendDay: null };
    const gateAt = (() => {
        if (s.testMode) return { at: now, why: "" };
        const from = minutesOf(s.from), to = minutesOf(s.to);
        if (from == null || to == null) return { at: Math.max(now, s.nextDueAt ? new Date(s.nextDueAt).getTime() : now), why: "" };
        const p = d.plan;
        // The next day that sends, at the window's opening (that day's own start is picked on the day, up to 75 minutes later).
        const nextDay = (why) => {
            const ahead = d.nextSendDay && local.date ? Math.max(1, rhythm.daysBetween(local.date, d.nextSendDay)) : 1;
            const word = ahead === 1 ? "tomorrow" : `on ${rhythm.dayLabel(d.nextSendDay)}`;
            return { at: now + ((ahead - 1) * 1440 + 1440 - local.minutes + from) * 60000, why: `${why}; opens ${word} at ${s.from}` };
        };
        if (d.rest) return nextDay("Today is a rest day (picked at random)");
        if (local.minutes < p.start) return { at: now + (p.start - local.minutes) * 60000, why: p.start > from ? `Opens at ${rhythm.hhmm(p.start)} today (a random time after ${s.from})` : `Opens at ${s.from}` };
        if (local.minutes >= p.end) return nextDay(p.end < to ? `Stopped for today at ${rhythm.hhmm(p.end)} (a random time before ${s.to})` : "Today's window is over");
        if (sentToday >= p.target && s.dailyLimit > 0) return nextDay(`Done for today (${sentToday} of ${p.target})`);
        return { at: Math.max(now, s.nextDueAt ? new Date(s.nextDueAt).getTime() : now), why: "" };
    })();
    let blocked = "";
    if (!s.enabled) blocked = "Sending is switched off";
    else if (!tablet) blocked = "The tablet is offline";
    else if (waiting) blocked = "Waiting for the tablet to finish a message";
    const avgGapMs = ((Number(s.gapMin) + Number(s.gapMax)) / 2) * 60000;
    const eligible = [];
    const plan = {};
    for (const sh of sheets) {
        const id = String(sh._id), n = today[id] || 0;
        const hasContent = (sh.texts || []).some((t) => String(t || "").trim()) || imagesOf(sh).length > 0 || Boolean(sh.image);
        if (!sh.enabled) plan[id] = { state: "blocked", reason: "This sheet is switched off, so it sends nothing" };
        else if (!hasContent) plan[id] = { state: "blocked", reason: "No message or picture yet" };
        else if (!(pendingBy[id] > 0)) plan[id] = { state: "blocked", reason: "Nobody left to message" };
        else if (sh.dailyLimit > 0 && n >= sh.dailyLimit) plan[id] = { state: "blocked", reason: `Its own daily limit is reached (${n} of ${sh.dailyLimit})` };
        else eligible.push({ id, n });
    }
    eligible.sort((a, b) => a.n - b.n);
    eligible.forEach(({ id }, i) => {
        const reason = blocked || gateAt.why;
        const at = gateAt.at + i * avgGapMs;
        plan[id] = i === 0 ? { state: "next", at, reason } : { state: "later", at, reason, after: i };
    });
    const first = eligible[0];
    const next = !first ? { state: "blocked", reason: blocked || "No sheet has anyone left to message", at: null }
        : { state: blocked ? "blocked" : "next", reason: blocked || gateAt.why, at: gateAt.at, sheet: first.id };
    return { next, sheets: plan };
}

async function tickAll(now = Date.now()) {
    const owners = await WaSettings.distinct("owner");           // every account: the nightly report also runs when sending was switched off
    for (const owner of owners) {
        try { await tickOwner(owner, now); } catch (e) { console.log("[wa] sender failed:", e.message); }
    }
    // Marks that did not reach We Three yet are tried again, whether or not the sender is on.
    for (const owner of await WaLink.distinct("owner")) {
        try { await waLeads.writeBack(owner); } catch (e) { console.log("[wa] write-back failed:", e.message); }
        try { await waLeads.syncLinked(owner, normalizePhone); } catch (e) { console.log("[wa] We Three sync failed:", e.message); }
        try { await waLeads.deleteSweep(owner); } catch (e) { console.log("[wa] We Three delete failed:", e.message); }
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

const DEFAULT_REPORT_NUMBERS = ["918130483894", "919310994032"];
const REPORT_TRIES = 3;

/** The numbers the nightly report goes to (the defaults for an account that never set them). */
const reportNumbersOf = (s) => (Array.isArray(s.reportNumbers) ? s.reportNumbers : DEFAULT_REPORT_NUMBERS).filter(Boolean);

/** Text of the day's report: what went out, what did not, and what is still waiting (and whether tomorrow is a rest day). */
async function buildReport(owner, s, local, now, day = null) {
    const rows = await WaSend.find({ owner, day: local.date, kind: "scheduled" }).lean();
    const sent = rows.filter((r) => r.status === "sent").length;
    const failed = rows.filter((r) => r.status === "failed");
    const dayStart = new Date(now - local.minutes * 60000);
    const skipped = await WaRecipient.countDocuments({ owner, status: "skipped", updatedAt: { $gte: dayStart } });
    const sheets = new Map((await WaSheet.find({ owner }).select("name").lean()).map((x) => [String(x._id), x.name]));
    const per = {};
    for (const r of rows) { const n = sheets.get(String(r.sheet)) || "Other"; (per[n] = per[n] || { sent: 0, failed: 0 })[r.status === "sent" ? "sent" : "failed"]++; }
    const reasons = {};
    for (const r of failed) { const k = String(r.result || "no reason").slice(0, 70); reasons[k] = (reasons[k] || 0) + 1; }
    const enabledIds = (await WaSheet.find({ owner, enabled: true }).select("_id").lean()).map((x) => x._id);
    const pending = await WaRecipient.countDocuments({ owner, status: "pending", sheet: { $in: enabledIds } });
    const d = new Date(`${local.date}T12:00:00Z`);
    const lines = [`📊 WhatsApp report, ${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`, `✅ Sent: ${sent}`, `❌ Not sent: ${failed.length}`, `⏭️ Skipped (not on WhatsApp): ${skipped}`];
    const names = Object.keys(per);
    if (names.length) lines.push("", ...names.map((n) => `• ${n}: ${per[n].sent} sent${per[n].failed ? `, ${per[n].failed} not sent` : ""}`));
    const why = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (why.length) lines.push("", "Why some did not go:", ...why.map(([k, n]) => `- ${n} × ${k}`));
    lines.push("", `⏳ Still to send: ${pending}`);
    if (day && !s.testMode) {
        if (day.rest) lines.push("😴 Today is a rest day (picked at random).");
        if (day.restDays.includes(rhythm.addDays(local.date, 1))) lines.push("😴 Tomorrow is a rest day (picked at random): nothing goes out.");
    }
    return lines.join("\n").slice(0, 900);
}

/**
 * The nightly report. It goes out once a day, after the day's sending is done (the daily limit is reached, nobody is left, or the
 * window has ended), only when something was sent or tried today. Each number gets it in turn; a failed report is tried up to three times.
 * Returns the queued send, or null when there is nothing to do right now. Test mode never reports.
 */
async function reportTick(owner, s, local, now, tablet, day = null) {
    const forced = s.reportNowDay === local.date;                     // "Send the report now" was pressed today
    if (!forced && (s.reportEnabled === false || s.testMode)) return null;
    const numbers = reportNumbersOf(s);
    if (!numbers.length) return null;
    if (!forced && !(await WaSend.countDocuments({ owner, day: local.date, kind: "scheduled" }))) return null;
    const plan = day ? day.plan : plainPlan(s, local.date);              // today's own stop time and number of messages
    if (!forced && local.minutes < (plan.end || minutesOf(s.to) || 0)) {
        if (!s.enabled) return null;
        const sentNow = await WaSend.countDocuments({ owner, day: local.date, kind: "scheduled", status: { $in: ["queued", "sent"] } });
        const enabledIds = (await WaSheet.find({ owner, enabled: true }).select("_id").lean()).map((x) => x._id);
        const left = await WaRecipient.exists({ owner, status: "pending", sheet: { $in: enabledIds } });
        if (sentNow < plan.target && left) return null;                   // still sending today
    }
    const done = await WaSend.find({ owner, day: local.date, kind: "report" }).lean();
    for (const phone of numbers) {
        if (done.some((r) => r.phone === phone && r.status === "sent")) continue;
        if (done.filter((r) => r.phone === phone && r.status === "failed").length >= REPORT_TRIES) continue;
        if (done.some((r) => r.status === "queued")) return null;
        const text = await buildReport(owner, s, local, now, day);
        return dispatch({ owner, tablet, sheet: null, recipient: null, phone, name: "Report", text, kind: "report", day: local.date, now });
    }
    return null;
}

/** Today's rhythm as the website shows it: the two weeks with their rest days, today's plan as clock times, the next day that sends. */
function rhythmForWeb(day, s) {
    return {
        perWeek: day.perWeek, rest: day.rest, testMode: Boolean(s.testMode), weeks: day.weeks,
        nextSendDay: day.nextSendDay, nextSendLabel: rhythm.dayLabel(day.nextSendDay),
        today: { target: day.plan.target, limit: Math.max(0, Number(s.dailyLimit) || 0), start: rhythm.hhmm(day.plan.start), end: rhythm.hhmm(day.plan.end) }
    };
}

module.exports = { rhythmOf, rhythmForWeb, describeRhythm, replanRest, ensureRest, ensureDayPlan, restPerWeek, schedulePlan, onDelivered, addSteps, buildReport, reportTick, safeToRetry, waLeads, imagesOf, normalizePhone, windowMinutes, inWindow, nextGapMinutes, settingsOf, tabletOf, finishSend, pickRecipient, textFor, tickOwner, tickAll, onAck, sendTest, expireQueued };
