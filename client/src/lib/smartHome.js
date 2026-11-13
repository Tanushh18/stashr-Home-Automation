/* Small rules for the Smart home page, kept apart from React so they can be tested. */

/** "off" (not reporting), "standby" (reporting, screen off), "on", or "idle" for a hub that is reporting. */
export function stateOf(device) {
  if (!device || !device.online) return "off";
  if (device.kind === "tv") return device.status?.screen === "off" ? "standby" : "on";
  return "idle";
}

export const STATE_LABEL = { off: "Off / not connected", standby: "Standby", on: "On", idle: "Online" };

export function fmtBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "0 MB";
  return v >= 1e9 ? (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + " GB" : Math.max(1, Math.round(v / 1e6)) + " MB";
}

export function ago(when, now = Date.now()) {
  if (!when) return "never";
  const s = Math.max(0, Math.round((now - new Date(when).getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " d ago";
}

/** One line for the TV card: what is on screen, and what is playing. */
export function nowPlaying(status) {
  const s = status || {};
  const m = s.media;
  if (m && m.title) return `${m.state === "paused" ? "Paused" : "Playing"}: ${m.title}${m.artist ? " · " + m.artist : ""}`;
  if (s.app && s.app.label) return s.app.label;
  return "Home screen";
}

/** Signal strength as words. dBm is how Wi-Fi reports it: closer to 0 is stronger. */
export function signalWord(rssi) {
  const v = Number(rssi);
  if (!Number.isFinite(v) || v === 0) return "";
  if (v >= -55) return "Excellent";
  if (v >= -67) return "Good";
  if (v >= -75) return "Fair";
  return "Weak";
}

/** Wi-Fi devices grouped by the room you gave them, rooms in order, "No room" last. */
export function groupByRoom(lan) {
  const rooms = new Map();
  for (const d of lan || []) {
    const room = (d.room || "").trim() || "No room";
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room).push(d);
  }
  return [...rooms.entries()].sort((a, b) => (a[0] === "No room") - (b[0] === "No room") || a[0].localeCompare(b[0]));
}

export function lanName(d) {
  return (d.label || d.name || d.vendor || d.ip || "Unknown device").trim();
}

/** Wi-Fi rows split into the ones worth showing and the old ones (not seen for a day), which fold away. */
export function splitStale(lan) {
  const fresh = [], old = [];
  for (const d of lan || []) (d.stale ? old : fresh).push(d);
  return { fresh, old };
}

export const TAG_LABEL = { mine: "Mine", family: "Family", guest: "Guest", unknown: "Unknown" };

/** Minutes as "1 h 35 min". */
export function fmtMinutes(m) {
  const v = Math.max(0, Math.round(Number(m) || 0));
  return v >= 60 ? `${Math.floor(v / 60)} h${v % 60 ? " " + (v % 60) + " min" : ""}` : `${v} min`;
}

/** A tidy top for a y-axis: 1, 2, 2.5 or 5 times a power of ten, at least the largest value. */
export function niceMax(v) {
  const n = Math.max(1, Number(v) || 0);
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

/** Schedule days as words: [] or all seven -> "Every day", [1..5] -> "Weekdays". */
export function daysLabel(days) {
  const d = [...new Set(days || [])].sort();
  if (!d.length || d.length === 7) return "Every day";
  if (d.join() === "1,2,3,4,5") return "Weekdays";
  if (d.join() === "0,6") return "Weekends";
  return d.map((x) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x]).join(", ");
}

/** What a scene or schedule step does, in words. */
export function stepLabel(s) {
  const a = s.args || {};
  if (s.type === "volume") return a.level !== undefined ? `Volume ${a.level}` : a.action === "mute" ? "Mute" : `Volume ${a.action}`;
  if (s.type === "media") return { play_pause: "Play / pause", next: "Next", previous: "Previous" }[a.action] || "Media";
  if (s.type === "key") return a.key === "HOME" ? "TV home screen" : "Back";
  if (s.type === "launch_app") return "Open " + (APP_NAMES[a.package] || a.package);
  if (s.type === "open_url") return "Open YouTube link";
  if (s.type === "play_music") return `Play “${a.query}” on the tablet`;
  if (s.type === "camera") return { arm: "Security camera on", disarm: "Security camera off", snapshot: "Camera photo", clip: "Camera clip", live: "Camera live view" }[a.action];
  if (s.type === "slideshow") return a.action === "start" ? "Photo slideshow on the tablet" : "Stop the slideshow";
  if (s.type === "scan_now") return "Scan the Wi-Fi";
  if (s.type === "speed_test") return "Internet speed test";
  return s.type.replace(/_/g, " ");
}

export const APP_NAMES = {
  "com.netflix.ninja": "Netflix", "com.amazon.amazonvideo.livingroom": "Prime Video", "in.startv.hotstar": "JioHotstar",
  "com.google.android.youtube.tv": "YouTube", "com.google.android.youtube.tvmusic": "YouTube Music", "com.mxtech.videoplayer.television": "MX Player",
  "com.graymatrix.did": "Zee5", "com.news18.atv": "News18", "com.abpnewslive": "ABP News", "com.july.ndtv": "NDTV", "com.indiatoday.tv": "India Today", "com.zeenews.tv": "Zee News"
};

/** Steps a person can pick for a scene or a schedule. */
export const STEP_CHOICES = [
  { label: "TV: pause / play", step: { kind: "tv", type: "media", args: { action: "play_pause" } } },
  { label: "TV: home screen", step: { kind: "tv", type: "key", args: { key: "HOME" } } },
  { label: "TV: mute", step: { kind: "tv", type: "volume", args: { action: "mute" } } },
  { label: "TV: volume 10", step: { kind: "tv", type: "volume", args: { level: 10 } } },
  { label: "TV: volume 30", step: { kind: "tv", type: "volume", args: { level: 30 } } },
  ...Object.entries(APP_NAMES).map(([pkg, name]) => ({ label: `TV: open ${name}`, step: { kind: "tv", type: "launch_app", args: { package: pkg } } })),
  { label: "Tablet: security camera on", step: { kind: "hub", type: "camera", args: { action: "arm" } } },
  { label: "Tablet: security camera off", step: { kind: "hub", type: "camera", args: { action: "disarm" } } },
  { label: "Tablet: photo slideshow", step: { kind: "hub", type: "slideshow", args: { action: "start" } } },
  { label: "Tablet: speed test", step: { kind: "hub", type: "speed_test", args: {} } },
  { label: "Tablet: scan the Wi-Fi", step: { kind: "hub", type: "scan_now", args: {} } }
];

/**
 * Reads a place from what people paste: "28.6139, 77.2090", "28.6139 77.2090", "28.6139N 77.2090E", or a Google Maps / OpenStreetMap
 * link ("…/@28.6139,77.2090,17z", "?q=28.6139,77.2090", "!3d28.6139!4d77.2090", "mlat=…&mlon=…"). Returns { lat, lon } or null.
 */
export function parseCoords(text) {
  const t = decodeURIComponent(String(text || "")).trim();
  if (!t) return null;
  const ok = (la, lo) => (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? { lat: Math.round(la * 1e6) / 1e6, lon: Math.round(lo * 1e6) / 1e6 } : null);
  let m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(t) || /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(t) || /[?&](?:q|ll|query|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/.exec(t);
  if (m) return ok(Number(m[1]), Number(m[2]));
  m = /mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/.exec(t);
  if (m) return ok(Number(m[1]), Number(m[2]));
  m = /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i.exec(t);
  if (m) {
    let la = Number(m[1]), lo = Number(m[3]);
    if (/s/i.test(m[2] || "")) la = -Math.abs(la);
    if (/w/i.test(m[4] || "")) lo = -Math.abs(lo);
    return ok(la, lo);
  }
  return null;
}

/** Battery from either shape a device reports: a number (with `charging` beside it) or { pct, charging }. -> { pct, charging } or null. */
export function batteryOf(status) {
  const b = status && status.battery;
  if (b && typeof b === "object") return Number.isFinite(Number(b.pct)) ? { pct: Math.round(Number(b.pct)), charging: Boolean(b.charging) } : null;
  return b !== null && b !== undefined && b !== "" && Number.isFinite(Number(b)) ? { pct: Math.round(Number(b)), charging: Boolean(status.charging) } : null;
}

/**
 * The health checklist of one device, from what its app reports about itself (status.health).
 * -> [{ id, label, state: "ok" | "bad" | "warn" | "unknown", fix }]. "bad" = something that stops a feature, "warn" = it works but worse.
 * `now` is a parameter so it can be tested.
 */
/** The battery / autostart steps for the phone's maker: each one kills background apps in its own way. */
export function vendorTip(h = {}) {
  const who = `${h.brand || ""} ${h.model || ""}`.toLowerCase();
  if (/samsung|^sm-|\bsm-/.test(who)) return "Samsung: Settings → Battery → Background usage limits → Never sleeping apps → add Stashr Location (and turn off 'Put unused apps to sleep').";
  if (/xiaomi|redmi|poco/.test(who)) return "Xiaomi/Redmi/POCO: Settings → Apps → Manage apps → Stashr Location → Autostart ON, and Battery saver → No restrictions.";
  if (/oppo|realme|oneplus|cph|rmx/.test(who)) return "Oppo/Realme/OnePlus: Settings → Battery → App battery management → Stashr Location → Allow background activity + Allow auto launch.";
  if (/vivo|iqoo/.test(who)) return "Vivo/iQOO: Settings → Battery → Background power consumption → Stashr Location → Allow, and i Manager → Autostart → ON.";
  if (/motorola|moto|nokia|hmd|google|pixel/.test(who)) return "Settings → Apps → Stashr Location → App battery usage → Unrestricted.";
  return "Settings → Apps → Stashr Location → Battery → Unrestricted (Xiaomi/Oppo/Vivo/Samsung also have an Autostart or 'Never sleeping apps' list: add it there).";
}

const versionLess = (v, min) => { const a = String(v || "0").split(".").map(Number), b = min.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== b[i]) return (a[i] || 0) < b[i]; } return false; };

export function healthItems(device, now = Date.now()) {
  const st = device.status || {}, h = st.health;
  const out = [];
  const add = (id, label, state, fix = "") => out.push({ id, label, state, fix });
  const kind = device.kind;
  const phoneApp = kind === "phone" && st.agent === "stashr-where";
  const online = Boolean(device.online);
  const age = device.lastSeen ? now - new Date(device.lastSeen).getTime() : Infinity;
  if (kind === "phone") add("online", "Reached Stashr recently", age < 3 * 3600 * 1000 ? "ok" : "bad", "The phone has not reported for hours: open Stashr Location once, check it has internet, and turn off battery restrictions for it.");
  else add("online", "Online", online ? "ok" : "bad", kind === "tv" ? "Open Stashr TV (and check the TV is on the Wi-Fi). If it keeps going offline, set Stashr TV to 'unrestricted' battery use." : "Open Stashr Hub on the tablet and check its internet. Keep it on the charger.");
  if (!h) {
    add("health", "Reports its health", "unknown", kind === "tv" ? "Update Stashr TV to 1.3 or later (it updates itself when it is online)." : kind === "hub" ? "Update Stashr Hub to 1.9 or later." : phoneApp ? "Update Stashr Location to 1.5 or later." : "This app does not report its health.");
    return out;
  }
  const flag = (id, label, value, badState, fix) => add(id, label, value === undefined ? "unknown" : value ? "ok" : badState, fix);
  if (kind === "hub") {
    flag("overlay", "Can show messages over other apps", h.overlay, "bad", "Tablet: Settings → Apps → Stashr Hub → Display over other apps → allow. Without it announcements show only as a notification.");
    flag("notifications", "Notifications allowed", h.notifications, "warn", "Tablet: Settings → Apps → Stashr Hub → Notifications → allow.");
    flag("camera", "Camera allowed", h.camera, "bad", "Tablet: Settings → Apps → Stashr Hub → Permissions → Camera → allow.");
    flag("microphone", "Microphone allowed", h.microphone, "warn", "Tablet: Settings → Apps → Stashr Hub → Permissions → Microphone → allow (for Hey Stashr).");
    flag("batteryUnrestricted", "Runs without battery limits", h.batteryUnrestricted, "warn", "Tablet: Settings → Apps → Stashr Hub → Battery → Unrestricted. Keep the tablet charging.");
    flag("accessibility", "WhatsApp helper (Accessibility) on", h.accessibility, "warn", "Only for WhatsApp messages: Tablet: Settings → Accessibility → Stashr Hub → on (Android 13+: App info → ⋮ → Allow restricted settings first).");
  } else if (kind === "tv") {
    flag("overlay", "Can show messages over a playing video", h.overlay, "bad", "TV: Stashr TV → Settings → Display over other apps → allow (or Settings → Apps → Stashr TV → Display over other apps).");
    flag("accessibility", "'Stashr TV remote' (Accessibility) on", h.accessibility, "bad", "TV: Stashr TV → Settings → Accessibility → Stashr TV remote → on. Home/Back commands and 'which app is playing' need it.");
    flag("usbStorage", "USB drive for movies found", h.usbStorage, "warn", "TV: plug in the USB drive for movies (only needed for movie sync).");
    flag("batteryUnrestricted", "Runs without battery limits", h.batteryUnrestricted, "warn", "TV: Settings → Apps → Stashr TV → Battery → Unrestricted.");
  } else if (phoneApp) {
    add("location", "Location: 'Allow all the time'", h.location === "always" ? "ok" : h.location === undefined ? "unknown" : "bad", "Phone: Settings → Apps → Stashr Location → Permissions → Location → Allow all the time (and Precise).");
    flag("gpsEnabled", "Location services on", h.gpsEnabled, "bad", "Phone: turn on Location in the quick settings.");
    flag("notifications", "Notifications allowed", h.notifications, "warn", "Phone: Settings → Apps → Stashr Location → Notifications → allow (to get 'X is arriving').");
    flag("batteryUnrestricted", "Not stopped by battery saver", h.batteryUnrestricted, "warn", vendorTip(h));
    // How old is the last location, and can the server wake this phone up (Firebase push)?
    const fixAt = Number(st.location && st.location.at);
    if (fixAt) { const min = Math.round((now - fixAt) / 60000); add("fix", `Last location ${min < 1 ? "just now" : min < 60 ? min + " min ago" : Math.round(min / 60) + " h ago"}`, min <= 20 ? "ok" : min <= 180 ? "warn" : "bad", "The phone has not sent a location for a while. " + (device.push && device.push.on ? "Stashr is asking it to report; if it stays old, the phone is off, has no internet, or its battery settings block the app: " : "Update Stashr Location to 1.6 or later so Stashr can wake it up. ") + vendorTip(h)); }
    else add("fix", "Has sent a location", "bad", "No location yet: open Stashr Location, allow location 'all the time' and wait a minute.");
    if (device.push) {
      add("push", "Wake-up push (Firebase) registered", device.push.on ? "ok" : "warn", "This phone has not given Stashr its push address yet: install Stashr Location 1.6 or later, open it once, and keep it on the internet.");
      if (device.push.on && device.push.misses >= 3) add("pushMiss", "Phone answers wake-ups", "warn", `Stashr asked this phone to report ${device.push.misses} times in a row and it did not answer. It is off, offline, or its battery settings stop the app. ${vendorTip(h)}`);
    }
    if (h.appVersion && versionLess(h.appVersion, "1.6.0")) add("version", `App version ${h.appVersion}`, "warn", "Older than 1.6.0: tap 'Install update' in Stashr Location to get wake-up push and the longer location trail.");
  }
  if (h.lastError && now - h.lastError.at < 7 * 24 * 3600 * 1000) {
    add("lastError", `Last error (${h.lastError.where || "app"}, ${new Date(h.lastError.at).toLocaleString()})`, "warn", h.lastError.text);
  }
  return out;
}

/** One text block with every problem found, to paste into a chat instead of copying logs. */
export function healthReport(devices, now = Date.now()) {
  const lines = [`Stashr health report · ${new Date(now).toLocaleString()}`];
  for (const d of devices) {
    const st = d.status || {}, h = st.health || {};
    const items = healthItems(d, now);
    lines.push("", `${d.name} (${d.kind}${st.agent ? ", " + st.agent : ""}) · app ${h.appVersion || "?"}${h.sdk ? ` · Android API ${h.sdk}` : ""}${h.model ? ` · ${h.model}` : ""} · ${d.online ? "online" : "offline"}`);
    for (const i of items) lines.push(`  [${i.state.toUpperCase()}] ${i.label}${i.state === "ok" ? "" : " — " + i.fix}`);
  }
  return lines.join("\n");
}

/** "4.2 MB/s" or "380 KB/s"; "" when there is no speed to show. */
export function fmtSpeed(bps) {
  const v = Number(bps);
  if (!Number.isFinite(v) || v <= 0) return "";
  return v >= 1e6 ? (v / 1e6).toFixed(1) + " MB/s" : Math.max(1, Math.round(v / 1e3)) + " KB/s";
}

/** "2 h 5 min", "12 min", "40 s" from milliseconds; "" for nothing usable. */
export function fmtDuration(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v <= 0) return "";
  const s = Math.round(v / 1000);
  if (s < 60) return s + " s";
  const m = Math.round(s / 60);
  if (m < 60) return m + " min";
  const h = Math.floor(m / 60);
  return h + " h" + (m % 60 ? " " + (m % 60) + " min" : "");
}

