/**
 * Stashr Home automations: TV schedules, TV time and limits, "nobody is home but the TV is on", Wi-Fi alerts,
 * the morning brief and the weekly report. Run once a minute by the Home sweep on every server; each job is claimed
 * in the database first, so two servers sharing one database never run it twice.
 */
const mongoose = require("mongoose");
const HomeDevice = require("../models/homeDevice");
const HomeEvent = require("../models/homeEvent");
const HomeSettings = require("../models/homeSettings");
const HomeClaim = require("../models/homeClaim");
const HomeSpeed = require("../models/homeSpeed");
const home = require("./home");
const weather = require("./homeWeather");
const route = require("./homeRoute");
const { record } = require("./homeEvents");
const placeTrail = require("./placeTrail");

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const USAGE_DAYS = 35;

/** The date, the time and the weekday in the account's time zone. */
function localParts(now = Date.now(), timeZone = "Asia/Kolkata") {
    let parts;
    try { parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(new Date(now)); }
    catch (e) { return localParts(now, "Asia/Kolkata"); }
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
    const hh = get("hour") === "24" ? "00" : get("hour");
    return { date: `${get("year")}-${get("month")}-${get("day")}`, hhmm: `${hh}:${get("minute")}`, minutes: Number(hh) * 60 + Number(get("minute")), weekday: DAYS.indexOf(get("weekday").toLowerCase().slice(0, 3)) };
}

const toMinutes = (hhmm) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const okTime = (hhmm) => toMinutes(hhmm) !== null;

/** True for the one server that gets to run this job. */
async function claim(id) {
    try { await HomeClaim.create({ _id: String(id).slice(0, 200) }); return true; }
    catch (e) { if (e && e.code === 11000) return false; throw e; }
}

async function settingsOf(owner) {
    const found = await HomeSettings.findOne({ owner }).lean();
    if (found) return found;
    try { return (await HomeSettings.create({ owner })).toObject(); }
    catch (e) { return HomeSettings.findOne({ owner }).lean(); }
}

/** Puts one checked command in a device's queue. Returns the queued entry, or null when it was refused. */
async function queue(device, type, args, { note } = {}) {
    const command = home.cleanCommand(device.kind, type, args);
    if (!command) return null;
    const waiting = (device.commands || []).filter((c) => c.status === "pending" || c.status === "sent").length;
    if (waiting >= home.MAX_COMMANDS) return null;
    const entry = { id: new mongoose.Types.ObjectId().toString(), ...command, status: "pending", result: "", createdAt: new Date() };
    await HomeDevice.updateOne({ _id: device._id }, { $push: { commands: { $each: [entry], $slice: -50 } } });
    if (note) await record({ owner: device.owner, device: device._id, deviceName: device.name, kind: "command", text: note });
    return entry;
}

/**
 * What to tell you about the Wi-Fi events of one scan. Pure, so it can be tested: adds notify to the events that
 * should reach Telegram, and turns arrivals and departures of a person's device into "Mom came home".
 */
function lanAlerts(events, labels, settings, local) {
    const a = (settings && settings.alerts) || {};
    const night = home.inWindow(local.minutes, toMinutes(a.nightFrom || "00:00") ?? 0, toMinutes(a.nightTo || "05:00") ?? 300);
    const out = [];
    for (const e of events) {
        const lbl = (e.key && labels[e.key]) || {};
        const known = Boolean(lbl.tag && lbl.tag !== "unknown");
        const next = { ...e };
        if (e.kind === "lan_new") {
            next.notify = a.newDevice !== false || (a.night !== false && night);
            if (night) next.text = `🌙 At night: ${e.text}`;
        } else if (e.kind === "lan_joined") {
            next.notify = a.night !== false && night && !known;
            if (night && !known) next.text = `🌙 At night: ${e.text}`;
        }
        out.push(next);
        if (lbl.person && (e.kind === "lan_joined" || e.kind === "lan_left")) {
            out.push({ kind: e.kind === "lan_joined" ? "home_arrived" : "home_left", text: e.kind === "lan_joined" ? `${lbl.person} came home` : `${lbl.person} left home`, notify: a.presence === true });
        }
    }
    return out;
}

/** One line per TV, phone and person for the briefs. */
async function houseSummary(owner, now = Date.now()) {
    const devices = await HomeDevice.find({ owner }).lean();
    const hubs = devices.filter((d) => d.kind === "hub"), phones = devices.filter((d) => d.kind === "phone");
    const people = home.presence(hubs, phones, now, (await settingsOf(owner)).homeSpot);
    const up = new Set();
    for (const h of hubs) for (const [k, d] of Object.entries(h.lanBook || {})) if (d.up) up.add(h._id + k);
    return { devices, hubs, phones, people, wifiUp: up.size };
}

const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
const topApps = (apps) => Object.entries(apps || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, m]) => `${n} ${fmtMin(m)}`).join(", ");

/** The morning brief: weather, who is home, the TV yesterday, the Wi-Fi overnight, the internet speed. */
async function briefText(owner, settings, now = Date.now()) {
    const tz = settings.timezone || "Asia/Kolkata";
    const lines = ["☀️ <b>Good morning! Your home today</b>"];
    try { const f = await weather.forecast(settings.weather, tz); if (f) lines.push("🌤 " + weather.line(f)); } catch (e) { lines.push("🌤 Weather is not available right now."); }
    const s = await houseSummary(owner, now);
    if (s.people.length) lines.push("👪 " + s.people.map((p) => `${p.person} ${p.home ? "is home" : "is out"}`).join(", ") + ".");
    for (const tv of s.devices.filter((d) => d.kind === "tv")) lines.push(`📺 ${tv.name}: ${tv.online ? (tv.status && tv.status.screen === "off" ? "standby" : "on") : "off"}.`);
    const y = localParts(now - 24 * 3600 * 1000, tz).date;
    const u = (settings.usage || {})[y];
    if (u && u.minutes) lines.push(`⏱ TV yesterday: ${fmtMin(u.minutes)}${topApps(u.apps) ? " (" + topApps(u.apps) + ")" : ""}.`);
    const since = new Date(now - 12 * 3600 * 1000);
    const newDevices = await HomeEvent.countDocuments({ owner, kind: "lan_new", at: { $gte: since } });
    lines.push(`📶 ${s.wifiUp} devices on the Wi-Fi${newDevices ? `, ${newDevices} new overnight` : ""}.`);
    const camera = await HomeEvent.countDocuments({ owner, kind: "camera", at: { $gte: since } });
    if (camera) lines.push(`📷 The camera saw movement ${camera} time${camera > 1 ? "s" : ""} overnight.`);
    const speed = await HomeSpeed.findOne({ owner }).sort({ at: -1 }).lean();
    if (speed) lines.push(`🚀 Internet: ${speed.down} Mbit/s down, ${speed.up} up, ${speed.ping} ms.`);
    return lines.join("\n");
}

/**
 * "Today" for the tablet's screen: plain lines, newest facts first. Same sources as the morning brief.
 * Returns { title, lines: [{ icon, text }] }.
 */
