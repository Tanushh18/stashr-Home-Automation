import test from "node:test";
import assert from "node:assert/strict";
import { buildEntries, rank } from "../src/lib/palette.js";

const items = [{ name: "GitHub", username: "me@x.com", url: "github.com" }, { name: "Gmail", username: "me@x.com" }];

test("signed-out users get no entries", () => {
  assert.deepEqual(buildEntries({ items, signedIn: false }), []);
});

test("admin-only pages need isAdmin", () => {
  const plain = buildEntries({ profile: { features: {} } }).map((e) => e.label);
  assert.ok(!plain.includes("Servers"));
  const admin = buildEntries({ profile: { isAdmin: true, features: {} } }).map((e) => e.label);
  assert.ok(admin.includes("Servers"));
});

test("rank prefers label prefixes and requires every word", () => {
  const entries = buildEntries({ items, profile: {} });
  assert.equal(rank(entries, "git")[0].label, "GitHub");
  assert.deepEqual(rank(entries, "gmail zzz"), []);
  assert.ok(rank(entries, "").every((e) => e.kind === "Page" || e.kind === "Action"));
});

test("actions only point at routes the app already handles", () => {
  const actions = buildEntries({ profile: {} }).filter((e) => e.kind === "Action");
  assert.ok(actions.length >= 3);
  for (const a of actions) assert.match(a.to, /^\/(passwords\?(new|import)=1|projects\/new|generator)$/);
});
