import { test } from "node:test";
import assert from "node:assert/strict";
import { lockWhy, lockLink, lockPlan, lockState, remoteLockLine } from "../src/lib/lockText.js";

const ID = "64b7f1c2a9d3e4f5a6b7c8d9";

test("every reason the phone can give has plain words, and an unknown one still reads sensibly", () => {
  assert.match(lockWhy("admin_off"), /switched off/);
  assert.match(lockWhy("stale"), /too late/);
  assert.match(lockWhy("not_linked"), /not linked/);
  assert.match(lockWhy("lock_failed"), /refused/);
  assert.equal(lockWhy("???"), "unknown reason");
  assert.equal(lockWhy(undefined), "unknown reason");
});

test("the link carries the device id and this install's key, encoded", () => {
  assert.equal(lockLink(ID, "abc123"), `stashr://action?do=lock&id=${ID}&k=abc123`);
  assert.equal(lockLink(ID, "a b&c"), `stashr://action?do=lock&id=${ID}&k=a%20b%26c`);
});

test("only a 24-character device id from a lock link makes a plan", () => {
  assert.deepEqual(lockPlan({ do: "lock", id: ID }), { id: ID });
  assert.equal(lockPlan({ do: "lock", id: "123" }), null);
  assert.equal(lockPlan({ do: "lock", id: ID.toUpperCase() }), null);
  assert.equal(lockPlan({ do: "lock", id: `${ID}\n` }), null);
  assert.equal(lockPlan({ do: "scene", id: ID }), null);
  assert.equal(lockPlan({ do: "lock", id: ["x"] }), null);
  assert.equal(lockPlan(null), null);
});

test("lock state: Remote lock on, off or not known, and the last request in words", () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(lockState({ remoteLock: true }, now), { remote: "on", last: null });
  assert.equal(lockState({ remoteLock: false }, now).remote, "off");
  assert.equal(lockState({}, now).remote, "unknown");
  assert.equal(lockState(undefined, now).remote, "unknown");
  const ok = lockState({ remoteLock: true, lastLock: { at: now - 3 * 60000, ok: true, reason: "ok" } }, now);
  assert.deepEqual(ok.last, { at: now - 180000, ok: true, why: "", ageMin: 3 });
  const bad = lockState({ remoteLock: false, lastLock: { at: now - 60000, ok: false, reason: "admin_off" } }, now);
  assert.equal(bad.last.ok, false);
  assert.match(bad.last.why, /switched off/);
  assert.equal(lockState({ lastLock: { ok: true } }, now).last, null);
});

test("the line under the phone's name never claims more than is known", () => {
  assert.equal(remoteLockLine({ remote: "on" }), "Remote lock is on");
  assert.match(remoteLockLine({ remote: "off" }), /not switched on/);
  assert.match(remoteLockLine({ remote: "off" }), /Remote lock → Allow/);        // tells where to switch it on
  assert.match(remoteLockLine({ remote: "unknown" }), /not reported yet/);
});
