import { test } from "node:test";
import assert from "node:assert/strict";
import { stateOf, fmtBytes, ago, nowPlaying, signalWord, groupByRoom, lanName, parseCoords, batteryOf, fmtSpeed, fmtDuration, downloadRows } from "../src/lib/smartHome.js";

test("a TV is off, in standby or on", () => {
  assert.equal(stateOf({ kind: "tv", online: false }), "off");
  assert.equal(stateOf({ kind: "tv", online: true, status: { screen: "off" } }), "standby");
  assert.equal(stateOf({ kind: "tv", online: true, status: { screen: "on" } }), "on");
  assert.equal(stateOf({ kind: "hub", online: true, status: {} }), "idle");
  assert.equal(stateOf(null), "off");
});

test("sizes and times read naturally", () => {
  assert.equal(fmtBytes(10_722_902_016), "11 GB");
  assert.equal(fmtBytes(3_000_000), "3 MB");
  assert.equal(fmtBytes(0), "0 MB");
  assert.equal(fmtBytes(1_500_000_000), "1.5 GB");
  const now = Date.UTC(2026, 10, 2, 12);
  assert.equal(ago(null, now), "never");
  assert.equal(ago(now - 10_000, now), "just now");
  assert.equal(ago(now - 5 * 60_000, now), "5 min ago");
  assert.equal(ago(now - 3 * 3600_000, now), "3 h ago");
  assert.equal(ago(now - 2 * 86400_000, now), "2 d ago");
});

test("what is playing", () => {
  assert.equal(nowPlaying({ media: { title: "Dark", state: "playing" }, app: { label: "Netflix" } }), "Playing: Dark");
  assert.equal(nowPlaying({ media: { title: "Song", artist: "A", state: "paused" } }), "Paused: Song · A");
  assert.equal(nowPlaying({ app: { label: "YouTube" } }), "YouTube");
  assert.equal(nowPlaying({}), "Home screen");
});

test("signal words", () => {
  assert.equal(signalWord(-50), "Excellent");
  assert.equal(signalWord(-60), "Good");
  assert.equal(signalWord(-70), "Fair");
  assert.equal(signalWord(-85), "Weak");
  assert.equal(signalWord(undefined), "");
});

test("devices group by room, with the unplaced ones last", () => {
  const groups = groupByRoom([{ room: "Kitchen", ip: "1" }, { ip: "2" }, { room: "Bedroom", ip: "3" }, { room: " Kitchen ", ip: "4" }]);
  assert.deepEqual(groups.map(([r]) => r), ["Bedroom", "Kitchen", "No room"]);
  assert.equal(groups[1][1].length, 2);
  assert.equal(lanName({ label: "Mom's phone", name: "pixel" }), "Mom's phone");
  assert.equal(lanName({ ip: "192.168.1.9" }), "192.168.1.9");
  assert.equal(lanName({}), "Unknown device");
});

import { splitStale, fmtMinutes, niceMax, daysLabel, stepLabel, STEP_CHOICES } from "../src/lib/smartHome.js";

test("old Wi-Fi rows fold away", () => {
  const { fresh, old } = splitStale([{ key: "a", stale: false }, { key: "b", stale: true }]);
  assert.deepEqual(fresh.map((d) => d.key), ["a"]);
  assert.deepEqual(old.map((d) => d.key), ["b"]);
});

test("minutes, axis tops and schedule days read naturally", () => {
  assert.equal(fmtMinutes(95), "1 h 35 min");
  assert.equal(fmtMinutes(120), "2 h");
  assert.equal(fmtMinutes(7.4), "7 min");
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(87), 100);
  assert.equal(niceMax(130), 200);
  assert.equal(niceMax(420), 500);
  assert.equal(niceMax(210), 250);
  assert.equal(daysLabel([]), "Every day");
  assert.equal(daysLabel([1, 2, 3, 4, 5]), "Weekdays");
  assert.equal(daysLabel([6, 0]), "Weekends");
  assert.equal(daysLabel([1, 3]), "Mon, Wed");
});

test("every step a person can pick has words", () => {
  for (const c of STEP_CHOICES) assert.ok(stepLabel(c.step) && !stepLabel(c.step).includes("_"), c.label);
  assert.equal(stepLabel({ type: "launch_app", args: { package: "com.netflix.ninja" } }), "Open Netflix");
  assert.equal(stepLabel({ type: "play_music", args: { query: "arijit" } }), "Play “arijit” on the tablet");
});

test("coordinates are read from text and map links", () => {
  assert.deepEqual(parseCoords("28.6139, 77.2090"), { lat: 28.6139, lon: 77.209 });
  assert.deepEqual(parseCoords("28.6139 77.2090"), { lat: 28.6139, lon: 77.209 });
  assert.deepEqual(parseCoords("33.9 S, 18.4 E"), { lat: -33.9, lon: 18.4 });
  assert.deepEqual(parseCoords("https://www.google.com/maps/place/Home/@28.6139,77.2090,17z/data=!3m1"), { lat: 28.6139, lon: 77.209 });
  assert.deepEqual(parseCoords("https://www.google.com/maps/place/X/data=!3d28.6139!4d77.2090"), { lat: 28.6139, lon: 77.209 });
  assert.deepEqual(parseCoords("https://maps.google.com/?q=28.6139,77.2090"), { lat: 28.6139, lon: 77.209 });
  assert.deepEqual(parseCoords("https://www.openstreetmap.org/?mlat=28.6139&mlon=77.2090#map=17/28.6139/77.2090"), { lat: 28.6139, lon: 77.209 });
  assert.equal(parseCoords("hello"), null);
  assert.equal(parseCoords("123, 200"), null);
});

