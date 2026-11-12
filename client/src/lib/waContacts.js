/* Reading a Google Contacts export (CSV) for the WhatsApp sender. Kept apart from React so it can be tested. */

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
