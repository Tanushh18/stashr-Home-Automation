/*
 * Turns GET /home/dashboard into the few short lines the "Stashr Home" home-screen widget shows.
 * Pure (no React Native), so it is tested with node:test (scripts/widgetText.test.mjs).
 */

const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

/** "Papa · 10 min" (the board's ETA row); "Papa · arriving" when a minute or less away. */
export function comingLine(list) {
  const rows = (Array.isArray(list) ? list : []).filter((c) => c && clean(c.person));
  if (!rows.length) return "";
  return rows.slice(0, 2).map((c) => {
    const who = [clean(c.person), ...(Array.isArray(c.with) ? c.with.map(clean).filter(Boolean) : [])].join(" + ");
    const m = Number(c.minutes);
    return !Number.isFinite(m) || m <= 1 ? `${who} · arriving` : `${who} · ${Math.round(m)} min`;
  }).join("  ");
}

/** "Mummy, Papa · out: Tanush" (the board's HOME row). */
export function peopleLine(people) {
  const rows = (Array.isArray(people) ? people : []).filter((p) => p && clean(p.person));
  if (!rows.length) return "";
  const home = rows.filter((p) => p.home).map((p) => clean(p.person));
  const out = rows.filter((p) => !p.home).map((p) => clean(p.person));
  if (!out.length) return `All in · ${home.join(", ")}`;
  if (!home.length) return `Nobody · out: ${out.join(", ")}`;
  return `${home.join(", ")} · out: ${out.join(", ")}`;
}

/** "Gurugram 31°C · clear ☀️ · 24–33°C · ☔ 60%" (rain only when it is likely). */
export function weatherLine(w) {
  if (!w || !Number.isFinite(Number(w.temp))) return "";
  const city = clean(w.city).split(",")[0];
  const parts = [`${city ? city + " " : ""}${Math.round(Number(w.temp))}°C`];
  if (clean(w.text)) parts.push(clean(w.text));
  if (Number.isFinite(Number(w.min)) && Number.isFinite(Number(w.max))) parts.push(`${Math.round(Number(w.min))}–${Math.round(Number(w.max))}°C`);
  if (Number(w.rainChance) >= 40) parts.push(`☔ ${Math.round(Number(w.rainChance))}%`);
  return parts.join(" · ");
}

/** "Living room · on · YouTube" for the first TV (the board's TV row). */
export function tvLine(tvs) {
  const t = (Array.isArray(tvs) ? tvs : [])[0];
  if (!t) return "";
  const name = clean(t.name) || "TV";
  const state = !t.online ? "off" : t.screen === "off" ? "standby" : ["on", clean(t.app), clean(t.title)].filter(Boolean).join(" · ");
  return `${name} · ${state}`;
}

/** The whole snapshot the widget stores. `now` is when it was made. */
export function widgetSnapshot(d, now = Date.now()) {
  const dash = d || {};
  return {
    coming: comingLine(dash.coming),
    people: peopleLine(dash.people) || "Give a Wi-Fi device a person in Smart home",
    weather: weatherLine(dash.weather),
    tv: tvLine(dash.tvs),
    updatedAt: now
  };
}

/* ───────── the other home-screen widgets (Scenes, TV remote, Money, Network) ───────── */

/** The family phones for the Phones widget: [{ id, line, canLock }], at most three. "Tanush A38 · 87%⚡ · online". */
export function phonesOf(dash) {
  const out = [];
  for (const p of Array.isArray(dash && dash.phones) ? dash.phones : []) {
    const id = clean(p && p.id), name = clean(p && p.name);
    if (!id || !name || out.length >= 3) continue;
    const parts = [name.slice(0, 16)];
    if (p.battery != null && Number.isFinite(Number(p.battery))) parts.push(`${Math.round(Number(p.battery))}%${p.charging ? "⚡" : ""}`);
    parts.push(p.online ? "online" : "offline");
    out.push({ id, line: parts.join(" · "), canLock: p.canLock === true });
  }
  return out;
}

/** Up to four scenes for the Scenes widget: [{ id, name }]. */
export function scenesOf(dash) {
  return (Array.isArray(dash && dash.scenes) ? dash.scenes : [])
    .filter((s) => s && clean(s.id) && clean(s.name))
    .slice(0, 4)
    .map((s) => ({ id: clean(s.id).slice(0, 60), name: clean(s.name).slice(0, 24) }));
}

/** Indian grouping without Intl: 1234567.8 -> "₹12,34,568". */
export function inr(n) {
  const v = Math.round(Math.abs(Number(n) || 0));
  const s = String(v);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${Number(n) < 0 ? "-" : ""}₹${rest ? rest + "," : ""}${last3}`;
}

// Same as the server (server/utils/expenses.js): these are not counted until they are confirmed.
const DOUBTFUL = ["Flagged", "Not in statement", "Mismatch"];

/**
 * The Money widget from GET /expenses (this month): spent today, spent this month, the biggest category and how many entries
 * still need a look. `today` is "YYYY-MM-DD" in India time. Returns null when there is nothing to show.
 */
export function moneyLines(list, today) {
  if (!list || !list.totals) return null;
  const rows = Array.isArray(list.rows) ? list.rows : [];
  const spentToday = rows
    .filter((t) => t && t.date === today && t.type === "Debit" && !DOUBTFUL.includes(t.status))
    .reduce((a, t) => a + (Number(t.amount) || 0), 0);
  const top = (list.totals.byCategory || [])[0];
  const check = (Number(list.totals.flagged) || 0) + (Number(list.uncategorized) || 0);
  return {
    today: inr(spentToday),
    month: inr(list.totals.debit),
    top: top ? `${clean(top.category)} · ${inr(top.amount)}` : "",
    check: check ? `${check} to check` : "All sorted",
  };
}

/** The Network widget: last speed test, Wi-Fi devices seen now, and the health of the Stashr devices. */
export function netLines(dash, lan, health) {
  const sp = dash && dash.speed;
  const fresh = (Array.isArray(lan) ? lan : []).filter((d) => d && !d.stale).length;
  const bad = Number(health && health.bad) || 0;
  const warn = Number(health && health.warn) || 0;
  return {
    speed: sp && Number.isFinite(Number(sp.down)) ? `${Math.round(sp.down)}↓ ${Math.round(sp.up)}↑ · ${Math.round(sp.ping)} ms` : "No speed test yet",
    wifi: Array.isArray(lan) ? `${fresh} device${fresh === 1 ? "" : "s"} on Wi-Fi` : "",
    health: bad ? `${bad} need${bad === 1 ? "s" : ""} fixing` : warn ? `${warn} to check` : "All green",
  };
}
