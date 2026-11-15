import { test } from "node:test";
import assert from "node:assert/strict";
import { comingLine, peopleLine, weatherLine, tvLine, widgetSnapshot } from "../src/lib/widgetText.js";

test("coming: minutes, 'almost there', companions and at most two people", () => {
  assert.equal(comingLine([{ person: "Papa", minutes: 10 }]), "🚗 Papa 10 min mein aa rahe hain");
  assert.equal(comingLine([{ person: "Mummy", minutes: 1, with: ["Riya"] }]), "🚗 Mummy + Riya bas pahunchne wale hain");
  assert.equal(comingLine([{ person: "A", minutes: 5 }, { person: "B", minutes: 7 }, { person: "C", minutes: 9 }]), "🚗 A 5 min mein aa rahe hain · B 7 min mein aa rahe hain");
  assert.equal(comingLine([]), "");
  assert.equal(comingLine(null), "");
});

test("people: everyone home, nobody home, mixed, none", () => {
  assert.equal(peopleLine([{ person: "Mummy", home: true }, { person: "Papa", home: true }]), "🏠 Everyone is home: Mummy, Papa");
  assert.equal(peopleLine([{ person: "Tanush", home: false }]), "🏠 Nobody is home · Out: Tanush");
  assert.equal(peopleLine([{ person: "Mummy", home: true }, { person: "Tanush", home: false }]), "🏠 Home: Mummy · Out: Tanush");
  assert.equal(peopleLine(undefined), "");
});

test("weather: city short name, range, rain only when likely", () => {
  assert.equal(weatherLine({ city: "Gurugram, Haryana, India", temp: 31.4, text: "clear ☀️", min: 24, max: 33, rainChance: 10 }), "Gurugram 31°C · clear ☀️ · 24–33°C");
  assert.equal(weatherLine({ city: "", temp: 28, text: "rain 🌧️", min: 22, max: 30, rainChance: 70 }), "28°C · rain 🌧️ · 22–30°C · ☔ 70%");
  assert.equal(weatherLine(null), "");
  assert.equal(weatherLine({ city: "X" }), "");
});

test("tv: off, standby, on with app and title", () => {
  assert.equal(tvLine([{ name: "Living room", online: false }]), "📺 Living room: off");
  assert.equal(tvLine([{ name: "Living room", online: true, screen: "off" }]), "📺 Living room: standby");
  assert.equal(tvLine([{ name: "Living room", online: true, screen: "on", app: "YouTube", title: "Song" }]), "📺 Living room: on · YouTube · Song");
  assert.equal(tvLine([]), "");
});

test("snapshot never carries anything but display text and the time", () => {
  const s = widgetSnapshot({ people: [], coming: [], weather: null, tvs: [], localPeople: { aa: "x" }, config: { camera: {} } }, 123);
  assert.deepEqual(Object.keys(s).sort(), ["coming", "people", "tv", "updatedAt", "weather"]);
  assert.equal(s.updatedAt, 123);
  assert.match(s.people, /Give a Wi-Fi device a person/);
});