async function todayLines(owner, settings, now = Date.now()) {
    const tz = settings.timezone || "Asia/Kolkata";
    const local = localParts(now, tz);
    const lines = [];
    try { const f = await weather.forecast(settings.weather, tz); if (f) lines.push({ icon: "🌤", text: weather.line(f) }); } catch (e) { /* no weather */ }
    const s = await houseSummary(owner, now);
    for (const c of comingList(settings, now)) lines.unshift({ icon: "🚗", text: comingLine(c) + "." });
    if (s.people.length) lines.push({ icon: "👪", text: s.people.map((p) => `${p.person} ${p.home ? "is home" : "is out"}`).join(", ") + "." });
    for (const tv of s.devices.filter((d) => d.kind === "tv")) lines.push({ icon: "📺", text: `${tv.name}: ${tv.online ? (tv.status && tv.status.screen === "off" ? "standby" : "on") : "off"}.` });
    const used = (((settings.usage || {})[local.date]) || {}).minutes || 0;
    if (used) lines.push({ icon: "⏱", text: `TV today: ${fmtMin(used)}${settings.tvLimit && settings.tvLimit.minutes ? " of " + fmtMin(settings.tvLimit.minutes) : ""}.` });
    lines.push({ icon: "📶", text: `${s.wifiUp} devices on the Wi-Fi.` });
    const since = new Date(now - local.minutes * 60000);
    const events = await HomeEvent.find({ owner, at: { $gte: since }, kind: { $nin: ["automation"] } }).sort({ at: -1 }).limit(8).lean();
    for (const e of events) lines.push({ icon: "•", text: `${localParts(new Date(e.at).getTime(), tz).hhmm}  ${e.text}` });
    if (!events.length) lines.push({ icon: "✓", text: "Nothing else happened at home today." });
    const speed = await HomeSpeed.findOne({ owner }).sort({ at: -1 }).lean();
    if (speed) lines.push({ icon: "🚀", text: `Internet: ${speed.down} Mbit/s down, ${speed.up} up, ${speed.ping} ms.` });
    return { title: "Today at home", lines };
}

/**
 * Camera on when everyone is out, off when someone is back. Only on a change: it never turns off a camera you armed
 * yourself, and never arms one while somebody is home. Needs at least one person set up, and waits two minutes of
 * "nobody home" so a phone's Wi-Fi blip does not arm it.
 */
async function autoCamera(owner, settings, devices, now) {
    const hubs = devices.filter((d) => d.kind === "hub");
    const people = home.presence(hubs, devices.filter((d) => d.kind === "phone"), now, settings.homeSpot);
    if (!people.length) return;
    const anyoneHome = people.some((p) => p.home);
    const hub = hubs.find((d) => (d.status || {}).agent === "stashr-hub" && Boolean(d.online) && home.isOnline(d, now));
    if (!hub) return;
    const st = settings.camera.autoState || {};
    if (!anyoneHome) {
        if (st.armedByAuto) return;
        if (!st.awaySince) { await HomeSettings.updateOne({ owner }, { $set: { "camera.autoState": { awaySince: new Date(now) } } }); return; }
        if (now - new Date(st.awaySince).getTime() < 2 * 60000) return;
        if (((hub.status || {}).camera || {}).armed) return;      // already watching (you armed it)
        if (!await claim(`autocam:${owner}:arm:${Math.floor(now / 60000)}`)) return;
        await queue(hub, "camera", { action: "arm" });
        await HomeSettings.updateOne({ owner }, { $set: { "camera.autoState": { armedByAuto: true } } });
        await record({ owner, device: hub._id, deviceName: hub.name, kind: "camera_auto", notify: true, text: "Everyone is out: the tablet camera is now watching the house." });
    } else if (st.armedByAuto) {
        if (!await claim(`autocam:${owner}:off:${Math.floor(now / 60000)}`)) return;
        await queue(hub, "camera", { action: "disarm" });
        await HomeSettings.updateOne({ owner }, { $set: { "camera.autoState": {} } });
        await record({ owner, device: hub._id, deviceName: hub.name, kind: "camera_auto", notify: true, text: "Someone is home: the tablet camera is off." });
    } else if (st.awaySince) {
        await HomeSettings.updateOne({ owner }, { $set: { "camera.autoState": {} } });
    }
}

const LOC_FRESH_MS = 3 * 3600 * 1000;       // a fix this young still counts (a phone that was offline uploads its fix late)
const PLACE_RETRY_MS = 2 * 3600 * 1000;    // a place message that could not go out (tablet offline) is retried for this long
const distanceM = (a, b) => {
    const R = 6371000, rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
};

/**
 * Places: when a family phone gets inside a place's circle (arrive) or leaves it (leave) AND the time is inside the
 * window you set, the tablet sends your message to the WhatsApp group. The first sighting only records where the phone
 * is; a place is "left" only when the phone is clearly outside (radius + its accuracy), so a GPS wobble is not a trip.
 */
/** The home place is confirmed by the Wi-Fi as well as the location (set verifyWifi on a place to force it on or off). */
function needsWifi(p, settings) {
    if (typeof p.verifyWifi === "boolean") return p.verifyWifi;
    const spot = settings && settings.homeSpot;
    return Boolean(spot && Number.isFinite(spot.lat) && Number.isFinite(spot.lon) && distanceM({ lat: spot.lat, lon: spot.lon }, { lat: p.lat, lon: p.lon }) <= 300);
}

