/**
 * Stashr Home: the rules behind the TV and the Wi-Fi hub. Kept free of Express so they can be tested alone.
 */
const crypto = require("crypto");

const ONLINE_MS = 150 * 1000;          // a device that has not reported for this long is offline
// A Wi-Fi device not answering for this long has left. Phones doze and skip pings for several minutes when the screen
// is off, so a short window filled the timeline with "left" / "joined" for a phone that never moved.
const LAN_GONE_MS = 15 * 60 * 1000;
const LAN_FORGET_MS = 30 * 24 * 3600 * 1000;
const MAX_STATUS_BYTES = 150 * 1024;
const MAX_COMMANDS = 20;

const COMMANDS = {
    tv: {
        remove_movie: (a) => (okName(a.name) ? { name: a.name } : null),
        play_movie: (a) => (okName(a.name) ? { name: a.name } : null),
        launch_app: (a) => (/^[A-Za-z0-9_.]{3,200}$/.test(String(a.package || "")) ? { package: a.package } : null),
        volume: (a) => {
            if (["up", "down", "mute"].includes(a.action)) return { action: a.action };
            const level = Number(a.level);
            return Number.isInteger(level) && level >= 0 && level <= 100 ? { level } : null;
        },
        media: (a) => (["play_pause", "next", "previous"].includes(a.action) ? { action: a.action } : null),
        key: (a) => (["HOME", "BACK"].includes(a.key) ? { key: a.key } : null),
        // Opens a YouTube or YouTube Music link in the TV's own YouTube app, where your Premium account already works.
        open_url: (a) => (okYoutube(a.url) ? { url: a.url } : null),
        sync_now: () => ({}),
        // Opens the live map of the family members who are out.
        live_location: () => ({}),
        // A short message on the TV screen (needs a TV app that understands it).
        notify: (a) => (okText(a.text, 200) ? { text: a.text.trim() } : null)
    },
    hub: {
        scan_now: () => ({}),
        // Puts the tablet screen to sleep (the Accessibility lock-screen action), for a tablet that should stay dark.
        screen_off: () => ({}),
        speed_test: () => ({}),
        // An experiment: can the tablet see somebody walking between it and the router from the Wi-Fi signal strength alone? (2 minutes)
        wifi_motion_test: () => ({}),
        check_update: () => ({}),
        // Wake-on-LAN: the tablet sends the magic packet on the home Wi-Fi.
        wake: (a) => (okMac(a.mac) ? { mac: normMac(a.mac) } : null),
        // Plays songs on the tablet through YouTube Music (where the Premium account is signed in).
        play_music: (a) => (okText(a.query, 120) ? { query: a.query.trim() } : null),
        camera: (a) => (["arm", "disarm", "snapshot", "clip", "live"].includes(a.action) ? { action: a.action } : null),
        slideshow: (a) => (["start", "stop"].includes(a.action) ? { action: a.action } : null),
        show_today: () => ({}),
        show_map: () => ({}),
        show_room: () => ({}),
        announce: (a) => (okText(a.text, 200) ? { text: a.text.trim(), speak: a.speak !== false, urgent: a.urgent === true } : null),
        send_whatsapp: (a) => (okText(a.group, 80) && okText(a.text, 500) ? { group: a.group.trim(), text: a.text.trim() } : null),
        // One message to one number (WhatsApp Business only): the text, and the sheet's picture when `image` is true.
        send_wa: (a) => {
            const phone = String(a.phone || "").replace(/\D/g, "");
            const sendId = String(a.sendId || "");
            if (phone.length < 10 || phone.length > 14 || !/^[a-f0-9]{24}$/.test(sendId)) return null;
            const text = typeof a.text === "string" ? a.text.trim().slice(0, 900) : "";
            if (!text && a.image !== true) return null;
            return { phone, text, sendId, image: a.image === true };
        }
    },
    phone: {
        report_now: () => ({}),
        notice: (a) => (okText(a.text, 200) ? { text: a.text.trim() } : null)
    }
};

/** A command that goes to the tablet, the TV or a family phone; used by the page, the assistant and schedules. */
const KINDS = Object.keys(COMMANDS);

