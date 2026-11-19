/**
 * Vault item model (same file in client/ and mobile/).
 * Each item is stored as one blob, encrypted on the server (AES-256-GCM, per-account key).
 */
/* Item kinds. "login" is the original kind; the others reuse name, notes, folder and favorite, and keep their own
   details in `fields` (keys come from FIELD_DEFS, anything else is dropped). */
export const ITEM_TYPES = ["login", "note", "card", "identity"];
export const TYPE_LABELS = { login: "Login", note: "Secure note", card: "Card", identity: "Identity" };
export const FIELD_DEFS = {
  card: [
    { key: "holder", label: "Cardholder" },
    { key: "number", label: "Card number", secret: true },
    { key: "expiry", label: "Expiry (MM/YY)" },
    { key: "cvv", label: "Security code", secret: true },
    { key: "pin", label: "PIN", secret: true },
  ],
  identity: [
    { key: "fullName", label: "Full name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "address", label: "Address" },
    { key: "city", label: "City" },
    { key: "postcode", label: "Postcode" },
    { key: "country", label: "Country" },
    { key: "idNumber", label: "ID / passport number", secret: true },
  ],
};

/** The item's kind; older items have no `type` and are logins. */
export const typeOf = (item) => (ITEM_TYPES.includes(item && item.type) ? item.type : "login");

/** Keeps only the fields defined for `type`, as short strings. */
export function sanitizeFields(type, raw) {
  const defs = FIELD_DEFS[type] || [];
  const out = {};
  defs.forEach(({ key }) => {
    const v = raw && raw[key];
    if (v != null && String(v).trim()) out[key] = String(v).slice(0, 500);
  });
  return out;
}

export const emptyItem = () => ({
  type: "login",
  fields: {},
  name: "",
  username: "",
  password: "",
  url: "",
  notes: "",
  totp: "",
  folder: "",
  favorite: false,
  passwordUpdatedAt: null,
  deletedAt: null, // set while the item is in the trash
  history: [], // previous passwords, newest first: [{ password, changedAt }]
});

export const HISTORY_LIMIT = 5;
export const TRASH_DAYS = 30;

const clean = (v) => (v == null ? "" : String(v).replace(/\u00a0/g, " ").trim());

export function normalizeItem(raw = {}) {
  const type = typeOf(raw);
  return {
    ...emptyItem(),
    type,
    fields: sanitizeFields(type, raw.fields),
    name: clean(raw.name).slice(0, 200),
    username: clean(raw.username).slice(0, 300),
    password: raw.password == null ? "" : String(raw.password).slice(0, 2000),
    url: clean(raw.url).slice(0, 2000),
    notes: raw.notes == null ? "" : String(raw.notes).slice(0, 20000),
    totp: clean(raw.totp).slice(0, 500),
    folder: clean(raw.folder).slice(0, 60),
    favorite: Boolean(raw.favorite),
    passwordUpdatedAt: raw.passwordUpdatedAt || null,
    deletedAt: raw.deletedAt || null,
    history: Array.isArray(raw.history)
      ? raw.history.filter((h) => h && typeof h.password === "string" && h.password).slice(0, HISTORY_LIMIT).map((h) => ({ password: h.password.slice(0, 2000), changedAt: h.changedAt || null }))
      : [],
  };
}

/** Returns `next` with the replaced password pushed onto its history when the password changed. */
export function withHistory(current, next) {
  if (!current || !current.password || current.password === next.password) return next;
  const entry = { password: current.password, changedAt: current.passwordUpdatedAt || current.updatedAt || null };
  const history = [entry, ...(next.history || []).filter((h) => h.password !== entry.password)].slice(0, HISTORY_LIMIT);
  return { ...next, history };
}

/** True for a trashed item that has been in the trash longer than `days`. */
export const trashExpired = (item, days = TRASH_DAYS, now = Date.now()) =>
  Boolean(item.deletedAt) && now - new Date(item.deletedAt).getTime() > days * 86400000;

/** Legacy server entry → item fields (after the server decrypted the password). */
export const fromLegacy = (entry, password) =>
  normalizeItem({
    name: entry.platform && entry.platform !== "NA" ? entry.platform : "Untitled",
    username: entry.platEmail && entry.platEmail !== "NA" ? entry.platEmail : "",
    password,
    passwordUpdatedAt: entry.updatedAt || entry.createdAt || null,
  });

export function domainOf(url) {
  const text = clean(url);
  if (!text) return "";
  // Regex rather than URL(): React Native's URL has no reliable hostname.
  const m = text.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?([^/:?#\s]+)/i);
  const host = m ? m[1].toLowerCase().replace(/^www\./, "") : "";
  return host.includes(".") ? host : "";
}

export const openableUrl = (url) => {
  const d = clean(url);
  if (!d) return "";
  return /^https?:\/\//i.test(d) ? d : `https://${d}`;
};

/** Website icon via DuckDuckGo's icon service (only used when the user turns icons on). */
export const faviconUrl = (url) => {
  const d = domainOf(url);
  return d ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(d)}.ico` : "";
};

/* ── CSV ── */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim()));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(items) {
  const cols = ["name", "url", "username", "password", "totp", "notes", "folder", "favorite", "type", "fields"];
  const cell = (it, c) => (c === "fields" ? (Object.keys(it.fields || {}).length ? JSON.stringify(it.fields) : "") : c === "type" ? typeOf(it) : it[c]);
  return [cols.join(","), ...items.map((it) => cols.map((c) => csvCell(cell(it, c))).join(","))].join("\n");
}

const parseFields = (text) => {
  try { const v = text ? JSON.parse(text) : null; return v && typeof v === "object" ? v : {}; } catch (e) { return {}; }
};

const pick = (row, keys) => {
  for (const k of keys) {
    const hit = Object.keys(row).find((h) => h.trim().toLowerCase() === k);
    if (hit && clean(row[hit])) return row[hit];
  }
  return "";
};

/**
 * Maps spreadsheet / CSV rows from Stashr, Chrome, Bitwarden, 1Password and
 * LastPass exports (plus the old platform/email/password sheet) to items.
 */
export const rowsToItems = (rows) =>
  rows
    .map((row) =>
      normalizeItem({
        name: pick(row, ["name", "title", "platform", "site", "account"]) || domainOf(pick(row, ["url", "login_uri", "website", "origin"])),
        username: pick(row, ["username", "login_username", "user", "email", "platemail", "login"]),
        password: pick(row, ["password", "login_password", "userpass", "pass"]),
        url: pick(row, ["url", "login_uri", "website", "origin", "web site"]),
        notes: pick(row, ["notes", "note", "extra", "comments"]),
        totp: pick(row, ["totp", "login_totp", "otpauth", "one-time password", "otp"]),
        folder: pick(row, ["folder", "grouping", "group", "category", "vault"]),
        favorite: /^(1|true|yes)$/i.test(pick(row, ["favorite", "fav", "starred"])),
        type: pick(row, ["type"]).toLowerCase() === "securenote" ? "note" : pick(row, ["type"]).toLowerCase(),
        fields: parseFields(pick(row, ["fields"])),
      })
    )
    .filter((it) => it.name || it.password);

/** What makes two vault items "the same" for an import: type, name, username, website and password, ignoring case and a trailing slash. */
export function importKey(item) {
  const n = (v) => String(v == null ? "" : v).trim().toLowerCase().replace(/\/+$/, "");
  return [n(item.type), n(item.name), n(item.username), n(item.url), String(item.password == null ? "" : item.password)].join("\u0001");
}

/**
 * Splits what a file would import into the new items and the ones that are already in the vault (or repeat inside the file), so
 * importing the same file twice, or one from Chrome and one from Bitwarden, does not double everything.
 * -> { fresh: [...], duplicates: n }
 */
export function splitDuplicates(incoming, existing) {
  const seen = new Set((existing || []).map(importKey));
  const fresh = [];
  let duplicates = 0;
  for (const item of incoming || []) {
    const k = importKey(item);
    if (seen.has(k)) { duplicates++; continue; }
    seen.add(k);
    fresh.push(item);
  }
  return { fresh, duplicates };
}
