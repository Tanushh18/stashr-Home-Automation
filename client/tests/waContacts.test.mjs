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
