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