/** "13 Nov, 21:37" in the viewer's time zone; "" when there is no time. */
export function fmtClock(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v <= 0) return "";
  const d = new Date(v);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export const DOWNLOAD_LABEL = { waiting: "Waiting", downloading: "Downloading", done: "Done", failed: "Failed" };

/**
 * The TV's movie downloads for the website, newest first: how much is here, the status, when it started, the speed,
 * and for a running one the time left. `status.sync.items` is what the TV reports.
 */
export function downloadRows(status, now = Date.now()) {
  const items = status && status.sync && Array.isArray(status.sync.items) ? status.sync.items : [];
  const rank = { downloading: 0, waiting: 1, failed: 2, done: 2 };
  return items
    .filter((t) => t && typeof t.name === "string")
    .map((t) => {
      const size = Number(t.size) || 0, done = Math.min(Number(t.done) || 0, size || Infinity);
      const pct = size > 0 ? Math.min(100, Math.round((100 * done) / size)) : Number(t.pct) || 0;
      const speed = Number(t.speedBps) || 0;
      const running = t.status === "downloading";
      const left = running && speed > 0 && size > done ? ((size - done) / speed) * 1000 : 0;
      const took = t.status === "done" && t.startedAt && t.finishedAt ? t.finishedAt - t.startedAt : 0;
      return { name: t.name, status: DOWNLOAD_LABEL[t.status] ? t.status : "waiting", size, done, pct, speed, startedAt: Number(t.startedAt) || 0, finishedAt: Number(t.finishedAt) || 0, left, took, error: String(t.error || "") };
    })
    .sort((a, b) => (rank[a.status] - rank[b.status]) || ((b.finishedAt || b.startedAt) - (a.finishedAt || a.startedAt)));
}
