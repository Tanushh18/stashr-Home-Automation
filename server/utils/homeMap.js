/**
 * The house map, learned by itself. Every family phone and the tablet report which Wi-Fi access point they are connected to (the BSSID).
 * Each physical access point is a ZONE of the house: Stashr counts who sits where and when, which zones people walk between, and
 * keeps drawing a better map as more data comes in (run again on every read, and hourly to tell you about a new zone).
 *
 * What it can and cannot know, plainly:
 *  - a zone is as big as an access point's reach, not a room; one router means one zone;
 *  - names are guesses from habits (phones sleeping there, the tablet's spot) until you rename them, and your names always win;
 *  - devices that only show up in the tablet's Wi-Fi scan (the TV…) are placed by the room you gave them, not by radio;
 *  - the layout is a diagram: neighbouring zones are the ones people walk between, not measured distances.
 * An optional floor-plan picture (from a phone scan app) can be put behind the diagram.
 *
 * `learn` and `layout` are pure so they can be tested; `noteAp` and `build` talk to the database.
 */
const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;

/** A usable lower-case BSSID, or "" (empty, all zeros, or Android's placeholder 02:00:00:00:00:00). */
function normBssid(b) {
    const s = String(b || "").trim().toLowerCase();
    return MAC.test(s) && s !== "02:00:00:00:00:00" && s !== "00:00:00:00:00:00" ? s : "";
}

/** One physical access point: the BSSIDs of its radios (2.4 and 5 GHz, guest network) differ only in the last byte. */
const apOf = (bssid) => normBssid(bssid).split(":").slice(0, 5).join(":");

const subnetOf = (ip) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip || "")) ? String(ip).split(".").slice(0, 3).join(".") : "");

/**
 * rows: [{ device, ap, bssid, count, h, firstSeen, lastSeen }], edges: [{ a, b, count }], devices: [{ id, kind, name, person }],
 * names: { [apId]: "Living room" } (yours), offsetHours: hours to add to UTC for the local clock.
 * -> zones [{ id, name, auto, hint, bssids, observations, days, confidence, hubHere, phonesHere }] most-seen first.
 */
function learn({ rows, devices = [], names = {}, offsetHours = 0, now = Date.now() }) {
    const kind = new Map(devices.map((d) => [String(d.id), d.kind]));
    const zones = new Map();
    for (const r of rows) {
        if (!r.ap) continue;
        const z = zones.get(r.ap) || { id: r.ap, bssids: new Set(), observations: 0, first: Infinity, last: 0, hub: 0, phones: 0, night: 0 };
        z.bssids.add(r.bssid); z.observations += r.count || 0;
        z.first = Math.min(z.first, new Date(r.firstSeen).getTime()); z.last = Math.max(z.last, new Date(r.lastSeen).getTime());
        const k = kind.get(String(r.device));
        if (k === "hub") z.hub += r.count || 0;
        if (k === "phone") {
            z.phones += r.count || 0;
            for (const [utc, n] of Object.entries(r.h || {})) { const local = (Number(utc) + offsetHours + 24) % 24; if (local < 6) z.night += Number(n) || 0; }
        }
        zones.set(r.ap, z);
    }
    const list = [...zones.values()].filter((z) => z.observations >= 3).sort((a, b) => b.observations - a.observations);
    const topNight = list.reduce((best, z) => (z.night > (best ? best.night : 0) ? z : best), null);
    const topHub = list.reduce((best, z) => (z.hub > (best ? best.hub : 0) ? z : best), null);
    return list.map((z, i) => {
        let hint = "";
        if (list.length > 1 && topHub && z.id === topHub.id) hint = "tablet sits here";
        else if (list.length > 1 && topNight && z.id === topNight.id && z.night >= 5) hint = "phones sleep here (bedroom?)";
        return {
            id: z.id, name: String(names[z.id] || "").trim() || `Zone ${i + 1}`, auto: !String(names[z.id] || "").trim(), hint,
            bssids: [...z.bssids], observations: z.observations, days: Math.max(1, Math.round((z.last - z.first) / 86400000)),
            confidence: Math.min(1, Math.round((z.observations / 150) * 100) / 100), hubHere: z.hub > 0, phonesHere: z.phones > 0
        };
    });
}