test("battery is read from both shapes a phone can report", () => {
  assert.deepEqual(batteryOf({ battery: 80, charging: true }), { pct: 80, charging: true });
  assert.deepEqual(batteryOf({ battery: { pct: 55.4, charging: false } }), { pct: 55, charging: false });
  assert.equal(batteryOf({ battery: { charging: true } }), null);
  assert.equal(batteryOf({}), null);
  assert.equal(batteryOf(null), null);
});

import { healthItems, healthReport, vendorTip } from "../src/lib/smartHome.js";
test("health checklist: green, red with a fix, and unknown for an old app", () => {
  const now = Date.now();
  const tv = { name: "TV", kind: "tv", online: true, lastSeen: new Date(now).toISOString(), status: { health: { overlay: false, accessibility: true, usbStorage: true, appVersion: "1.3.0" } } };
  const items = healthItems(tv, now);
  assert.equal(items.find((i) => i.id === "overlay").state, "bad");
  assert.match(items.find((i) => i.id === "overlay").fix, /Display over other apps/);
  assert.equal(items.find((i) => i.id === "accessibility").state, "ok");
  const phone = { name: "Papa", kind: "phone", online: true, lastSeen: new Date(now).toISOString(), status: { agent: "stashr-where", health: { location: "whileInUse", gpsEnabled: true, lastError: { at: now - 1000, where: "worker", text: "boom" } } } };
  const p = healthItems(phone, now);
  assert.equal(p.find((i) => i.id === "location").state, "bad");
  assert.equal(p.find((i) => i.id === "lastError").fix, "boom");
  const old = healthItems({ name: "Hub", kind: "hub", online: true, lastSeen: new Date(now).toISOString(), status: {} }, now);
  assert.equal(old.find((i) => i.id === "health").state, "unknown");
  assert.match(healthReport([tv, phone], now), /\[BAD\] Can show messages over a playing video/);
});

test("phone health: location age, wake-up push, app version and the maker's own battery steps", () => {
  const now = Date.now();
  const base = { name: "Mukta", kind: "phone", online: true, lastSeen: new Date(now).toISOString() };
  const stale = { ...base, push: { on: true, misses: 4 }, status: { agent: "stashr-where", location: { at: now - 855 * 60000 }, health: { location: "always", gpsEnabled: true, batteryUnrestricted: false, appVersion: "1.5.0", brand: "OPPO", model: "CPH2557" } } };
  const i = healthItems(stale, now);
  assert.equal(i.find((x) => x.id === "fix").state, "bad");
  assert.match(i.find((x) => x.id === "fix").label, /14 h ago|855|14/);
  assert.equal(i.find((x) => x.id === "push").state, "ok");
  assert.equal(i.find((x) => x.id === "pushMiss").state, "warn");
  assert.equal(i.find((x) => x.id === "version").state, "warn");
  assert.match(i.find((x) => x.id === "batteryUnrestricted").fix, /Oppo\/Realme\/OnePlus.*auto launch/);
  const fresh = healthItems({ ...base, push: { on: false, misses: 0 }, status: { agent: "stashr-where", location: { at: now - 2 * 60000 }, health: { location: "always", gpsEnabled: true, appVersion: "1.6.0" } } }, now);
  assert.equal(fresh.find((x) => x.id === "fix").state, "ok");
  assert.equal(fresh.find((x) => x.id === "push").state, "warn");
  assert.equal(fresh.find((x) => x.id === "version"), undefined);
  assert.match(vendorTip({ model: "SM-X710" }), /Samsung/);
  assert.match(vendorTip({ brand: "Xiaomi" }), /Autostart/);
  assert.match(vendorTip({}), /Unrestricted/);
});

test("fmtSpeed and fmtDuration", () => {
  assert.equal(fmtSpeed(4_200_000), "4.2 MB/s");
  assert.equal(fmtSpeed(380_000), "380 KB/s");
  assert.equal(fmtSpeed(0), "");
  assert.equal(fmtDuration(40_000), "40 s");
  assert.equal(fmtDuration(12 * 60_000), "12 min");
  assert.equal(fmtDuration(125 * 60_000), "2 h 5 min");
  assert.equal(fmtDuration(0), "");
});

test("downloadRows lists the TV's downloads: running first, with percent, speed and time left", () => {
  const status = { sync: { items: [
    { name: "old.mkv", size: 1000, status: "done", done: 1000, startedAt: 1000, finishedAt: 11_000, speedBps: 100 },
    { name: "now.mkv", size: 1000, status: "downloading", done: 250, startedAt: 5000, speedBps: 50 },
    { name: "next.mkv", size: 500, status: "waiting" },
    { name: "bad.mkv", size: 500, status: "failed", done: 100, error: "Network is unreachable", finishedAt: 20_000, startedAt: 15_000 },
  ] } };
  const rows = downloadRows(status);
  assert.deepEqual(rows.map((r) => r.name), ["now.mkv", "next.mkv", "bad.mkv", "old.mkv"]);
  assert.equal(rows[0].pct, 25);
  assert.equal(rows[0].left, 15_000);            // 750 bytes at 50 B/s
  assert.equal(rows[3].took, 10_000);
  assert.equal(rows[2].error, "Network is unreachable");
  assert.deepEqual(downloadRows({}), []);
});