async function geoTick(owner, now, settings, devices) {
    const places = Array.isArray(settings.places) ? settings.places : [];
    if (!places.length) return;
    const tz = settings.timezone || "Asia/Kolkata";
    const mins = localParts(now, tz).minutes;
    const tablet = (devices || []).filter((d) => d.kind === "hub").find((d) => (d.status || {}).agent === "stashr-hub" && Boolean(d.online) && home.isOnline(d, now));
    const people = home.presence((devices || []).filter((d) => d.kind === "hub"), (devices || []).filter((d) => d.kind === "phone"), now, settings.homeSpot);
    for (let i = 0; i < places.length; i++) {
        const p = places[i];
        if (!p || p.enabled === false) continue;
        const phone = devices.find((d) => d.kind === "phone" && String(d._id) === String(p.phone));
        const loc = phone && phone.status && phone.status.location;
        if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lon)) || now - Number(loc.at || 0) > LOC_FRESH_MS) continue;
        const dist = distanceM({ lat: Number(loc.lat), lon: Number(loc.lon) }, { lat: p.lat, lon: p.lon });
        const locAt = Number(loc.at) || now;
        // A message that could not be sent earlier (the tablet was offline) is tried again while it is still recent.
        let sendState = "";
        let eventAt = Number(loc.at) || now;
        const waiting = p.pending && p.pending.state && now - Number(p.pending.at) < PLACE_RETRY_MS ? p.pending : null;
        if (waiting) { sendState = waiting.state; eventAt = Number(waiting.at); }
        let next = p.state || "";
        if (dist <= p.radius) next = "in";
        else if (dist > placeTrail.outBeyond(p, loc.acc)) next = "out";
        // leaving needs a second reading (unless clearly far away), so one bad fix cannot send "Leaving office"
        if (p.state === "in") {
            const chk = placeTrail.leaveCheck({ dist, place: p, acc: loc.acc, seenAt: Number(p.outSeenAt) || 0, at: locAt });
            if ((chk.seenAt || 0) !== (Number(p.outSeenAt) || 0)) await HomeSettings.updateOne({ owner }, chk.seenAt ? { $set: { [`places.${i}.outSeenAt`]: chk.seenAt } } : { $unset: { [`places.${i}.outSeenAt`]: 1 } });
            if (next === "out" && !chk.confirmed) next = "in";                // not sure yet: stay "in" until the next reading
        }
        // Two-way check for the home: the location AND the home Wi-Fi must agree. "In" needs the phone to answer on the Wi-Fi
        // (as the tablet's scan sees it), "out" needs it to be gone from it. When they disagree nothing changes yet.
        if (needsWifi(p, settings)) {
            const me = people.find((x) => x.person === String(phone.person || phone.name).trim());
            const onWifi = Boolean(me && me.home);
            if (next !== (p.state || "") && (next === "in") !== onWifi) next = p.state || "";
        }
        if (next !== (p.state || "")) {
            await HomeSettings.updateOne({ owner }, { $set: { [`places.${i}.state`]: next } });
            const crossed = phone.person || phone.name;
            await record({ owner, device: phone._id, deviceName: phone.name, kind: "place_state", text: `${crossed} is now ${next === "in" ? "inside" : "outside"} ${p.name} (${Math.round(dist)} m from the centre, the phone's own accuracy about ±${Math.round(Number(loc.acc) || 0)} m).` }).catch(() => {});
            if (!p.state) continue;                                   // first sighting: no message
            sendState = next; eventAt = Number(loc.at) || now;
        }
        if (!sendState) { if (p.pending && p.pending.state) await HomeSettings.updateOne({ owner }, { $unset: { [`places.${i}.pending`]: 1 } }); continue; }
        const arrive = sendState === "in";
        // "Tell me on Telegram when they leave / reach": always, whatever the WhatsApp message or the time window says.
        const tgOn = (arrive ? p.tgArrive : p.tgLeave) === true;
        if (tgOn) {
            const who0 = phone.person || phone.name;
            if (await claim(`placetg:${owner}:${p.id}:${sendState}:${Math.floor(eventAt / (30 * 60000))}`)) {
                await record({ owner, device: phone._id, deviceName: phone.name, person: who0, kind: arrive ? "place_arrived" : "place_left", text: `🏢 ${who0} ${p.name} ${arrive ? "pahunch gaye" : "se nikal gaye"} (${localParts(eventAt, tz).hhmm})` });
            }
        }
        // The time window is judged at the moment the phone actually crossed the circle (its fix), not when the report finally arrived.
        const eventMins = localParts(eventAt, tz).minutes;
        const from = okTime(arrive ? p.arriveFrom : p.leaveFrom) ? toMinutes(arrive ? p.arriveFrom : p.leaveFrom) : null;
        const to = okTime(arrive ? p.arriveTo : p.leaveTo) ? toMinutes(arrive ? p.arriveTo : p.leaveTo) : null;
        if (p.strictWindow === true && from !== null && to !== null && !home.inWindow(eventMins, from, to)) {
            if (waiting) await HomeSettings.updateOne({ owner }, { $unset: { [`places.${i}.pending`]: 1 } });
            const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
            await record({ owner, device: phone._id, deviceName: phone.name, kind: "place_skipped", text: `${phone.person || phone.name} ${arrive ? "reached" : "left"} ${p.name} at ${hh(eventMins)}, but the ${arrive ? "arrive" : "leave"} window you set is ${hh(from)}–${hh(to)}, so no message was sent.` }).catch(() => {});
            continue;                                                  // this place is set to "only inside these times"
        }   // not at the time you set
        const text = String((arrive ? p.arriveText : p.leaveText) || "").trim();
        if (!text || !p.group) {
            if (tgOn) continue;                                       // Telegram already said it; no "nothing was sent" note
            await record({ owner, device: phone._id, deviceName: phone.name, kind: "place_skipped", text: `${phone.person || phone.name} ${arrive ? "reached" : "left"} ${p.name}, but ${!text ? `there is no ${arrive ? "arrive" : "leave"} message` : "no WhatsApp group is set"}, so nothing was sent.` }).catch(() => {});
            continue;
        }
        const who = phone.person || phone.name;
        const key = `place:${owner}:${p.id}:${sendState}:${Math.floor(eventAt / (30 * 60000))}`;
        if (tablet && !await claim(key)) continue;                  // already sent for this crossing
        if (!tablet || !await queue(tablet, "send_whatsapp", { group: p.group, text })) {
            if (!waiting) {
                await HomeSettings.updateOne({ owner }, { $set: { [`places.${i}.pending`]: { state: sendState, at: eventAt } } });
                await record({ owner, kind: "place_failed", notify: true, text: `${who} ${arrive ? "reached" : "left"} ${p.name}, but the tablet is offline, so “${text}” was not sent to ${p.group}. It will be sent when the tablet is back.` });
            }
            continue;
        }
        if (p.pending) await HomeSettings.updateOne({ owner }, { $unset: { [`places.${i}.pending`]: 1 } });
        await record({ owner, device: tablet._id, deviceName: tablet.name, kind: "place", notify: true, text: `${who} ${arrive ? "reached" : "left"} ${p.name}: sending “${text}” to ${p.group} on WhatsApp.` });
    }
}

/**
 * Tells the family something: Telegram, the tablet (big text and a voice), the TV if it is on, and the other family
 * phones running Stashr Location. Each place can be switched off under settings.eta (toTablet, toTv, toPhones).
 */
async function announce(owner, text, { settings, devices, exceptDevice, urgent = false, kind = "eta", now = Date.now() } = {}) {
    const eta = (settings && settings.eta) || {};
    const list = devices || await HomeDevice.find({ owner }).lean();
    await record({ owner, kind, notify: true, text });
    if (eta.toTablet !== false) for (const hub of list.filter((d) => d.kind === "hub" && (d.status || {}).agent === "stashr-hub" && Boolean(d.online) && home.isOnline(d, now))) await queue(hub, "announce", { text, speak: false, urgent });
    if (eta.toTv !== false) for (const tv of list.filter((d) => d.kind === "tv" && Boolean(d.online) && home.isOnline(d, now) && (d.status || {}).screen !== "off")) await queue(tv, "notify", { text });
    if (eta.toPhones !== false) for (const ph of list.filter((d) => d.kind === "phone" && (d.status || {}).agent === "stashr-where" && String(d._id) !== String(exceptDevice) && d.lastSeen && now - new Date(d.lastSeen).getTime() < 3 * 3600 * 1000)) await queue(ph, "notice", { text });
}

/** Two phones this close (250 m, or 400 m once they were together) with fresh fixes are travelling together. */
const TOGETHER_M = 250, APART_M = 400;

