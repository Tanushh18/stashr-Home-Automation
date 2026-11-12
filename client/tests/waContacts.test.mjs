import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, cleanPhone, contactsFromCsv, peopleFromLines } from "../src/lib/waContacts.js";

test("cleanPhone", () => {
  assert.equal(cleanPhone("98100 12345"), "919810012345");
  assert.equal(cleanPhone("+91 98100-12345"), "919810012345");
  assert.equal(cleanPhone("09810012345"), "919810012345");
  assert.equal(cleanPhone("12345"), "");
});

test("parseCsv handles quotes, commas and line breaks inside cells", () => {
  const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\n"one\ntwo",z\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'say "hi"'], ["one\ntwo", "z"]]);
});

test("contactsFromCsv reads a Google Contacts export: names, several numbers, no repeats", () => {
  const csv = [
    "First Name,Middle Name,Last Name,Nickname,Organization Name,Phone 1 - Label,Phone 1 - Value,Phone 2 - Value",
    "Ravi,,Kumar,,,Mobile,+91 98100 12345,98100 99999 ::: 98100 11111",
    ",,,,Shine Traders,Work,98100 12345,",
    "NoPhone,,,,,,,",
    "Bad,,,,,Mobile,12345,",
  ].join("\n");
  assert.deepEqual(contactsFromCsv(csv), [
    { name: "Ravi Kumar", phone: "919810012345" },
    { name: "Ravi Kumar", phone: "919810099999" },
    { name: "Ravi Kumar", phone: "919810011111" },
  ]);
});

test("contactsFromCsv with no phone columns gives nothing", () => {
  assert.deepEqual(contactsFromCsv("First Name,Last Name\nA,B"), []);
  assert.deepEqual(contactsFromCsv(""), []);
});

test("peopleFromLines", () => {
  const out = peopleFromLines("Ravi, 98100 12345\n98100 55555\n\nbad line\nRavi again, 98100 12345");
  assert.deepEqual(out, [{ name: "Ravi", phone: "919810012345" }, { name: "", phone: "919810055555" }]);
});

import { STARTER_QUOTES, textsToBox, boxToTexts } from "../src/lib/waStarter.js";

test("the 25 We Three quotes are all here, each with a contact line or the brand", () => {
  assert.equal(STARTER_QUOTES.length, 25);
  assert.equal(new Set(STARTER_QUOTES).size, 25);
  for (const q of STARTER_QUOTES) assert.ok(q.includes("9310994032") || q.includes("SHINE ONE ESTATE"));
});

test("messages with several lines survive the box", () => {
  const texts = ["Line one\nLine two", "Second message"];
  assert.deepEqual(boxToTexts(textsToBox(texts)), texts);
  assert.deepEqual(boxToTexts(""), []);
  assert.deepEqual(boxToTexts("a\n---\n\n---\nb"), ["a", "b"]);
});
