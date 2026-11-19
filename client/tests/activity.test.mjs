import { test } from "node:test";
import assert from "node:assert/strict";
import { isIdleAt, IDLE_MS } from "../src/lib/activity.js";

test("someone is around for the first minutes, then idle after five without a touch", () => {
  const t = 1_000_000;
  assert.equal(isIdleAt(t, t + 60_000), false);
  assert.equal(isIdleAt(t, t + IDLE_MS - 1), false);
  assert.equal(isIdleAt(t, t + IDLE_MS), true);
});