/**
 * Phones that stay together: returns Map(companionKey -> majorKey). The major phone is the oldest linked one; only it is announced
 * for. They count as together only while both have a fresh fix, so a dead phone never hides a living one, and once they are
 * more than 400 m apart each phone speaks for itself again.
 */
function groupTogether(phones, state, now, spot) {
    // Only phones that are out count: two phones at home are not "travelling together".
    const away = (l) => !spot || !Number.isFinite(Number(spot.lat)) || home.distM({ lat: Number(l.lat), lon: Number(l.lon) }, { lat: Number(spot.lat), lon: Number(spot.lon) }) > (Number(spot.radius) || 200) + 100;
    const fresh = (phones || []).filter((ph) => {
        const l = ph.status && ph.status.location;
        return l && Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lon)) && l.at && now - Number(l.at) <= home.FIX_FRESH_MS && away(l);
    });
    const parent = new Map(fresh.map((ph) => [String(ph._id), String(ph._id)]));
    const find = (k) => { while (parent.get(k) !== k) k = parent.get(k); return k; };
    for (let i = 0; i < fresh.length; i++) {
        for (let j = i + 1; j < fresh.length; j++) {
            const a = fresh[i], b = fresh[j], ka = String(a._id), kb = String(b._id);
            const d = home.distM({ lat: Number(a.status.location.lat), lon: Number(a.status.location.lon) }, { lat: Number(b.status.location.lat), lon: Number(b.status.location.lon) });
            const was = ((state[ka] || {}).tog === kb) || ((state[kb] || {}).tog === ka);
            if (d <= TOGETHER_M || (was && d <= APART_M)) parent.set(find(ka), find(kb));
        }
    }
    const groups = new Map();
    for (const k of parent.keys()) { const r = find(k); groups.set(r, [...(groups.get(r) || []), k]); }
    const out = new Map();
    for (const members of groups.values()) {
        if (members.length < 2) continue;
        const major = members.slice().sort()[0];
        for (const k of members) if (k !== major) out.set(k, major);
    }
    return out;
}

const agoText = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

/** For the Location routes: announce a low battery for one phone (its status as just received). */
async function lowBatteryNow(owner, ph, settings, now) {
    const devices = await HomeDevice.find({ owner }).lean();
    return lowBatteryNotice(owner, ph, settings.homeSpot, settings, devices, now);
}

/** The phone's battery is 20% or less and not charging: tell everyone once (again after 6 hours) with the last place it was seen. */
async function lowBatteryNotice(owner, ph, spot, settings, devices, now) {
    const st = ph.status || {}, pct = Number(st.battery);
    if (!(pct <= 20) || st.charging === true) return false;
    const key = String(ph._id), person = ph.person || ph.name;
    if (!await claim(`lowbatt:${owner}:${key}:${Math.floor(now / (6 * 3600000))}`)) return false;
    const loc = st.location;
    let where = "";
    if (loc && Number.isFinite(Number(loc.lat)) && spot && Number.isFinite(Number(spot.lat))) {
        const km = Math.round(home.distM({ lat: Number(loc.lat), lon: Number(loc.lon) }, { lat: spot.lat, lon: spot.lon }) / 100) / 10;
        where = ` Last location: ${km < 0.3 ? "at home" : km + " km from home"}, ${agoText(now - Number(loc.at))}.`;
    }
    await announce(owner, `${person}'s phone battery is ${Math.round(pct)}%. Location may stop soon.${where}`, { settings, devices, exceptDevice: ph._id, kind: "battery_low", now });
    return true;
}

/**
 * Every minute: a phone that went quiet with a low battery has stopped sharing its location. Say so once (again after 6 hours),
 * with the last place it was seen, so nobody keeps trusting an old "at home".
 */
async function locationWatch(owner, settings, devices, now) {
    const spot = settings.homeSpot;
    for (const ph of (devices || []).filter((d) => d.kind === "phone" && (d.status || {}).agent === "stashr-where")) {
        const st = ph.status || {}, last = ph.lastSeen ? new Date(ph.lastSeen).getTime() : 0;
        if (!last || now - last < 45 * 60000) continue;
        if (!(Number(st.battery) <= 20) || st.charging === true) continue;
        const key = String(ph._id), person = ph.person || ph.name;
        if (!await claim(`stopped:${owner}:${key}:${Math.floor(now / (6 * 3600000))}`)) continue;
        const loc = st.location;
        let where = "";
        if (loc && Number.isFinite(Number(loc.lat)) && spot && Number.isFinite(Number(spot.lat))) {
            const km = Math.round(home.distM({ lat: Number(loc.lat), lon: Number(loc.lon) }, { lat: spot.lat, lon: spot.lon }) / 100) / 10;
            where = ` Last seen ${km < 0.3 ? "at home" : km + " km from home"}, ${agoText(now - Number(loc.at || last))}.`;
        }
        await announce(owner, `${person}'s location stopped (battery ${Math.round(Number(st.battery))}%).${where}`, { settings, devices, exceptDevice: ph._id, kind: "location_stopped", now });
    }
}

/**
 * Where each family phone running Stashr Location is: at home, on the way (and in how long), or just away.
 * "Papa is 10 minutes away": there is no routing service, so the distance is a straight line times 1.3 (roads wind), at
 * the phone's own speed, or the speed it just covered, or 25 km/h: good to a few minutes. A person is "home" when they are
 * inside the home circle, or when the tablet sees their phone on the Wi-Fi and they are within 2 km: whichever comes
 * first. Announces "arriving in N mins" at notifyMinutes and again at 10, 5, 3, 2 and 1 minute, and "Open the door" on arrival, once each.
 */
