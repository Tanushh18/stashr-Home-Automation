import { test } from "node:test";
import assert from "node:assert/strict";
import { smsInfo, maxParts } from "../src/lib/smsText.js";

test("plain text: 160 characters in one SMS, 153 per part after that", () => {
  assert.deepEqual(smsInfo("a".repeat(160)), { encoding: "GSM", chars: 160, parts: 1, perPart: 160 });
  assert.equal(smsInfo("a".repeat(161)).parts, 2);
  assert.equal(smsInfo("a".repeat(306)).parts, 2);
  assert.equal(smsInfo("a".repeat(307)).parts, 3);
  assert.equal(smsInfo("").parts, 0);
});

test("€ and brackets cost two characters; {name} counts as ten", () => {
  assert.equal(smsInfo("€").chars, 2);
  assert.equal(smsInfo("Hi {name}").chars, 13);
});

test("one emoji or Hindi letter makes the whole message Unicode: 70 per SMS, 67 per part", () => {
  assert.equal(smsInfo("Hi 🏠").encoding, "Unicode");
  assert.equal(smsInfo("नमस्ते").encoding, "Unicode");
  assert.equal(smsInfo("₹1,000").encoding, "Unicode");
  assert.equal(smsInfo("a".repeat(69) + "🏠").parts, 2);       // the emoji is two units: 71
  assert.equal(smsInfo("a".repeat(68) + "🏠").parts, 1);
});

test("maxParts is the longest message", () => {
  assert.equal(maxParts(["short", "a".repeat(200)]), 2);
  assert.equal(maxParts([]), 0);
});
