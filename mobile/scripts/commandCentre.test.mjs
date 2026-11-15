import test from "node:test";
import assert from "node:assert/strict";
import { freshness, nodesOf, headline, quickActions, GREETING } from "../src/lib/commandCentre.js";

test("freshness never calls old data live", () => {
  const now = 1e6;
  assert.equal(freshness(null, now), "none");
  assert.equal(freshness(now - 10e3, now), "live");
  assert.equal(freshness(now - 100e3, now), "recent");
  assert.equal(freshness(now - 400e3, now), "stale");
});
test("nodes show real state", () => {
  const n = nodesOf([
    { id: "p", kind: "phone", name: "Papa", online: true, status: { battery: 71.4 } },
    { id: "t", kind: "tv", name: "TV", online: true, status: { screen: "off" } },
    { id: "x", kind: "other", name: "?", online: true },
    { id: "h", kind: "hub", name: "Tablet", online: false },
  ]);
  assert.deepEqual(n.map((x) => x.kind), ["tv", "hub", "phone"]);
  assert.equal(n[0].line, "Standby"); assert.equal(n[0].tone, "idle");
  assert.equal(n[1].tone, "off");
  assert.equal(n[2].line, "71% battery");
});
test("headline order", () => {
  assert.equal(headline({ error: "x" }).text, "Can't reach Stashr");
  assert.equal(headline({ bad: 2, fresh: "live" }).tone, "bad");
  assert.equal(headline({ offline: 1, fresh: "live" }).tone, "warn");
  assert.equal(headline({ fresh: "stale" }).tone, "warn");
  assert.equal(headline({ fresh: "live" }).tone, "ok");
});
test("quick actions need a linked device and an online one", () => {
  assert.deepEqual(quickActions([]), []);
  const a = quickActions([{ id: "t", kind: "tv", online: false }, { id: "h", kind: "hub", online: true, status: { agent: "stashr-hub" } }]);
  assert.deepEqual(a.map((x) => [x.key, x.disabled]), [["playpause", true], ["mute", true], ["snap", false]]);
});
test("greeting", () => { assert.equal(GREETING(8), "Good morning"); assert.equal(GREETING(23), "Good night"); });