async function etaTick(owner, now, settings, devices) {
    const spot = settings.homeSpot, eta = settings.eta || {};
    if (!spot || !Number.isFinite(spot.lat) || !Number.isFinite(spot.lon) || eta.enabled === false) return settings.etaState || {};
    const radius = spot.radius || 200, state = { ...(settings.etaState || {}) };
    const people = home.presence((devices || []).filter((d) => d.kind === "hub"), (devices || []).filter((d) => d.kind === "phone"), now, spot);
    const wifiHome = new Set(people.filter((p) => p.home && p.wifi).map((p) => p.person));
    // Tell the family at the chosen time (15 min by default) and then again as they get closer, so a notice is never far away.
    const base = Number(eta.notifyMinutes) || 15;
    const milestones = [...new Set([base, 10, 5, 3, 2, 1].filter((m) => m <= base))].sort((x, y) => y - x);
    let changed = false;
    const together = groupTogether((devices || []).filter((d) => d.kind === "phone"), state, now, spot);
    // Who is with this phone: the phones grouped with it now, or in the last check (two phones that arrive home together are one arrival).
    const matesOf = (key) => [...new Set([...together.entries(), ...Object.entries(state).filter(([, e]) => e && e.tog).map(([k, e]) => [k, e.tog])].filter(([, major]) => major === key).map(([k]) => { const m = (devices || []).find((x) => String(x._id) === k); return m && (m.person || m.name); }).filter(Boolean))];
    for (const ph of (devices || []).filter((d) => d.kind === "phone")) {
        const loc = ph.status && ph.status.location;
        if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lon)) || !loc.at) continue;
        const key = String(ph._id), old = state[key] || {}, person = ph.person || ph.name;
        const d = distanceM({ lat: Number(loc.lat), lon: Number(loc.lon) }, { lat: spot.lat, lon: spot.lon });
        const fresh = now - Number(loc.at) < 90 * 60 * 1000;
        const atHome = d <= radius || (wifiHome.has(person) && d <= 2000);
        const newFix = old.locAt !== Number(loc.at);
        const tog = together.get(key) || "";
        const mate = tog || old.tog || "";   // a companion, now or a moment ago, is not announced on its own
        let next = { ...old, person, atHome, d, locAt: Number(loc.at), tog };
        if (old.locAt !== Number(loc.at)) next.still = old.d !== undefined && Math.abs(d - old.d) < 80 ? Math.min((old.still || 0) + 1, 20) : 0;
        if (newFix) {
            const dt = old.locAt ? (Number(loc.at) - old.locAt) / 1000 : 0;
            // "Coming home" needs a real trip, not GPS wobble at the office: the phone's own speed above walking pace and one closer fix, or two closer fixes
            // that add up to 400 m. A phone that is standing still is never coming.
            let coming = Boolean(old.coming), approach = old.approach || 0, approachM = old.approachM || 0;
            if (atHome) { coming = false; approach = 0; approachM = 0; }
            else if (old.d !== undefined && d < old.d - 30) { approach += 1; approachM += old.d - d; }
            else if (old.d !== undefined && d > old.d + 100) { coming = false; approach = 0; approachM = 0; }
            const driving = Number(loc.speed) >= 2.5;
            if (!atHome && !coming && ((driving && approach >= 1) || (approach >= 2 && approachM >= 400))) coming = true;
            if (coming && (next.still || 0) >= 2 && !(Number(loc.speed) >= 2.5)) { coming = false; approach = 0; approachM = 0; }
            next.approach = approach; next.approachM = approachM;
            let v = Number(loc.speed) > 2 ? Number(loc.speed) : (old.d !== undefined && dt > 20 && old.d - d > 0 ? (old.d - d) / dt : 0);
            if (!(v > 1.5)) v = 7;                                        // 25 km/h
            v = Math.min(Math.max(v, 4), 25);
            next = { ...next, coming: coming && d <= (eta.maxKm || 40) * 1000, minutes: Math.max(1, Math.round((d * 1.3) / v / 60)), km: Math.round(d / 100) / 10, road: false, fired: coming ? (old.fired || []) : [] };
            // By road, when the phone is within reach and moving at driving speed: the OSRM driving time, asked again only
            // after 400 m or 3 minutes. Walking pace (< 2.5 m/s) keeps the straight-line estimate.
            if (eta.routing !== false && !atHome && d <= (eta.maxKm || 40) * 1000 && !(Number(loc.speed) >= 0 && Number(loc.speed) < 2.5 && d < 3000)) {
                const r0 = old.route;
                const reuse = r0 && Date.now() - r0.at < 3 * 60000 && distanceM({ lat: Number(loc.lat), lon: Number(loc.lon) }, { lat: r0.lat, lon: r0.lon }) < 400;
                const got = reuse ? { seconds: Math.max(60, r0.seconds - Math.round((Date.now() - r0.at) / 1000)), meters: r0.meters } : await route.drivingRoute({ lat: Number(loc.lat), lon: Number(loc.lon) }, { lat: spot.lat, lon: spot.lon });
                if (got) {
                    next.minutes = Math.max(1, Math.round(got.seconds / 60)); next.km = Math.round(got.meters / 100) / 10; next.road = true; next.traffic = Boolean(got.traffic) || Boolean(reuse && r0.traffic);
                    next.route = reuse ? r0 : { at: Date.now(), lat: Number(loc.lat), lon: Number(loc.lon), seconds: got.seconds, meters: got.meters };
                }
            }
        }
        if (next.coming && !tog && now - Number(loc.at) < 10 * 60 * 1000 && !atHome) {
            const hit = milestones.filter((m) => next.minutes <= m && !(next.fired || []).includes(m));
            if (hit.length && await claim(`eta:${owner}:${key}:${Math.min(...hit)}:${Math.floor(now / (20 * 60000))}`)) {
                next.fired = [...new Set([...(next.fired || []), ...hit])];
                const mates = matesOf(key), who = mates.length ? `${person} (with ${mates.join(", ")})` : person;
                const text = next.minutes <= 1 ? `${who} is about to arrive` : `${who} is arriving in ${next.minutes} mins`;
                await announce(owner, text, { settings, devices, exceptDevice: ph._id, now });
            }
        }
        if (!atHome && old.atHome === true && fresh && settings.rain !== false && ph.status && ph.status.agent === "stashr-where"
            && await claim(`rain:${owner}:${key}:${localParts(now, settings.timezone || "Asia/Kolkata").date}:${Math.floor(localParts(now, settings.timezone || "Asia/Kolkata").minutes / 360)}`)) {
            // Left home: if rain is likely today, tell this person (only) to take an umbrella.
            try {
                const f = await weather.forecast(settings.weather, settings.timezone || "Asia/Kolkata");
                if (f && Number(f.rainChance) >= 50) await queue(ph, "notice", { text: `Barish ki ${f.rainChance}% sambhavna hai aaj. Chhatri le lo ☔` });
            } catch (e) { /* no weather: stay quiet */ }
        }
        if (atHome && old.atHome === false && fresh && !mate && await claim(`arrived:${owner}:${key}:${Math.floor(now / (20 * 60000))}`)) {
            next.coming = false; next.fired = [];
            const mates = matesOf(key);
            await announce(owner, `Open the door: ${person}${mates.length ? ` (with ${mates.join(", ")})` : ""} arrived home`, { settings, devices, exceptDevice: ph._id, urgent: true, kind: "arrived", now });
        }
        await lowBatteryNotice(owner, ph, spot, settings, devices, now);
        if (JSON.stringify(next) !== JSON.stringify(old)) { state[key] = next; changed = true; }
    }
    if (changed) await HomeSettings.updateOne({ owner }, { $set: { etaState: state } });
    return state;
}

/** Where one phone is for the page and for the app: { state: unset|home|coming|away, distanceKm, etaMinutes }. */
function whereIs(settings, phone, now = Date.now()) {
    const spot = settings.homeSpot, loc = phone.status && phone.status.location;
    if (!spot || !Number.isFinite(spot.lat)) return { state: "unset" };
    if (!loc || !loc.at) return { state: "unknown" };
    const e = (settings.etaState || {})[String(phone._id)] || {};
    const d = distanceM({ lat: Number(loc.lat), lon: Number(loc.lon) }, { lat: spot.lat, lon: spot.lon });
    const km = e.road && e.km ? e.km : Math.round(d / 100) / 10;
    const ageSec = Math.max(0, Math.round((now - Number(loc.at)) / 1000)), stale = now - Number(loc.at) > home.FIX_FRESH_MS;
    if (e.atHome || d <= (spot.radius || 200)) return { state: "home", distanceKm: km, still: e.still || 0, fixAt: Number(loc.at), ageSec, stale };
    return { state: e.coming ? "coming" : "away", distanceKm: km, etaMinutes: e.minutes || null, traffic: Boolean(e.road && e.traffic), still: e.still || 0, fixAt: Number(loc.at), ageSec, stale };
}