// Ports that should not be open on a home device without you knowing: each is a common way in.
const RISKY_PORTS = {
    21: "FTP (files without encryption)", 23: "Telnet (remote login without encryption)", 445: "Windows file sharing",
    3389: "Remote Desktop", 5555: "Android debugging (ADB) open to the network", 5900: "VNC screen sharing",
    554: "Camera video stream (RTSP)", 1883: "MQTT without a password", 8291: "Router admin (Winbox)", 2323: "Telnet (alternate port)"
};
const risksOf = (ports) => (Array.isArray(ports) ? ports : []).filter((p) => RISKY_PORTS[p]).map((p) => ({ port: p, why: RISKY_PORTS[p] }));

function okMac(m) { return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(m || "").trim()); }
function normMac(m) { return String(m).trim().toLowerCase().replace(/-/g, ":"); }
function okText(t, max) { return typeof t === "string" && t.trim().length > 0 && t.length <= max && !/[\u0000-\u001f]/.test(t); }

function okYoutube(u) {
    try {
        const url = new URL(String(u || ""));
        return url.protocol === "https:" && String(u).length <= 300 && !url.username && !url.password
            && ["www.youtube.com", "youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(url.hostname);
    } catch (e) { return false; }
}

function okName(n) { return typeof n === "string" && n.length > 0 && n.length <= 300 && !/[\u0000-\u001f]/.test(n); }

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const newToken = () => "sh_" + crypto.randomBytes(24).toString("hex");

/** Checks a command and returns it with only the arguments that command takes, or null. */
function cleanCommand(kind, type, args) {
    const rule = COMMANDS[kind] && COMMANDS[kind][type];
    if (!rule) return null;
    const clean = rule(args && typeof args === "object" ? args : {});
    return clean ? { type, args: clean } : null;
}

/** A report from a device: plain JSON, limited in size and depth, with no key a database could mistake for an operator. */
function scrub(value, depth = 0) {
    if (depth > 6) return null;
    if (Array.isArray(value)) return value.slice(0, 400).map((v) => scrub(v, depth + 1));
    if (value && typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (k.startsWith("$") || k.includes(".") || k.length > 60) continue;
            out[k] = scrub(v, depth + 1);
        }
        return out;
    }
    if (typeof value === "string") return value.slice(0, 500);
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    return typeof value === "boolean" || value === null ? value : null;
}

/**
 * What an app says about its own state ("health"): which permissions and switches it has and its last error. Only these keys, with
 * these types, are kept, so the website can show a checklist without trusting anything else in the report.
 */
const HEALTH_BOOLS = ["overlay", "accessibility", "batteryUnrestricted", "notifications", "camera", "microphone", "gpsEnabled", "usbStorage", "wifi", "serverReachable"];
function cleanHealth(h) {
    if (!h || typeof h !== "object" || Array.isArray(h)) return undefined;
    const out = { v: 1 };
    for (const k of HEALTH_BOOLS) if (typeof h[k] === "boolean") out[k] = h[k];
    if (["always", "whileInUse", "denied", "off"].includes(h.location)) out.location = h.location;
    if (typeof h.appVersion === "string") out.appVersion = h.appVersion.slice(0, 20);
    for (const k of ["versionCode", "sdk"]) if (Number.isFinite(Number(h[k]))) out[k] = Math.round(Number(h[k]));
    if (typeof h.model === "string") out.model = h.model.slice(0, 40);
    if (typeof h.brand === "string") out.brand = h.brand.replace(/[^\w .-]/g, "").slice(0, 30);
    if (h.lastError && typeof h.lastError === "object" && typeof h.lastError.text === "string" && Number.isFinite(Number(h.lastError.at))) {
        out.lastError = { at: Math.round(Number(h.lastError.at)), where: String(h.lastError.where || "").slice(0, 40), text: h.lastError.text.slice(0, 400) };
    }
    return out;
}

function cleanStatus(status) {
    if (!status || typeof status !== "object" || Array.isArray(status)) return null;
    const clean = scrub(status);
    if (clean && clean.health !== undefined) { const h = cleanHealth(clean.health); if (h) clean.health = h; else delete clean.health; }
    return JSON.stringify(clean).length > MAX_STATUS_BYTES ? null : clean;
}