/**
 * Where each block goes on the diagram (grid units; each block is 2 x 2 with half a unit between). Zones that people walk between often
 * are put next to each other: start with the most seen, then always add the zone most connected to those already placed.
 * Extra blocks (rooms only known from labels) come after the zones.
 */
function layout(zones, edges = [], extra = []) {
    const conn = (a, b) => edges.filter((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a)).reduce((s, e) => s + (e.count || 0), 0);
    const left = [...zones], order = [];
    if (left.length) order.push(left.shift());
    while (left.length) {
        let bi = 0, bs = -1;
        left.forEach((z, i) => { const s = order.reduce((t, p) => t + conn(z.id, p.id), 0); if (s > bs) { bs = s; bi = i; } });
        order.push(left.splice(bi, 1)[0]);
    }
    const all = [...order, ...extra];
    const COLS = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(all.length))));
    return all.map((b, i) => ({ ...b, x: (i % COLS) * 2.5, y: Math.floor(i / COLS) * 2.5, w: 2, h: 2 }));
}

const same = (a, b) => { const x = String(a).toLowerCase().trim(), y = String(b).toLowerCase().trim(); return x && y && (x === y || x.includes(y) || y.includes(x)); };

/* ───────── the house layout you edit (rooms only) ───────── */

const STEP = 0.5, MAX_XY = 40, MIN_SIZE = 1, MAX_SIZE = 8, MIN_Z = 0.3, MAX_Z = 3, DEFAULT_Z = 0.55;
const snap = (v) => Math.round(v / STEP) * STEP;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * What you may save as the layout: { "Bedroom": { x, y, w, h, z } } for rooms that exist. Positions and sizes snap to half a grid unit
 * and are kept inside sane limits; z is the height of the block in 3D. Unknown rooms and non-numbers are dropped.
 */
function cleanLayout(raw, roomNames) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const name of roomNames) {
        const r = raw[name];
        if (!r || typeof r !== "object") continue;
        const x = Number(r.x), y = Number(r.y), w = Number(r.w), h = Number(r.h), z = r.z === undefined ? DEFAULT_Z : Number(r.z);
        if (![x, y, w, h, z].every(Number.isFinite)) continue;
        out[name] = { x: clamp(snap(x), 0, MAX_XY), y: clamp(snap(y), 0, MAX_XY), w: clamp(snap(w), MIN_SIZE, MAX_SIZE), h: clamp(snap(h), MIN_SIZE, MAX_SIZE), z: Math.round(clamp(z, MIN_Z, MAX_Z) * 100) / 100 };
    }
    return out;
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The first free place (scanning rows, half a unit at a time, with half a unit of gap) for a block of size w x h next to the others. */
function freeSpot(others, w, h) {
    const gap = STEP;
    for (let y = 0; y <= MAX_XY; y += STEP) for (let x = 0; x <= MAX_XY; x += STEP) {
        const box = { x: x - gap, y: y - gap, w: w + gap * 2, h: h + gap * 2 };
        if (!others.some((o) => overlaps(box, o))) return { x, y };
    }
    return { x: 0, y: 0 };
}

/** Puts saved geometry on the blocks and moves every other block to a free place, so a new room never lands on top of a saved one. */
function applyLayout(blocks, saved) {
    const placed = blocks.filter((b) => saved[b.name]).map((b) => ({ ...b, ...saved[b.name] }));
    const rest = blocks.filter((b) => !saved[b.name]);
    const taken = placed.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
    const moved = rest.map((b) => {
        const clash = taken.some((t) => overlaps({ x: b.x, y: b.y, w: b.w, h: b.h }, t));
        const spot = clash ? freeSpot(taken, b.w, b.h) : { x: b.x, y: b.y };
        const nb = { ...b, ...spot, z: DEFAULT_Z };
        taken.push({ x: nb.x, y: nb.y, w: nb.w, h: nb.h });
        return nb;
    });
    const byName = new Map([...placed, ...moved].map((b) => [b.name, b]));
    return blocks.map((b) => byName.get(b.name) || b);
}