/**
 * How much slower or faster to look, by the phone's battery: charging or above 60% is live-ish (x0.5 / x0.6), 40-60% normal,
 * 20-40% slower (x1.8) and 20% or less much slower (x3), because that phone is about to stop reporting anyway.
 */
function batteryScale(batt) {
    if (!batt || !Number.isFinite(Number(batt.pct))) return 1;
    const pct = Number(batt.pct);
    if (batt.charging) return 0.5;
    if (pct >= 60) return 0.6;
    if (pct >= 40) return 1;
    if (pct > 20) return 1.8;
    return 3;
}

/** How long the Stashr Location app should wait before it looks again: often when heading home, rarely when far away. */
function checkInterval(where, batt) {
    const scale = batteryScale(batt);
    // Not moving for 3 checks in a row (at home, at the office…): look half as often, at most every 30 minutes.
    const calm = (sec) => ((where.still || 0) >= 3 ? Math.min(sec * 2, 1800) : sec);
    const fit = (sec, floor = 60) => Math.max(floor, Math.round(sec * scale));
    if (where.state === "coming") { const k = where.distanceKm; const sec = k > 20 ? 600 : k > 10 ? 300 : k > 3 ? 120 : 60; return scale > 1 ? Math.round(sec * Math.min(scale, 1.5)) : sec; }
    // Leaving home is noticed by the phone's Wi-Fi change; this is the safety net, so a charged phone looks every 5 minutes.
    if (where.state === "away") return fit(calm(where.distanceKm < 10 ? 600 : 1500), 120);
    if (where.state === "home") return fit(calm(600), 300);
    return fit(900, 120);
}

/** Who is on the way home right now: [{ person, minutes, km, with }]. A phone travelling with another one is folded into it. */
function comingList(settings, now = Date.now()) {
    const st = settings.etaState || {};
    const mates = (key) => Object.entries(st).filter(([k, e]) => k !== key && e && e.tog === key).map(([, e]) => e.person).filter(Boolean);
    return Object.entries(st)
        .filter(([, e]) => e && e.coming && !e.tog && now - e.locAt < 40 * 60 * 1000)
        .map(([key, e]) => ({ person: e.person, minutes: Math.max(1, e.minutes - Math.floor((now - e.locAt) / 60000)), km: e.km, traffic: Boolean(e.road && e.traffic), with: mates(key) }))
        .sort((a, b) => a.minutes - b.minutes);
}
const comingLine = (c) => (c.minutes <= 1 ? `${c.person} bas pahunchne wale hain` : `${c.person} ${c.minutes} minute mein aa rahe hain`) + (c.with && c.with.length ? ` (${c.with.join(", ")} saath mein)` : "");

/** The shared secret for local mode; made the first time it is needed. */
async function localKeyOf(owner) {
    const s = await settingsOf(owner);
    if (s.localKey) return s.localKey;
    await HomeSettings.updateOne({ owner, $or: [{ localKey: "" }, { localKey: { $exists: false } }] }, { $set: { localKey: require("crypto").randomBytes(16).toString("hex") } });
    return (await settingsOf(owner)).localKey;
}

const agoHi = (m) => (m < 1 ? "abhi" : m < 60 ? `${m} min pehle` : `${Math.round(m / 60)} ghante pehle`);

/**
 * The answer to "kab aayenge" / /coming: who is on the way (with the time), who is out (how far and how fresh the fix is), and
 * "Sab ghar par hain" only when every person is home by the Wi-Fi and the location together and no phone has gone quiet.
 */
function comingReply(settings, devices, now = Date.now()) {
    const people = home.presence((devices || []).filter((d) => d.kind === "hub"), (devices || []).filter((d) => d.kind === "phone"), now, settings.homeSpot);
    const list = comingList(settings, now);
    const lines = [];
    if (list.length) lines.push(list.map(comingLine).join(". ") + ".");
    const onTheWay = new Set(list.flatMap((c) => [c.person, ...(c.with || [])]));
    for (const p of people.filter((x) => !x.home && !onTheWay.has(x.person))) {
        const km = p.distanceKm !== undefined ? `${p.distanceKm} km door` : "";
        if (p.stale) lines.push(`${p.person} ka location ${p.fixAgeMin !== undefined ? agoHi(p.fixAgeMin) + " se" : ""} update nahi hua${km ? ` (aakhri baar ${km})` : ""}.`);
        else lines.push(`${p.person} bahar hain${km ? `, ${km}` : ""}${p.fixAgeMin !== undefined ? ` (${agoHi(p.fixAgeMin)} update)` : ""}.`);
    }
    if (!lines.length) lines.push(people.length ? "Sab ghar par hain." : "Nobody is on the way home right now (no phone is sharing its location).");
    return lines.join(" ");
}

/** Everyone with a person is home, and it is a weekend evening (Fri 17:00 on): the TV launcher then offers movie night. */
function movieNightOn(settings, devices, now = Date.now()) {
    const people = home.presence((devices || []).filter((d) => d.kind === "hub"), (devices || []).filter((d) => d.kind === "phone"), now, settings.homeSpot);
    if (!people.length || !people.every((p) => p.home)) return false;
    const l = localParts(now, settings.timezone || "Asia/Kolkata");
    return l.weekday === 6 || l.weekday === 0 ? l.minutes >= 16 * 60 : l.weekday === 5 && l.minutes >= 17 * 60;
}

/** The weekly report: TV time per day, new devices, speed, camera alerts. */
async function weeklyText(owner, settings, now = Date.now()) {
    const tz = settings.timezone || "Asia/Kolkata";
    const lines = ["📊 <b>Your home this week</b>"];
    let total = 0; const apps = {};
    for (let i = 0; i < 7; i++) {
        const u = (settings.usage || {})[localParts(now - i * 24 * 3600 * 1000, tz).date];
        if (!u) continue;
        total += u.minutes || 0;
        for (const [k, v] of Object.entries(u.apps || {})) apps[k] = (apps[k] || 0) + v;
    }
    lines.push(`📺 TV: ${fmtMin(total)} in 7 days (${fmtMin(Math.round(total / 7))} a day)${topApps(apps) ? ". Most: " + topApps(apps) : ""}.`);
    const since = new Date(now - 7 * 24 * 3600 * 1000);
    const news = await HomeEvent.find({ owner, kind: "lan_new", at: { $gte: since } }).sort({ at: -1 }).limit(10).lean();
    lines.push(news.length ? `📶 ${news.length} new device${news.length > 1 ? "s" : ""} on the Wi-Fi: ${news.map((e) => e.text.replace(/^.*?: /, "")).join("; ")}.` : "📶 No new devices on the Wi-Fi.");
    const speeds = await HomeSpeed.find({ owner, at: { $gte: since } }).lean();
    if (speeds.length) {
        const avg = (k) => Math.round(speeds.reduce((a, s) => a + (s[k] || 0), 0) / speeds.length);
        const worst = speeds.reduce((a, s) => (s.down < a.down ? s : a), speeds[0]);
        lines.push(`🚀 Internet: average ${avg("down")} Mbit/s down, ${avg("up")} up, ${avg("ping")} ms. Slowest ${worst.down} Mbit/s.`);
    }
    const camera = await HomeEvent.countDocuments({ owner, kind: "camera", at: { $gte: since } });
    lines.push(`📷 Camera alerts: ${camera}.`);
    return lines.join("\n");
}