/** Battery from either shape a device reports: a number with a separate `charging`, or `{ pct, charging }`. -> { pct, charging } or null. */
function batteryOf(status) {
    const b = status && status.battery;
    if (b && typeof b === "object") return Number.isFinite(Number(b.pct)) ? { pct: Math.round(Number(b.pct)), charging: Boolean(b.charging) } : null;
    return Number.isFinite(Number(b)) && b !== null ? { pct: Math.round(Number(b)), charging: Boolean(status.charging) } : null;
}

const isOnline = (device, now = Date.now()) => Boolean(device.lastSeen) && now - new Date(device.lastSeen).getTime() < ONLINE_MS;

const slug = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
/** Names that many devices share, so they cannot tell one device from another. */
const GENERIC_NAMES = new Set(["android", "iphone", "ipad", "localhost", "unknown", "espressif", "esp", "router", "gateway", "device", "host"]);
const usefulName = (n) => { const s = slug(n); return s.length >= 3 && !GENERIC_NAMES.has(s) && !/^\d+(-\d+){3}$/.test(s); };

/**
 * A key that is safe as a database field name and follows the device, not its address: the MAC if the tablet could
 * read it, else the device's own name (phones get a new IP when they reconnect, but keep their name), else the IP.
 */
const lanKey = (d) => {
    const mac = slug(d.mac);
    if (mac && mac !== "02-00-00-00-00-00") return mac;
    if (d.name && usefulName(d.name)) return "n-" + slug(d.name).slice(0, 58);
    return slug(d.ip);
};

/**
 * Folds one scan of the Wi-Fi into the book of every device ever seen. A device that answered is "up" and gets a new
 * last-seen time; one that did not stays in the book as "down". Events are only made for a real arrival or departure,
 * not for a device that blinked.
 */
function mergeLan(book, scan, labels = {}, now = Date.now()) {
    const next = { ...book };
    const events = [];
    const seen = new Set();
    const moves = [];
    const list = Array.isArray(scan) ? scan.slice(0, 400).filter((d) => d && typeof d === "object") : [];
    // Two devices reporting the same name in one scan: the name tells them apart from nobody, so both keep their IP key.
    const nameCount = {};
    for (const d of list) { const k = lanKey(d); if (k.startsWith("n-")) nameCount[k] = (nameCount[k] || 0) + 1; }
    for (const d of list) {
        let key = lanKey(d);
        if (nameCount[key] > 1) key = slug(d.ip);
        // No name this time (the lookup can fail), but a device that had one answered at this address last: same device.
        if (key === slug(d.ip) && !next[key]) {
            const prior = Object.entries(next).filter(([k, v]) => k !== key && !seen.has(k) && v.ip === d.ip && (k.startsWith("n-") || !/^\d/.test(k))).sort((x, y) => y[1].lastSeen - x[1].lastSeen)[0];
            if (prior) key = prior[0];
        }
        if (!key || seen.has(key)) continue;
        seen.add(key);
        // The device was in the book under its IP before it had a name: carry its history and your label over.
        const ipKey = slug(d.ip);
        if (key !== ipKey && !next[key] && next[ipKey] && !seen.has(ipKey)) {
            next[key] = { ...next[ipKey] };
            delete next[ipKey];
            moves.push({ from: ipKey, to: key });
        }
        const old = next[key];
        const wasUp = Boolean(old && old.up);
        const awayMs = old ? now - old.lastSeen : 0;
        next[key] = {
            ip: String(d.ip || "").slice(0, 45),
            mac: String(d.mac || "").slice(0, 20),
            name: String(d.name || (old && old.name) || "").slice(0, 80),
            vendor: String(d.vendor || (old && old.vendor) || "").slice(0, 60),
            up: d.up !== false,
            pingMs: Number.isFinite(Number(d.pingMs)) ? Math.max(0, Math.min(60000, Math.round(Number(d.pingMs)))) : ((old && old.pingMs) || 0),
            firstSeen: old ? old.firstSeen : now,
            lastSeen: d.up !== false ? now : (old ? old.lastSeen : now),
            ports: Array.isArray(d.ports) ? d.ports.slice(0, 10).map(Number).filter(Number.isInteger) : (old && old.ports) || []
        };
        const lbl = labels[key] || {};
        const label = lbl.label || next[key].name || next[key].ip;
        if (!old) events.push({ kind: "lan_new", key, known: false, text: `New device on the Wi-Fi: ${label} (${next[key].ip})` });
        else if (next[key].up && !wasUp && awayMs > LAN_GONE_MS) events.push({ kind: "lan_joined", key, known: Boolean(lbl.tag && lbl.tag !== "unknown"), text: `${label} joined the Wi-Fi` });
    }
    for (const [key, d] of Object.entries(next)) {
        if (seen.has(key)) continue;
        if (now - d.lastSeen > LAN_FORGET_MS) { delete next[key]; continue; }
        if (d.up && now - d.lastSeen > LAN_GONE_MS) {
            next[key] = { ...d, up: false };
            const label = (labels[key] && labels[key].label) || d.name || d.ip;
            events.push({ kind: "lan_left", key, text: `${label} left the Wi-Fi` });
        }
    }
    return { book: next, events, moves };
}