/** The rooms you gave the tablet's Wi-Fi devices (Name / room): { room: [{ label, tag, up }] }. */
function roomsFromLabels(hubs, now = Date.now(), goneMs = 15 * 60 * 1000) {
    const out = {};
    for (const h of hubs || []) {
        const labels = h.lanLabels || {};
        for (const [key, d] of Object.entries(h.lanBook || {})) {
            const l = labels[key];
            if (!l || !l.room) continue;
            (out[l.room] = out[l.room] || []).push({ label: l.label || d.name || d.ip, tag: l.tag || "", up: Boolean(d.up) && now - (d.lastSeen || 0) < goneMs });
        }
    }
    return out;
}

/* ───────── the database side ───────── */

const lastNoted = new Map();     // device id -> { bssid, ap, at }: writes at most every 10 minutes, and a change at once

/**
 * Remembers where a device is connected. Phones count only on the home network (same /24 as the tablet), so an office or a cafe is
 * never mistaken for a zone of the house. Never throws; call it without awaiting.
 */
async function noteAp(device, bssidRaw, now = Date.now()) {
    try {
        const bssid = normBssid(bssidRaw);
        if (!bssid) return false;
        const ap = apOf(bssid), key = String(device._id), prev = lastNoted.get(key);
        if (prev && prev.bssid === bssid && now - prev.at < 10 * 60 * 1000) return false;
        const HomeDevice = require("../models/homeDevice");
        if (device.kind === "phone") {
            const hubs = await HomeDevice.find({ owner: device.owner, kind: "hub" }).select("status.wifi.ip status.scan.subnet").lean();
            const mine = subnetOf((device.status || {}).ip);
            const home = hubs.some((h) => subnetOf(h.status && h.status.wifi && h.status.wifi.ip) === mine && mine);
            if (!home) { lastNoted.set(key, { bssid, ap, at: now }); return false; }
        } else if (device.kind !== "hub") return false;
        const { HomeApSeen, HomeApEdge } = require("../models/homeApSeen");
        const hour = new Date(now).getUTCHours();
        await HomeApSeen.updateOne({ owner: device.owner, device: device._id, bssid },
            { $inc: { count: 1, [`h.${hour}`]: 1 }, $set: { ap, lastSeen: new Date(now) }, $setOnInsert: { firstSeen: new Date(now) } }, { upsert: true });
        if (prev && prev.ap && prev.ap !== ap && now - prev.at < 20 * 60 * 1000) {
            const [a, b] = [prev.ap, ap].sort();
            await HomeApEdge.updateOne({ owner: device.owner, a, b }, { $inc: { count: 1 }, $set: { lastSeen: new Date(now) } }, { upsert: true });
        }
        lastNoted.set(key, { bssid, ap, at: now });
        if (lastNoted.size > 500) lastNoted.delete(lastNoted.keys().next().value);
        return true;
    } catch (e) { console.log("[map] noteAp failed:", e.message); return false; }
}

