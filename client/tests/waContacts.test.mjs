import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, cleanPhone, contactsFromCsv, contactsFromVcf, contactsFromFile, filterContacts, peopleFromRows, splitPeople, planSheets, peopleFromLines } from "../src/lib/waContacts.js";

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

test("contactsFromVcf reads a vCard export: folded lines, several numbers, tel: links, no repeats", () => {
  const vcf = [
    "BEGIN:VCARD", "VERSION:3.0", "FN:Ravi Kumar", "N:Kumar;Ravi;;;",
    "TEL;TYPE=CELL:+91 98100 12345", "item1.TEL;type=pref:098111 22233", "END:VCARD",
    "BEGIN:VCARD", "VERSION:2.1", "N;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:=C3=89lise;Anne;;;", "TEL;CELL:tel:+919810012345", "END:VCARD",
    "BEGIN:VCARD", "VERSION:3.0", "FN:Long Na", " me Folded", "TEL;TYPE=CELL:98765 43210", "END:VCARD",
    "BEGIN:VCARD", "VERSION:3.0", "ORG:Shine Traders\\, Delhi;", "TEL:99887 76655", "END:VCARD",
    "BEGIN:VCARD", "VERSION:3.0", "FN:No Phone", "END:VCARD",
    "BEGIN:VCARD", "VERSION:3.0", "FN:Bad", "TEL:12345", "END:VCARD",
  ].join("\r\n");
  // Anne's number is Ravi's again (tel: link, same digits), so it is listed once.
  assert.deepEqual(contactsFromVcf(vcf), [
    { name: "Ravi Kumar", phone: "919810012345" },
    { name: "Ravi Kumar", phone: "919811122233" },
    { name: "Long Name Folded", phone: "919876543210" },
    { name: "Shine Traders, Delhi", phone: "919988776655" },
  ]);
});

test("contactsFromVcf decodes a quoted-printable name and joins its soft line breaks", () => {
  const vcf = "BEGIN:VCARD\nVERSION:2.1\nN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:=C3=89lise;Anne;;;\nFN;ENCODING=QUOTED-PRINTABLE:=C3=89lise =\nAnne\nTEL;CELL:98100 12345\nEND:VCARD\n";
  assert.deepEqual(contactsFromVcf(vcf), [{ name: "\u00c9lise Anne", phone: "919810012345" }]);
  assert.equal(contactsFromVcf("BEGIN:VCARD\nN;ENCODING=QUOTED-PRINTABLE:=C3=89lise;Anne;;;\nTEL:98100 12345\nEND:VCARD")[0].name, "Anne \u00c9lise");
});

test("contactsFromFile picks vCard or CSV by the file name or the first line", () => {
  const card = "BEGIN:VCARD\nFN:A\nTEL:98100 12345\nEND:VCARD";
  const csv = "First Name,Phone 1 - Value\nA,98100 12345\n";
  assert.equal(contactsFromFile(card, "contacts.vcf").length, 1);
  assert.equal(contactsFromFile(card, "contacts.txt").length, 1);
  assert.equal(contactsFromFile("\ufeff" + card, "").length, 1);
  assert.equal(contactsFromFile(csv, "contacts.csv").length, 1);
  assert.deepEqual(contactsFromFile("", "x.vcf"), []);
});

test("filterContacts searches by name or number", () => {
  const rows = [{ name: "Ravi Kumar", phone: "919810012345" }, { name: "Anne Élise", phone: "919876543210" }, { name: "", phone: "919988776655" }];
  assert.equal(filterContacts(rows, "").length, 3);
  assert.deepEqual(filterContacts(rows, "RAVI").map((r) => r.name), ["Ravi Kumar"]);
  assert.deepEqual(filterContacts(rows, "élise").map((r) => r.name), ["Anne Élise"]);
  assert.deepEqual(filterContacts(rows, "98100 12").map((r) => r.phone), ["919810012345"]);
  assert.deepEqual(filterContacts(rows, "+91 99887").map((r) => r.phone), ["919988776655"]);
  assert.equal(filterContacts(rows, "zzz").length, 0);
  assert.equal(filterContacts(rows, "9").length, 0);        // a single digit is too little to match numbers by
});

test("peopleFromRows finds the name and number columns by their heading, several numbers, no repeats", () => {
  const rows = [["Sr", "Customer Name", "Mobile No", "Alternate Mobile"], [1, "Ravi Kumar", 9810012345, "98111 22233"], [2, "Anne", "+91 98100 12345", ""], [3, "Bad", "123", ""]];
  assert.deepEqual(peopleFromRows(rows), [
    { name: "Ravi Kumar", phone: "919810012345" },
    { name: "Ravi Kumar", phone: "919811122233" },
  ]);
});

test("peopleFromRows without a heading uses the column that holds the most numbers", () => {
  const rows = [["Ravi", "98100 12345", "Delhi"], ["Anne", "98765 43210", "Pune"], ["Skip", "", "x"]];
  assert.deepEqual(peopleFromRows(rows), [{ name: "Ravi", phone: "919810012345" }, { name: "Anne", phone: "919876543210" }]);
  assert.deepEqual(peopleFromRows([]), []);
  assert.deepEqual(peopleFromRows([["a", "b"], ["c", "d"]]), []);
});

test("splitPeople cuts a list into even parts in order", () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ phone: String(i) }));
  assert.deepEqual(splitPeople(list, 3).map((g) => g.length), [4, 3, 3]);
  assert.deepEqual(splitPeople(list, 1).length, 1);
  assert.deepEqual(splitPeople(list, 99).length, 10);            // never more parts than people
  assert.deepEqual(splitPeople([], 3), [[]]);
  assert.equal(splitPeople(list, 3)[0][0].phone, "0");
});

test("planSheets names the sheets, numbers the split ones and flags names that are empty or used", () => {
  const p = (n) => Array.from({ length: n }, (_, i) => ({ name: "", phone: "9198100000" + i }));
  const tabs = [
    { tab: "Delhi", include: true, name: "Delhi leads", parts: 2, people: p(5) },
    { tab: "Pune", include: true, name: "Pune", parts: 1, people: p(2) },
    { tab: "Skipped", include: false, name: "Skipped", parts: 1, people: p(2) },
    { tab: "Empty", include: true, name: "Empty", parts: 1, people: [] },
    { tab: "Dup", include: true, name: "pune", parts: 1, people: p(1) },
    { tab: "Old", include: true, name: "Calling data", parts: 1, people: p(1) },
    { tab: "Blank", include: true, name: "  ", parts: 1, people: p(1) },
  ];
  const plan = planSheets(tabs, new Set(["calling data"]));
  assert.deepEqual(plan.map((s) => [s.name, s.people.length, s.clash]), [
    ["Delhi leads 1", 3, false], ["Delhi leads 2", 2, false], ["Pune", 2, false], ["pune", 1, true], ["Calling data", 1, true], ["", 1, true],
  ]);
});