const habitCache = new Map();      // owner -> { at, habits }: learned again at most once an hour

/** "Papa is late today": somebody is well past the time they usually leave (still home) or get home (still out). Once per person, day and kind. */
async function habitWatch(owner, settings, devices, now = Date.now()) {
    const habitsLib = require("./homeHabits");
    const tz = settings.timezone || "Asia/Kolkata";
    const parts = (ms) => localParts(ms, tz);
    let hit = habitCache.get(String(owner));
    if (!hit || now - hit.at > 3600_000) {
        const rows = await HomeEvent.find({ owner, kind: { $in: ["presence_away", "presence_home"] }, person: { $ne: "" }, at: { $gte: new Date(now - habitsLib.WINDOW_DAYS * 86400000) } }).select("person kind at").lean();
        hit = { at: now, habits: habitsLib.learn(rows.map((r) => ({ person: r.person, kind: r.kind, at: new Date(r.at).getTime() })), parts, now) };
        habitCache.set(String(owner), hit);
        if (habitCache.size > 200) habitCache.delete(habitCache.keys().next().value);
    }
    if (!Object.keys(hit.habits).length) return [];
    const nowParts = parts(now);
    const phones = devices.filter((d) => d.kind === "phone");
    const people = home.presence(devices.filter((d) => d.kind === "hub"), phones, now, settings.homeSpot);
    const today = await HomeEvent.find({ owner, kind: { $in: ["presence_away", "presence_home"] }, at: { $gte: new Date(now - 24 * 3600_000) } }).select("person kind at").lean();
    const todays = {};
    for (const e of today) {
        if (parts(new Date(e.at).getTime()).date !== nowParts.date) continue;
        const t = todays[e.person] || (todays[e.person] = {});
        if (e.kind === "presence_away") t.left = true; else t.reached = true;
    }
    const late = habitsLib.lateNow(people, hit.habits, nowParts, todays);
    const sent = [];
    for (const l of late) {
        if (!(await claim(`late:${owner}:${l.key}`))) continue;
        await record({ owner, person: l.person, kind: "late", text: habitsLib.lateText(l) });
        sent.push(l);
    }
    return sent;
}

/**
 * Says, once, when somebody reaches home or leaves it, whether the Wi-Fi or the phone's location noticed first. A change has to hold for two
 * checks in a row (about a minute) before it is announced, so one odd fix does not send a message. The first look only remembers who is where.
 * presenceState: { person: { home, pending? } }.
 */
async function presenceWatch(owner, settings, devices, now = Date.now()) {
    const phones = devices.filter((d) => d.kind === "phone");
    if (!phones.length) return;
    const people = home.presence(devices.filter((d) => d.kind === "hub"), phones, now, settings.homeSpot);
    const old = settings.presenceState || {}, next = {};
    const said = [];
    for (const p of people) {
        const was = old[p.person];
        if (!was || typeof was.home !== "boolean") { next[p.person] = { home: p.home }; continue; }
        if (p.home === was.home) { next[p.person] = { home: was.home }; continue; }
        if (was.pending === p.home) {
            next[p.person] = { home: p.home };
            const far = !p.home && p.distanceKm !== undefined && p.distanceKm >= 0.3 ? ` (${p.distanceKm} km away)` : "";
            said.push({ person: p.person, home: p.home, text: p.home ? `🟢 ${p.person} reached home` : `⚪ ${p.person} left home${far}` });
        } else next[p.person] = { home: was.home, pending: p.home };
    }
    if (JSON.stringify(next) !== JSON.stringify(old)) await HomeSettings.updateOne({ owner }, { $set: { presenceState: next } });
    for (const s of said) {
        // The arrival logic ("Papa is arriving in 5 mins", "Open the door: Papa arrived home") may have just said it: do not say it twice.
        // The event is still written to the timeline (habits and questions need it), just not sent to Telegram a second time.
        const dup = s.home && await HomeEvent.exists({ owner, at: { $gte: new Date(now - 6 * 60_000) }, text: new RegExp(`${s.person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*(arrived|about to arrive)`, "i") });
        if (dup) await HomeEvent.create({ owner, person: s.person, kind: "presence_home", text: s.text, at: new Date(now) }).catch(() => {});
        else await record({ owner, person: s.person, kind: s.home ? "presence_home" : "presence_away", text: s.text });
    }
}

async function sendTelegram(owner, text) {
    const User = require("../models/schema");
    const bot = require("./telegramBot");
    const skip = Object.fromEntries([...User.HISTORY_FIELDS, ...User.PHOTO_FIELDS, "passwords"].map((f) => [f, 0]));
    const user = await User.findById(owner, skip);
    return user ? bot.notifyUser(user, text) : false;
}

const safeKey = (s) => String(s || "Other").replace(/[.$]/g, " ").trim().slice(0, 40) || "Other";