/** Everything the website and the tablet draw: zones with their place on the grid, who is where, the plan picture, what it has learned so far. */
async function build(owner, now = Date.now(), { rooms: useRooms = true } = {}) {
    const HomeModel3d = require("../models/homeModel3d");
    const HomeDevice = require("../models/homeDevice");
    const { HomeApSeen, HomeApEdge } = require("../models/homeApSeen");
    const automation = require("./homeAutomation");
    const home = require("./home");
    const settings = await automation.settingsOf(owner);
    const tz = settings.timezone || "Asia/Kolkata";
    const devices = await HomeDevice.find({ owner }).lean();
    const hubs = devices.filter((d) => d.kind === "hub"), phones = devices.filter((d) => d.kind === "phone" && (d.status || {}).agent === "stashr-where");
    const rows = await HomeApSeen.find({ owner }).lean();
    const edges = await HomeApEdge.find({ owner }).lean();
    const lp = automation.localParts(now, tz), utcH = new Date(now).getUTCHours();
    const offsetHours = (Math.floor(lp.minutes / 60) - utcH + 24) % 24;
    const map = settings.map || {};
    const zones = learn({ rows: rows.map((r) => ({ ...r, device: String(r.device) })), devices: devices.map((d) => ({ id: String(d._id), kind: d.kind, name: d.name })), names: map.zoneNames || {}, offsetHours, now });

    // Rooms from labels: attached to a zone with the same name, otherwise a block of their own.
    const rooms = roomsFromLabels(hubs, now);
    const attach = new Map(zones.map((z) => [z.id, []]));
    const extra = [];
    for (const [room, items] of Object.entries(rooms)) {
        const z = zones.find((zz) => same(zz.name, room));
        if (z) attach.get(z.id).push(...items);
        else extra.push({ id: "room:" + room, name: room, auto: false, hint: "from your device labels", bssids: [], observations: 0, days: 0, confidence: 0, labelOnly: true, devices: items });
    }
    // Rooms you made in Room Lab replace the Wi-Fi zones as the blocks of the map: people are put in the room the phone's model says.
    const roomNames = useRooms && Array.isArray(map.rooms) ? map.rooms : [];
    const roomMode = roomNames.length > 0;
    let placed;
    if (roomMode) {
        const blocks = roomNames.map((n, i) => ({ id: "r:" + n, name: n, auto: false, hint: "", bssids: [], observations: roomNames.length - i, days: 0, confidence: 1, roomBlock: true, devices: Object.entries(rooms).filter(([room]) => same(room, n)).flatMap(([, items]) => items) }));
        const others = Object.entries(rooms).filter(([room]) => !roomNames.some((n) => same(room, n))).map(([room, items]) => ({ id: "room:" + room, name: room, auto: false, hint: "from your device labels", bssids: [], observations: 0, days: 0, confidence: 0, labelOnly: true, devices: items }));
        // rooms people walk between (a phone's room changed from one to the other) are put next to each other; your saved layout always wins
        const walks = edges.filter((e) => String(e.a).startsWith("r:") && String(e.b).startsWith("r:")).map((e) => ({ a: e.a, b: e.b, count: e.count }));
        const auto = layout(blocks, walks, others);
        const saved = cleanLayout(map.layout, roomNames);
        const geometry = applyLayout(auto.filter((b) => b.roomBlock), saved);
        placed = [...geometry.map((b) => ({ ...b, z: b.z || DEFAULT_Z })), ...auto.filter((b) => !b.roomBlock)];
    } else placed = layout(zones.map((z) => ({ ...z, devices: attach.get(z.id) })), edges.filter((e) => !String(e.a).startsWith("r:")).map((e) => ({ a: e.a, b: e.b, count: e.count })), extra);

    // People and the tablet: where each is connected right now.
    const people = home.presence(hubs, phones, now, settings.homeSpot);
    const fresh = (d) => d.lastSeen && now - new Date(d.lastSeen).getTime() < 20 * 60 * 1000;
    const roomLive = require("./roomLive");
    const roomIdOf = (d) => { const r = d && roomLive.currentOf(d, now); return r && roomNames.includes(r.name) ? "r:" + r.name : ""; };
    const zoneOf = (d) => { const b = d.kind === "hub" ? normBssid(d.status && d.status.wifi && d.status.wifi.bssid) : normBssid(d.status && d.status.bssid); return b && fresh(d) ? apOf(b) : ""; };
    const inZone = new Map(placed.map((z) => [z.id, { ...z, people: [], hub: false }]));
    if (!roomMode) for (const h of hubs) { const z = inZone.get(zoneOf(h)); if (z) z.hub = true; }
    const homeNoZone = [], away = [];
    for (const p of people) {
        const ph = phones.find((d) => (d.person || d.name) === p.person);
        if (!p.home) { away.push({ person: p.person, distanceKm: p.distanceKm ?? null }); continue; }
        const z = ph && inZone.get(roomMode ? roomIdOf(ph) : zoneOf(ph));
        // in a room: also how sure the latest scan was (the 3D map fades a person whose room is not sure)
        const r = roomMode && z ? roomLive.currentOf(ph, now) : null;
        if (z) z.people.push({ person: p.person, by: roomMode ? "room" : p.by, ...(r ? { sure: r.sure !== false, confidence: Number(r.confidence) || 0 } : {}) }); else homeNoZone.push({ person: p.person, by: p.by });
    }
    const days = rows.length ? Math.max(1, Math.round((now - Math.min(...rows.map((r) => new Date(r.firstSeen).getTime()))) / 86400000)) : 0;
    const note = roomMode ? `${roomNames.length} kamre. Phones ka Wi-Fi/Bluetooth se kamra pehchana jaata hai (Room Lab mein train karo); jis phone ka kamra pakka nahi wo “ghar par, kamra pata nahi” mein dikhta hai.`
        : !zones.length ? "No zone learned yet: phones and the tablet must report their Wi-Fi access point (update Stashr Location to 1.6.2 and Stashr Hub to 1.9.1), and the phones must be on the home Wi-Fi a while."
        : zones.length === 1 ? "Only one Wi-Fi access point seen so far, so the house is one zone. Rooms appear as separate zones only when the house has more than one access point (a mesh or an extender)."
        : `${zones.length} zones learned from ${rows.reduce((s, r) => s + (r.count || 0), 0)} sightings over ${days} day${days === 1 ? "" : "s"}; the map keeps improving as more come in.`;
    const model = await HomeModel3d.findOne({ owner }).select("name size at").lean();
    return { zones: [...inZone.values()], homeNoZone, away, plan: map.plan || "", model: model ? { name: model.name, size: model.size, at: model.at } : null, layoutSaved: roomMode && Object.keys(cleanLayout(map.layout, roomNames)).length > 0, stats: { rooms: roomNames.length, zones: zones.length, aps: new Set(rows.map((r) => r.ap)).size, days, sightings: rows.reduce((s, r) => s + (r.count || 0), 0) }, note, at: now };
}

