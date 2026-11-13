/** Small pure helpers for the Room Lab card (no React), so they can be tested. */

/** "good" / "fair" / "weak" from the cross-validated accuracy, or "none" when there is nothing to judge yet. */
export const tone = (accuracy, tested) => (!tested ? "none" : accuracy >= 85 ? "good" : accuracy >= 65 ? "fair" : "weak");

/** The confusion table as rows: for each real room, how many of its scans were guessed as each room (and "not sure"). */
export function confusionRows(report) {
  const rooms = Object.keys(report.perRoom || {}).sort();
  const cols = [...rooms, "(not sure)"];
  return { cols, rows: rooms.map((r) => ({ room: r, n: (report.perRoom[r] || {}).n || 0, accuracy: (report.perRoom[r] || {}).accuracy || 0, cells: cols.map((c) => ((report.confusion || {})[r] || {})[c] || 0) })) };
}

/** The rooms of a phone that are not trained enough (fewer than 5 samples, or never trained). */
export const thinRooms = (rooms, counts) => rooms.filter((r) => (counts[r] || 0) < 5);

/** How long ago, in words. */
export function agoText(ms, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  return m < 1 ? "abhi" : m < 60 ? `${m} min pehle` : `${Math.round(m / 60)} ghante pehle`;
}

/** "████░░░░" for a percentage (the same bar the tablet draws). */
export function barText(pct, width = 20) {
  const full = Math.round((Math.max(0, Math.min(100, pct)) * width) / 100);
  return "█".repeat(full) + "░".repeat(width - full);
}

/** Every number the model calculated for one phone, as [label, value] rows (the tablet shows the same rows). */
export function liveRows(p, now = Date.now()) {
  const rows = [];
  const cur = p.current;
  if (cur) {
    rows.push(["pakka (confidence)", `${Math.round((cur.confidence || 0) * 100)}%`]);
    rows.push(["aakhri scan", cur.ageSec < 5 ? "abhi" : cur.ageSec < 90 ? `${cur.ageSec} s pehle` : `${Math.round(cur.ageSec / 60)} min pehle`]);
    if (cur.nearest !== null && cur.nearest !== undefined) rows.push(["doori (sabse paas ka sample)", `${cur.nearest} dBm`]);
    rows.push(["suna", `Wi-Fi ${cur.heard.wifi} · Bluetooth ${cur.heard.ble}`]);
    rows.push(["samples (is phone ke)", String(cur.samples)]);
  }
  rows.push(["accuracy (chhupa ke guess)", p.cv.tested ? `${p.cv.accuracy}% · ${p.cv.tested} scan ka test · ${p.cv.unsure}% pakka nahi` : "abhi nahi bani"]);
  rows.push(["asli accuracy (aapke taps)", p.field.total ? `${p.field.accuracy}% · ${p.field.confirmed} sahi, ${p.field.wrong} galat` : "abhi koi tap nahi"]);
  if (p.auto) rows.push(["apne aap seekhna", autoLine(p, now)]);
  if (cur && p.auto) rows.push(["is scan se seekha?", cur.learned ? "haan (auto sample bana)" : `nahi: ${learnWhy(cur.learnWhy)}`]);
  if (p.tune) rows.push(["chaudai (tuned)", `${p.tune.width} dBm${p.tune.accuracy !== null && p.tune.accuracy !== undefined ? ` · test ${p.tune.accuracy}%` : ""}${p.tune.gone ? ` · ${p.tune.gone} purane network ignore` : ""}`]);
  return rows;
}

/** Why a live scan was not learned from, in plain words (the server's reasons, see server/utils/roomModel.autoGate). */
const WHY = {
  "auto-improve is off": "apne aap seekhna band hai",
  "paused": "ruka hua hai",
  "the scan is not fresh": "scan taaza nahi (Stashr Location 1.10 chahiye)",
  "not sure": "kamra pakka nahi",
  "not sure enough": "75% se kam pakka",
  "two rooms are close": "do kamre milte-julte lage",
  "not a familiar spot": "ye jagah anjaan lagi",
  "the room is not settled": "abhi kamre mein aaye (sthir nahi)",
  "not trained enough by a person": "pehle har kamre mein 5+ scan khud train karo",
  "already have this spot": "ye jagah pehle se seekhi hui",
  "one a while ago": "is kamre ka abhi-abhi seekha (10 min mein ek)"
};
export const learnWhy = (why) => WHY[why] || why || "—";

/** Auto-improve of one phone in one line: off, paused (why, until when), or on with how much it learned and when. */
export function autoLine(p, now = Date.now()) {
  const a = p.auto || {};
  if (!a.on) return "band (is phone ke liye)";
  if (a.paused) return `ruka hua${a.why ? ` (${a.why})` : ""}${a.pausedUntil ? `, ${new Date(a.pausedUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} tak` : ""}`;
  const total = a.total ?? a.added ?? 0;
  const head = total ? `on · ${total} scan apne aap seekhe${a.lastAt ? ` · aakhri: ${a.lastRoom || "?"}, ${agoText(a.lastAt, now)}` : ""}` : "on · abhi tak kuch nahi seekha";
  const g = a.guard;
  return g && Number.isFinite(g.with) ? `${head} · jaanch: saath ${g.with}% / bina ${g.without}%` : head;
}

/** What the headline says for a phone: the room, "(?)" when unsure, "(purana)" when old, or why there is none. */
export function headline(p) {
  const c = p.current;
  if (!c) return !p.trained ? "train nahi hua" : !p.on ? "band" : "scan ka intezaar";
  if (!c.fresh) return `${c.name} (purana)`;
  return c.sure ? c.name : `${c.name} (?)`;
}