/** Everything that runs once a minute for one account. */
async function tickOwner(owner, now = Date.now()) {
    const settings = await settingsOf(owner);
    if (!settings) return;
    const tz = settings.timezone || "Asia/Kolkata";
    const local = localParts(now, tz);
    const minuteKey = `${local.date}T${local.hhmm}`;
    const devices = await HomeDevice.find({ owner }).lean();
    const tvs = devices.filter((d) => d.kind === "tv");
    const tvOn = (d) => Boolean(d.online) && home.isOnline(d, now) && (d.status || {}).screen !== "off";
    await locationWatch(owner, settings, devices, now).catch(() => {});
    await presenceWatch(owner, settings, devices, now).catch(() => {});
    await habitWatch(owner, settings, devices, now).catch(() => {});
    // The house map improves itself: once an hour it looks for a new zone and says so.
    if (local.minutes % 60 === 7 && await claim(`mapimp:${owner}:${minuteKey}`)) await require("./homeMap").selfImprove(owner, now).catch(() => {});
    // The room model improves itself: once an hour each phone's model is tuned and its auto samples are checked (utils/roomLive.maintain).
    if (local.minutes % 60 === 37 && await claim(`roomfit:${owner}:${minuteKey}`)) await require("./roomLive").maintain(owner, now).catch(() => {});

    // 1. TV time: a minute for every minute a TV screen is on, by app.
    if (tvs.some(tvOn) && await claim(`usage:${owner}:${minuteKey}`)) {
        const tv = tvs.find(tvOn);
        const app = safeKey(((tv.status || {}).app || {}).label);
        const inc = { [`usage.${local.date}.minutes`]: 1, [`usage.${local.date}.apps.${app}`]: 1 };
        await HomeSettings.updateOne({ owner }, { $inc: inc });
        const old = Object.keys(settings.usage || {}).sort().slice(0, Math.max(0, Object.keys(settings.usage || {}).length - USAGE_DAYS));
        if (old.length) await HomeSettings.updateOne({ owner }, { $unset: Object.fromEntries(old.map((k) => [`usage.${k}`, ""])) });

        // 2. The daily TV limit: past it, the TV is sent home (or paused) and you are told; again every 15 minutes.
        const lim = settings.tvLimit || {};
        const used = (((settings.usage || {})[local.date] || {}).minutes || 0) + 1;
        if (lim.minutes > 0 && used >= lim.minutes) {
            const [lastDate, lastMin] = String(lim.lastEnforced || "").split("@");
            if (lastDate !== local.date || used - Number(lastMin || 0) >= 15) {
                await HomeSettings.updateOne({ owner }, { $set: { "tvLimit.lastEnforced": `${local.date}@${used}` } });
                if (lim.action === "pause") await queue(tv, "media", { action: "play_pause" });
                if (lim.action === "home") { await queue(tv, "media", { action: "play_pause" }); await queue(tv, "key", { key: "HOME" }); }
                await record({ owner, device: tv._id, deviceName: tv.name, kind: "tv_limit", notify: true, text: `TV time today is ${fmtMin(used)}, past the ${fmtMin(lim.minutes)} limit${lim.action === "notify" ? "" : lim.action === "pause" ? ". Paused it." : ". Sent the TV to its home screen."}` });
            }
        }
        // 3. Still on late at night.
        if (lim.lateNight !== false && local.minutes >= 60 && local.minutes < 300 && lim.lateNightNotified !== local.date) {
            await HomeSettings.updateOne({ owner }, { $set: { "tvLimit.lateNightNotified": local.date } });
            await record({ owner, device: tv._id, deviceName: tv.name, kind: "tv_late", notify: true, text: `${tv.name} is still on at ${local.hhmm}. Send it to standby from the remote, or pause it from Stashr.` });
        }
    }

    // 4. Schedules: "every day at 23:00, pause the TV", "weekdays at 07:30, open the news".
    for (const s of settings.schedules || []) {
        if (!s || s.enabled === false || s.time !== local.hhmm) continue;
        if (Array.isArray(s.days) && s.days.length && !s.days.includes(local.weekday)) continue;
        if (!await claim(`schedule:${s.id}:${minuteKey}`)) continue;
        await runSteps(owner, devices, s.steps || [], `Schedule “${s.name || s.time}”`);
    }

    // 5. Nobody is home, but the TV is on.
    if (settings.alerts && settings.alerts.emptyHomeTv !== false) {
        const people = home.presence(devices.filter((d) => d.kind === "hub"), devices.filter((d) => d.kind === "phone"), now, settings.homeSpot);
        const anyoneHome = people.some((p) => p.home);
        if (people.length && !anyoneHome && tvs.some(tvOn) && !settings.emptyHomeNotifiedAt) {
            if (await claim(`empty:${owner}:${local.date}:${Math.floor(local.minutes / 30)}`)) {
                await HomeSettings.updateOne({ owner }, { $set: { emptyHomeNotifiedAt: new Date(now) } });
                await record({ owner, kind: "empty_home", notify: true, text: "Nobody seems to be home, but the TV is on. Say “pause” or “tv home” in Stashr to stop it." });
            }
        } else if ((anyoneHome || !tvs.some(tvOn)) && settings.emptyHomeNotifiedAt) {
            await HomeSettings.updateOne({ owner }, { $unset: { emptyHomeNotifiedAt: "" } });
        }
    }

    // 5b. The camera follows the house: on when the last person leaves, off when the first one is back.
    if (settings.camera && settings.camera.auto) await autoCamera(owner, settings, devices, now);

    await geoTick(owner, now, settings, devices);
    await etaTick(owner, now, settings, devices);

    // 6. The morning brief and the weekly report.
    if (settings.brief && settings.brief.enabled && settings.brief.time === local.hhmm && settings.brief.lastSent !== local.date && await claim(`brief:${owner}:${local.date}`)) {
        await HomeSettings.updateOne({ owner }, { $set: { "brief.lastSent": local.date } });
        await require("./homeReport").sendReport(owner, { hours: 24, now });
    }
    if (settings.weekly && settings.weekly.enabled && local.weekday === 0 && local.hhmm === "20:00" && settings.weekly.lastSent !== local.date && await claim(`weekly:${owner}:${local.date}`)) {
        await HomeSettings.updateOne({ owner }, { $set: { "weekly.lastSent": local.date } });
        await require("./homeReport").sendReport(owner, { hours: 168, now });
    }
}

/** Runs the steps of a scene or a schedule: each is { kind: "tv" | "hub", type, args }. Returns how many were sent. */
async function runSteps(owner, devices, steps, why) {
    let sent = 0;
    for (const step of (steps || []).slice(0, 10)) {
        const target = devices.find((d) => d.kind === step.kind && (!step.device || String(d._id) === String(step.device)));
        if (!target) continue;
        if (await queue(target, step.type, step.args || {})) sent++;
    }
    if (why && sent) await record({ owner, kind: "automation", text: `${why}: sent ${sent} command${sent > 1 ? "s" : ""}` });
    return sent;
}

/** Checks one scene or schedule step list from the page; returns the clean list or null. */
function cleanSteps(steps) {
    if (!Array.isArray(steps) || !steps.length || steps.length > 10) return null;
    const out = [];
    for (const s of steps) {
        if (!s || !home.KINDS.includes(s.kind)) return null;
        const c = home.cleanCommand(s.kind, String(s.type || ""), s.args);
        if (!c) return null;
        out.push({ kind: s.kind, ...c });
    }
    return out;
}

async function tickAll(now = Date.now()) {
    const owners = await HomeDevice.distinct("owner");
    for (const owner of owners) {
        try { await tickOwner(owner, now); } catch (e) { console.log("[home] automation failed:", e.message); }
    }
}

const DEFAULT_SCENES = [
    { id: "movie-night", name: "Movie night", steps: [{ kind: "tv", type: "volume", args: { level: 30 } }, { kind: "tv", type: "launch_app", args: { package: "com.netflix.ninja" } }] },
    { id: "quiet", name: "Quiet", steps: [{ kind: "tv", type: "volume", args: { level: 10 } }] },
    { id: "goodnight", name: "Good night", steps: [{ kind: "tv", type: "media", args: { action: "play_pause" } }, { kind: "tv", type: "key", args: { key: "HOME" } }] }
];

module.exports = { habitWatch, presenceWatch, comingReply, groupTogether, batteryScale, checkInterval, lowBatteryNow, houseSummary, localParts, toMinutes, okTime, claim, settingsOf, queue, lanAlerts, tickOwner, tickAll, runSteps, cleanSteps, briefText, weeklyText, todayLines, movieNightOn, localKeyOf, autoCamera, geoTick, needsWifi, distanceM, etaTick, announce, whereIs, comingList, comingLine, sendTelegram, DEFAULT_SCENES, fmtMin };
