/* Reading a Google Contacts export (CSV or vCard .vcf) for the WhatsApp sender. Kept apart from React so it can be tested. */

/** Splits CSV text into rows of cells. Handles quoted cells, commas and line breaks inside quotes, and "" for a quote. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const src = String(text || "");
  const body = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') { if (body[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && body[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((c) => c !== "")) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

/** Mobile numbers get 91 added when they are 10 digits; anything that cannot be a mobile number is dropped. */
export function cleanPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  if (d.length === 11 && d.startsWith("0")) return "91" + d.slice(1);
  if (d.length >= 12 && d.length <= 14) return d;
  return "";
}

/**
 * People in a Google Contacts CSV: every "Phone N - Value" column counts (a cell can hold several numbers split by ":::").
 * Returns [{ name, phone }], one entry per number, without repeats.
 */
export function contactsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const first = col("first name"), middle = col("middle name"), last = col("last name"), nick = col("nickname"), org = col("organization name");
  const phoneCols = head.map((h, i) => (/^phone \d+ - value$/.test(h) ? i : -1)).filter((i) => i >= 0);
  const out = [], seen = new Set();
  for (const r of rows.slice(1)) {
    const name = [r[first], r[middle], r[last]].map((x) => (x || "").trim()).filter(Boolean).join(" ") || (r[nick] || "").trim() || (r[org] || "").trim();
    for (const c of phoneCols) {
      for (const part of String(r[c] || "").split(":::")) {
        const phone = cleanPhone(part);
        if (!phone || seen.has(phone)) continue;
        seen.add(phone);
        out.push({ name, phone });
      }
    }
  }
  return out;
}

/** Decodes a quoted-printable value ("=C3=A9" is one UTF-8 character) as old Android and Google vCard exports write names. */
function decodeQuotedPrintable(v) {
  try {
    const bytes = [];
    const s = String(v);
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
      else for (const b of new TextEncoder().encode(s[i])) bytes.push(b);
    }
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  } catch { return String(v); }
}

/** The text of a vCard value with its escapes (\n \, \; \\) undone. */
function unescapeVcf(v) {
  return String(v).replace(/\\([nN,;\\])/g, (_, c) => (c === "n" || c === "N" ? " " : c));
}

/**
 * People in a vCard (.vcf) file, as Google Contacts, Android and iPhone export it: one BEGIN:VCARD ... END:VCARD block per person,
 * folded lines joined, quoted-printable names decoded, and every TEL line counted (TEL;TYPE=CELL, item1.TEL, tel: links).
 * Returns [{ name, phone }], one entry per number, without repeats.
 */
export function contactsFromVcf(text) {
  const src = String(text || "");
  const body = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  // A line that starts with a space or tab continues the one before it; a quoted-printable line ending in "=" continues on the next line.
  const raw = body.replace(/\r\n|\r/g, "\n").split("\n");
  const lines = [];
  for (const l of raw) {
    const prev = lines.length ? lines[lines.length - 1] : null;
    if (prev !== null && /^[ \t]/.test(l)) lines[lines.length - 1] = prev + l.slice(1);
    else if (prev !== null && /ENCODING=QUOTED-PRINTABLE/i.test(prev) && prev.endsWith("=")) lines[lines.length - 1] = prev.slice(0, -1) + l;
    else lines.push(l);
  }
  const out = [], seen = new Set();
  let card = null;
  const finish = () => {
    if (!card) return;
    const name = card.fn || card.n || card.nick || card.org || "";
    for (const t of card.tels) {
      const phone = cleanPhone(t);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      out.push({ name, phone });
    }
    card = null;
  };
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const head = line.slice(0, colon), value = line.slice(colon + 1);
    const parts = head.split(";");
    const prop = parts[0].replace(/^.*\./, "").toUpperCase();     // "item1.TEL" -> "TEL"
    const params = parts.slice(1).join(";");
    if (prop === "BEGIN" && /^vcard$/i.test(value.trim())) { finish(); card = { fn: "", n: "", nick: "", org: "", tels: [] }; continue; }
    if (prop === "END") { finish(); continue; }
    if (!card) continue;
    const val = /ENCODING=QUOTED-PRINTABLE/i.test(params) ? decodeQuotedPrintable(value) : value;
    if (prop === "FN") card.fn = unescapeVcf(val).trim();
    else if (prop === "N") { const f = val.split(";").map((x) => unescapeVcf(x).trim()); card.n = [f[3], f[1], f[2], f[0], f[4]].filter(Boolean).join(" "); }   // family;given;middle;prefix;suffix -> "prefix given middle family suffix"
    else if (prop === "NICKNAME") card.nick = unescapeVcf(val).trim();
    else if (prop === "ORG") card.org = val.split(";").map((x) => unescapeVcf(x).trim()).filter(Boolean).join(" ");
    else if (prop === "TEL") for (const part of val.replace(/^tel:/i, "").split(/:::|,(?=\s*\+?\d)/)) card.tels.push(part);
  }
  finish();
  return out;
}

/** The contacts file the user picked: a vCard when it looks like one (by its first lines or its name), else a Google CSV. */
export function contactsFromFile(text, fileName = "") {
  const src = String(text || "").replace(/^\ufeff/, "");
  const isVcf = /\.(vcf|vcard)$/i.test(String(fileName)) || /^\s*BEGIN:VCARD/i.test(src);
  return isVcf ? contactsFromVcf(src) : contactsFromCsv(src);
}

/** People typed or pasted as lines: "Name, 98100 12345" or just "98100 12345". */
export function peopleFromLines(text) {
  const out = [], seen = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = /^(.*?)[,;\t ]*(\+?[\d][\d\s-]{8,})$/.exec(t);
    if (!m) continue;
    const phone = cleanPhone(m[2]);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push({ name: m[1].trim(), phone });
  }
  return out;
}