/** Movies that appeared on or vanished from the TV's USB drive between two reports. */
function diffMovies(prev, next) {
    const before = new Set(((prev && prev.movies) || []).map((m) => m.name));
    const after = new Set(((next && next.movies) || []).map((m) => m.name));
    const events = [];
    for (const n of after) if (!before.has(n) && (prev && prev.movies)) events.push({ kind: "movie_added", text: `Movie on the USB drive: ${n}` });
    for (const n of before) if (!after.has(n) && (next && next.movies)) events.push({ kind: "movie_removed", text: `Movie removed from the USB drive: ${n}` });
    return events.slice(0, 20);
}

const TAGS = ["mine", "family", "guest", "unknown"];

/**
 * Who is at home. A person is home when one of their devices answers on the Wi-Fi: a Wi-Fi row you gave that person,
 * or their family phone (paired with Stashr) whose own address is answering on a tablet's scan.
 */
/** A location fix older than this is not trusted to say where somebody is now. */
const FIX_FRESH_MS = 12 * 60 * 1000;
/** A phone's own Wi-Fi report (its address on the home network) older than this no longer proves it is home. */
const PHONE_WIFI_MS = 8 * 60 * 1000;

/** A last known location inside the home circle keeps a person "home" (flagged stale) for up to this long. */
const LAST_IN_MAX_MS = 24 * 3600 * 1000;

