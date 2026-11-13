/*
 * The pure part of the 3D house view (no three.js, no React), so it is tested and cheap to import:
 *  - nodeName(o):              the name a part had in the .glb file (three.js renames "Bedroom.001" to "Bedroom001" and "Bedroom 2" to
 *                              "Bedroom_2"; the original is kept in userData.name and that is the one that matches the room names).
 *  - markersOf(room):          what is drawn inside a room: people (sure or not), the tablet, the devices you gave this room.
 *  - spots(box, n):            where n markers stand on a room's floor, in rows, inside the room and never on top of each other.
 *  - roomLine(room):           the label above a room ("Hall · Papa · tablet · 2 devices (1 on)").
 *  - roomFacts(room, extra):   what the room panel lists when a room is tapped.
 */

/** The original glTF name of a three.js object (falls back to its three.js name). */
export const nodeName = (o) => (o && o.userData && typeof o.userData.name === "string" && o.userData.name) || (o && o.name) || "";

/**
 * The markers of one room. room: { people: [{ person, sure? }], devices: [{ label, up, tag }], hub }.
 * -> [{ kind: "person" | "person-unsure" | "hub" | "device-up" | "device-down", label }], people first.
 */
export function markersOf(room) {
  const out = [];
  for (const p of (room && room.people) || []) out.push({ kind: p.sure === false ? "person-unsure" : "person", label: p.sure === false ? `${p.person} ?` : p.person });
  if (room && room.hub) out.push({ kind: "hub", label: "Tablet" });
  for (const d of (room && room.devices) || []) out.push({ kind: d.up ? "device-up" : "device-down", label: d.label || "Device" });
  return out;
}

/**
 * n spots on the floor of a box { min: { x, z }, max: { x, z } } (three.js world units, y is up), filling rows from the front-left,
 * kept a margin away from the walls. -> [{ x, z }]. A tiny room still gets every marker (they just sit closer).
 */
export function spots(box, n) {
  if (!n) return [];
  const w = Math.max(1e-6, box.max.x - box.min.x), d = Math.max(1e-6, box.max.z - box.min.z);
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * w) / d)) || 1));
  const rows = Math.ceil(n / cols);
  const mx = w * 0.15, mz = d * 0.15;
  const sx = cols > 1 ? (w - mx * 2) / (cols - 1) : 0, sz = rows > 1 ? (d - mz * 2) / (rows - 1) : 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    out.push({ x: cols > 1 ? box.min.x + mx + c * sx : box.min.x + w / 2, z: rows > 1 ? box.min.z + mz + r * sz : box.min.z + d / 2 });
  }
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The label above a room: its name, who is in it, how many devices (and how many are on). */
export function roomLine(room) {
  const parts = [room.name];
  const people = (room.people || []).map((p) => (p.sure === false ? `${p.person}?` : p.person));
  if (people.length) parts.push(people.join(", "));
  if (room.hub) parts.push("tablet");
  const devs = room.devices || [];
  if (devs.length) { const up = devs.filter((d) => d.up).length; parts.push(`${plural(devs.length, "device", "devices")}${up !== devs.length ? ` (${up} on)` : ""}`); }
  return parts.join(" · ");
}

/**
 * What the room panel shows when a room is tapped. extra: { training: { person: count }, autoTraining: { person: count } } from Room Lab.
 * -> { name, people: [text], devices: [{ label, up, tag }], hub, training: [text], empty }
 */
export function roomFacts(room, extra = {}) {
  const people = (room.people || []).map((p) => (p.sure === false ? `${p.person} (pakka nahi)` : p.person));
  const training = Object.entries(extra.training || {}).map(([who, n]) => {
    const auto = (extra.autoTraining || {})[who] || 0;
    return `${who}: ${n} scan${auto ? ` + ${auto} apne aap` : ""}`;
  });
  const devices = [...(room.devices || [])].sort((a, b) => Number(b.up) - Number(a.up) || String(a.label).localeCompare(String(b.label)));
  return { name: room.name, people, devices, hub: Boolean(room.hub), training, empty: !people.length && !devices.length && !room.hub };
}