/** Hourly: if a new zone has appeared since last time, say so once (Telegram, through the timeline). */
async function selfImprove(owner, now = Date.now()) {
    const HomeSettings = require("../models/homeSettings");
    const { record } = require("./homeEvents");
    const data = await build(owner, now, { rooms: false });          // learn the Wi-Fi zones whether or not rooms are in use
    const learned = ((await HomeSettings.findOne({ owner }).select("map").lean()) || {}).map || {};
    const ids = data.zones.filter((z) => !z.labelOnly).map((z) => z.id);
    const known = Array.isArray(learned.learned) ? learned.learned : null;
    if (known === null) { await HomeSettings.updateOne({ owner }, { $set: { "map.learned": ids } }); return []; }
    const fresh = data.zones.filter((z) => !z.labelOnly && !known.includes(z.id));
    if (fresh.length || ids.length !== known.length) await HomeSettings.updateOne({ owner }, { $set: { "map.learned": ids } });
    for (const z of fresh) await record({ owner, kind: "map_zone", text: `🗺️ Naya zone mila: ${z.name}${z.hint ? " (" + z.hint + ")" : ""}. Website par Smart home → Insights → Ghar ka map mein naam de do.` });
    return fresh;
}

module.exports = { cleanLayout, applyLayout, freeSpot, overlaps, normBssid, apOf, subnetOf, learn, layout, roomsFromLabels, noteAp, build, selfImprove };