const rad = (x) => (x * Math.PI) / 180;
function distM(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Who is home, from the Wi-Fi and the phone's location together.
 *  - a phone that reported its own address on the home network a moment ago is home (unless its fix says it is over 2 km away);
 *  - otherwise a fresh location fix (12 minutes) decides: inside the circle is home, outside is away, even when the tablet
 *    still sees another device of that person (a laptop left at home);
 *  - with no fresh fix, a labelled Wi-Fi device the tablet saw within 15 minutes means home.
 * Each person comes back with home, by ("wifi", "gps", "wifi+gps" or "") and, when the home spot is known, distanceKm,
 * fixAt and stale (the phone has not reported a location for a while), so "everyone is home" is only said when it is true.
 */
function presence(hubs, phones, now = Date.now(), spot = null) {
    const people = new Map();
    const touch = (name) => { const k = name.trim(); if (!people.has(k)) people.set(k, { person: k, home: false, lastSeen: 0, devices: [], wifi: false, by: "" }); return people.get(k); };
    const upIps = new Set();
    const lanSeen = new Map();          // person -> a labelled Wi-Fi device was up recently
    for (const h of hubs || []) {
        const labels = h.lanLabels || {};
        for (const [key, d] of Object.entries(h.lanBook || {})) {
            const up = Boolean(d.up) && now - d.lastSeen < LAN_GONE_MS;
            if (up) upIps.add(d.ip);
            const who = labels[key] && labels[key].person;
            if (!who) continue;
            const p = touch(who);
            p.devices.push((labels[key] && labels[key].label) || d.name || d.ip);
            if (up) lanSeen.set(p.person, true);
            p.lastSeen = Math.max(p.lastSeen, d.lastSeen || 0);
        }
    }
    const gps = new Map();              // person -> "in" | "out" (fresh fixes only)
    const hasPhone = new Map();
    const radius = spot && Number.isFinite(Number(spot.radius)) ? Number(spot.radius) : 200;
    for (const ph of phones || []) {
        const s = ph.status || {};
        const p = touch(ph.person || ph.name);
        p.devices.push(ph.name);
        hasPhone.set(p.person, true);
        const seenAt = ph.lastSeen ? new Date(ph.lastSeen).getTime() : 0;
        const wifiNow = seenAt && now - seenAt < PHONE_WIFI_MS && s.wifi && s.ip && upIps.has(s.ip);
        if (wifiNow) { p.wifi = true; p.lastSeen = Math.max(p.lastSeen, seenAt); }
        const loc = s.location;
        if (spot && Number.isFinite(Number(spot.lat)) && Number.isFinite(Number(spot.lon)) && loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lon)) && loc.at) {
            const d = distM({ lat: Number(loc.lat), lon: Number(loc.lon) }, { lat: Number(spot.lat), lon: Number(spot.lon) });
            const age = now - Number(loc.at);
            const better = p.fixAt === undefined || Number(loc.at) > p.fixAt;
            if (better) { p.fixAt = Number(loc.at); p.distanceKm = Math.round(d / 100) / 10; p.distanceM = Math.round(d); p.lastIn = d <= radius + Math.min(Math.max(Number(loc.acc) || 0, 0), 100); }
            if (age <= FIX_FRESH_MS) {
                const acc = Math.min(Math.max(Number(loc.acc) || 0, 0), 300);
                const verdict = d <= radius + Math.min(acc, 100) ? "in" : d > radius + Math.max(120, acc) ? "out" : gps.get(p.person) || "";
                if (verdict && gps.get(p.person) !== "in") gps.set(p.person, verdict);
            }
        }
    }
    for (const p of people.values()) {
        const g = gps.get(p.person), w = p.wifi;
        if (w && !(g === "out" && p.distanceM > 2000)) { p.home = true; p.by = g === "in" ? "wifi+gps" : "wifi"; }
        else if (g === "in") { p.home = true; p.by = "gps"; }
        else if (g === "out") { p.home = false; p.by = "gps"; }
        else if (lanSeen.get(p.person) && !(hasPhone.get(p.person) && p.fixAt !== undefined && now - p.fixAt <= FIX_FRESH_MS)) { p.home = true; p.by = "wifi"; p.wifi = true; }
        // No fresh fix and no Wi-Fi proof, but the last known fix (under 24 h old) was inside the circle: still shown as home
        // (the phone has not said it left), flagged stale so the page says the location is not updating.
        else if (!g && p.lastIn && p.fixAt !== undefined && now - p.fixAt <= LAST_IN_MAX_MS) { p.home = true; p.by = "last"; }
        p.stale = Boolean(hasPhone.get(p.person) && spot && !g && !p.wifi);
        if (p.fixAt !== undefined) p.fixAgeMin = Math.max(0, Math.round((now - p.fixAt) / 60000));
    }
    return [...people.values()].sort((a, b) => (b.home - a.home) || a.person.localeCompare(b.person));
}

/** True when the time (minutes after midnight) is inside a window that may wrap past midnight (e.g. 23:00–05:00). */
function inWindow(minutes, from, to) {
    if (from === to) return false;
    return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

module.exports = {
    ONLINE_MS, LAN_GONE_MS, MAX_COMMANDS, COMMANDS, KINDS, TAGS, RISKY_PORTS, hashToken, newToken, cleanCommand, cleanStatus,
    cleanHealth, batteryOf, isOnline, lanKey, mergeLan, diffMovies, risksOf, presence, distM, FIX_FRESH_MS, PHONE_WIFI_MS, inWindow, okMac, normMac, slug
};
