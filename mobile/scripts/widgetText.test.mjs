import { test } from "node:test";
import assert from "node:assert/strict";
import { comingLine, peopleLine, weatherLine, tvLine, widgetSnapshot } from "../src/lib/widgetText.js";

test("coming: minutes, 'almost there', companions and at most two people", () => {
  assert.equal(comingLine([{ person: "Papa", minutes: 10 }]), "Papa · 10 min");
  assert.equal(comingLine([{ person: "Mummy", minutes: 1, with: ["Riya"] }]), "Mummy + Riya · arriving");
  assert.equal(comingLine([{ person: "A", minutes: 5 }, { person: "B", minutes: 7 }, { person: "C", minutes: 9 }]), "A · 5 min  B · 7 min");
  assert.equal(comingLine([]), "");
  assert.equal(comingLine(null), "");
});

test("people: everyone home, nobody home, mixed, none", () => {
  assert.equal(peopleLine([{ person: "Mummy", home: true }, { person: "Papa", home: true }]), "All in · Mummy, Papa");
  assert.equal(peopleLine([{ person: "Tanush", home: false }]), "Nobody · out: Tanush");
  assert.equal(peopleLine([{ person: "Mummy", home: true }, { person: "Tanush", home: false }]), "Mummy · out: Tanush");
  assert.equal(peopleLine(undefined), "");
});

test("weather: city short name, range, rain only when likely", () => {
  assert.equal(weatherLine({ city: "Gurugram, Haryana, India", temp: 31.4, text: "clear ☀️", min: 24, max: 33, rainChance: 10 }), "Gurugram 31°C · clear ☀️ · 24–33°C");
  assert.equal(weatherLine({ city: "", temp: 28, text: "rain 🌧️", min: 22, max: 30, rainChance: 70 }), "28°C · rain 🌧️ · 22–30°C · ☔ 70%");
  assert.equal(weatherLine(null), "");
  assert.equal(weatherLine({ city: "X" }), "");
});

test("tv: off, standby, on with app and title", () => {
  assert.equal(tvLine([{ name: "Living room", online: false }]), "Living room · off");
  assert.equal(tvLine([{ name: "Living room", online: true, screen: "off" }]), "Living room · standby");
  assert.equal(tvLine([{ name: "Living room", online: true, screen: "on", app: "YouTube", title: "Song" }]), "Living room · on · YouTube · Song");
  assert.equal(tvLine([]), "");
});

test("snapshot never carries anything but display text and the time", () => {
  const s = widgetSnapshot({ people: [], coming: [], weather: null, tvs: [], localPeople: { aa: "x" }, config: { camera: {} } }, 123);
  assert.deepEqual(Object.keys(s).sort(), ["coming", "people", "tv", "updatedAt", "weather"]);
  assert.equal(s.updatedAt, 123);
  assert.match(s.people, /Give a Wi-Fi device a person/);
});

import { scenesOf, inr, moneyLines, netLines } from "../src/lib/widgetText.js";

test("scenes: at most four, only real ids and names", () => {
  const s = scenesOf({ scenes: [{ id: "a", name: "Movie night" }, { id: "", name: "x" }, { id: "b", name: "Quiet" }, { id: "c", name: "Good night" }, { id: "d", name: "D" }, { id: "e", name: "E" }] });
  assert.deepEqual(s.map((x) => x.id), ["a", "b", "c", "d"]);
  assert.deepEqual(scenesOf(null), []);
});

test("inr: Indian grouping and rounding", () => {
  assert.equal(inr(0), "₹0");
  assert.equal(inr(999), "₹999");
  assert.equal(inr(1240.4), "₹1,240");
  assert.equal(inr(1234567.8), "₹12,34,568");
  assert.equal(inr(-50), "-₹50");
});

test("money: today's debits only, doubtful ones left out, month total, top category, items to check", () => {
  const list = {
    rows: [
      { date: "2026-11-15", type: "Debit", amount: 200, status: "Verified" },
      { date: "2026-11-15", type: "Debit", amount: 50, status: "Flagged" },
      { date: "2026-11-15", type: "Credit", amount: 900, status: "Verified" },
      { date: "2026-11-14", type: "Debit", amount: 70, status: "Verified" }
    ],
    totals: { debit: 18560, flagged: 1, byCategory: [{ category: "Food", amount: 6200 }] },
    uncategorized: 2
  };
  assert.deepEqual(moneyLines(list, "2026-11-15"), { today: "₹200", month: "₹18,560", top: "Food · ₹6,200", check: "3 to check" });
  assert.equal(moneyLines(null, "2026-11-15"), null);
  assert.equal(moneyLines({ rows: [], totals: { debit: 0, flagged: 0, byCategory: [] }, uncategorized: 0 }, "x").check, "All sorted");
});

test("network: speed, live Wi-Fi devices only, health wording", () => {
  const n = netLines({ speed: { down: 92.4, up: 40.2, ping: 12 } }, [{ stale: false }, { stale: true }, { stale: false }], { bad: 0, warn: 0 });
  assert.deepEqual(n, { speed: "92↓ 40↑ · 12 ms", wifi: "2 devices on Wi-Fi", health: "All green" });
  assert.equal(netLines({}, null, { bad: 2 }).health, "2 need fixing");
  assert.equal(netLines({}, null, { warn: 1 }).health, "1 to check");
  assert.equal(netLines({}, null, {}).speed, "No speed test yet");
});
