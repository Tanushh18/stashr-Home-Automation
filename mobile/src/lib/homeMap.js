/**
 * Draws the house map as plain SVG shapes. Pure (no React, no DOM), so the same maths is tested and can be rendered anywhere.
 * `shapes(map, mode)` takes what GET /home/map returns and gives { width, height, items } for mode "2d" (a floor diagram) or
 * "3d" (the same blocks pushed up into an isometric view). Nothing here is to scale: it is a diagram of zones, not a floor plan.
 */
export const SCALE_2D = 120;    // pixels (in the drawing) per grid unit in 2D
const S2 = SCALE_2D;
const S3 = 84;                  // in 3D
const COS = Math.cos(Math.PI / 6), SIN = 0.5;
const PAD = 28;
const BLOCK_H = 0.55;           // how tall a zone block is in 3D (grid units)

/** Grid position (x, y, height z) -> isometric pixel position. */
export const iso = (x, y, z = 0, s = S3) => ({ x: (x - y) * COS * s, y: (x + y) * SIN * s - z * s });

const pts = (list) => list.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(" ");

function extent(blocks) {
  if (!blocks.length) return { w: 2, h: 2 };
  return { w: Math.max(...blocks.map((b) => b.x + b.w)), h: Math.max(...blocks.map((b) => b.y + b.h)) };
}

/** What sits in a block, as little markers: the tablet, devices (green = on the Wi-Fi now), people. */
function markers(b) {
  const out = [];
  if (b.hub) out.push({ kind: "hub", label: "Tablet" });
  for (const d of b.devices || []) out.push({ kind: d.up ? "device-up" : "device-down", label: d.label });
  for (const p of b.people || []) out.push({ kind: "person", label: p.person });
  return out;
}

export function shapes(map, mode = "2d", withPlan = true, min = { w: 0, h: 0 }) {
  const blocks = (map && map.zones) || [];
  const real = extent(blocks);
  const ex = { w: Math.max(real.w, min.w || 0), h: Math.max(real.h, min.h || 0) };    // editing keeps a fixed, roomy canvas so nothing jumps while a block is dragged
  const items = [];
  if (mode === "2d") {
    const width = ex.w * S2 + PAD * 2, height = ex.h * S2 + PAD * 2;
    if (withPlan && map && map.plan) items.push({ type: "plan", href: map.plan, x: PAD, y: PAD, w: ex.w * S2, h: ex.h * S2 });
    for (const b of blocks) {
      const x = PAD + b.x * S2, y = PAD + b.y * S2, w = b.w * S2, h = b.h * S2;
      items.push({ type: "rect", id: b.id, x, y, w, h, cls: b.labelOnly ? "label" : "zone", plan: Boolean(map.plan) });
      items.push({ type: "text", x: x + 10, y: y + 20, text: b.name, cls: "title" });
      if (b.hint && b.auto) items.push({ type: "text", x: x + 10, y: y + 36, text: b.hint, cls: "hint" });
      markers(b).forEach((m, i) => {
        const dx = x + 22 + (i % 5) * 34, dy = y + h - 38 - Math.floor(i / 5) * 34;
        items.push({ type: "dot", x: dx, y: dy, r: 11, kind: m.kind, label: m.label });
        if (m.kind === "person") items.push({ type: "text", x: dx, y: dy + 24, text: m.label, cls: "person" });
      });
    }
    return { width, height, items };
  }
  // 3D: faces back to front so nearer blocks cover farther ones
  const ordered = [...blocks].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const corners = (b, z) => ({ n: iso(b.x, b.y, z), e: iso(b.x + b.w, b.y, z), s: iso(b.x + b.w, b.y + b.h, z), w: iso(b.x, b.y + b.h, z) });
  const high = (b) => (Number.isFinite(b.z) && b.z > 0 ? b.z : BLOCK_H);               // a room's own height (you set it in the layout editor)
  const all = [];
  for (const b of ordered) { const t = corners(b, high(b)), g = corners(b, 0); all.push(t.n, t.e, t.s, t.w, g.s, g.w, g.e); }
  const minX = Math.min(...all.map((p) => p.x), 0), minY = Math.min(...all.map((p) => p.y), 0), maxX = Math.max(...all.map((p) => p.x), 1), maxY = Math.max(...all.map((p) => p.y), 1);
  const ox = PAD - minX, oy = PAD + 18 - minY;
  const mv = (p) => ({ x: p.x + ox, y: p.y + oy });
  for (const b of ordered) {
    const t = corners(b, high(b)), g = corners(b, 0), cls = b.labelOnly ? "label" : "zone";
    items.push({ type: "poly", cls: cls + "-left", points: pts([t.w, t.s, g.s, g.w].map(mv)), id: b.id });
    items.push({ type: "poly", cls: cls + "-right", points: pts([t.s, t.e, g.e, g.s].map(mv)), id: b.id });
    items.push({ type: "poly", cls: cls + "-top", points: pts([t.n, t.e, t.s, t.w].map(mv)), id: b.id });
    const c = mv(iso(b.x + b.w / 2, b.y + b.h / 2, high(b)));
    items.push({ type: "text", x: c.x, y: c.y - 12, text: b.name, cls: "title-c" });
    markers(b).forEach((m, i, arr) => { const p = mv(iso(b.x + Math.min(0.35, b.w / 6) + (i % 4) * 0.42, b.y + Math.max(0.5, b.h - 0.55) + Math.floor(i / 4) * 0.34, high(b) + 0.12)); items.push({ type: "dot", x: p.x, y: p.y, r: 9, kind: m.kind, label: m.label, last: i === arr.length - 1 }); if (m.kind === "person") items.push({ type: "text", x: p.x, y: p.y + 20, text: m.label, cls: "person" }); });
  }
  return { width: Math.ceil(maxX - minX + PAD * 2), height: Math.ceil(maxY - minY + PAD * 2 + 36), items };
}

/** The "away" people as a line of text under the map. */
export function awayLine(map) {
  const a = (map && map.away) || [];
  return a.length ? `Bahar: ${a.map((p) => p.person + (p.distanceKm != null ? ` (${p.distanceKm} km)` : "")).join(", ")}` : "";
}

/* ───────── editing the layout ───────── */

export const STEP = 0.5;
export const LIMITS = { xy: [0, 40], size: [1, 8], z: [0.3, 3] };
export const snap = (v) => Math.round(v / STEP) * STEP;
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/** One block with its numbers snapped to half a unit and kept inside the limits (z, the height, to two decimals). */
export function clampBlock(b) {
  return { ...b, x: clamp(snap(b.x), LIMITS.xy), y: clamp(snap(b.y), LIMITS.xy), w: clamp(snap(b.w), LIMITS.size), h: clamp(snap(b.h), LIMITS.size), z: Math.round(clamp(Number.isFinite(b.z) ? b.z : BLOCK_H, LIMITS.z) * 100) / 100 };
}
export const moveBlock = (b, dx, dy) => clampBlock({ ...b, x: b.x + dx, y: b.y + dy });
export const resizeBlock = (b, dw, dh) => clampBlock({ ...b, w: b.w + dw, h: b.h + dh });
export const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The names of the blocks that sit on top of each other (a warning, not an error: stacked rooms are legal, just hard to read). */
export function overlapping(blocks) {
  const names = new Set();
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) if (overlap(blocks[i], blocks[j])) { names.add(blocks[i].name); names.add(blocks[j].name); }
  return [...names];
}

/** What the server saves: { "Bedroom": { x, y, w, h, z } } for the room blocks only. */
export function layoutOf(blocks) {
  const out = {};
  for (const b of blocks) if (b.roomBlock) { const c = clampBlock(b); out[c.name] = { x: c.x, y: c.y, w: c.w, h: c.h, z: c.z }; }
  return out;
}

/** The layout as a file you can keep and import later, on this or another Stashr. */
export const exportText = (blocks) => JSON.stringify({ kind: "stashr-house-layout", version: 1, rooms: layoutOf(blocks) }, null, 2);

/**
 * Reads a layout file. Returns { ok: true, layout, used, ignored } with only the rooms that exist (matched by name, ignoring capital letters),
 * or { ok: false, error } for something that is not a layout file. Rooms in the file that you do not have are listed in `ignored`.
 */
export function parseLayoutFile(text, roomNames) {
  let j;
  try { j = JSON.parse(text); } catch { return { ok: false, error: "This is not a JSON file." }; }
  const rooms = j && (j.kind === "stashr-house-layout" ? j.rooms : j.rooms || j);
  if (!rooms || typeof rooms !== "object" || Array.isArray(rooms)) return { ok: false, error: "This file has no rooms in it." };
  const layout = {}, ignored = [];
  for (const [name, r] of Object.entries(rooms)) {
    const mine = roomNames.find((n) => n.toLowerCase() === String(name).toLowerCase());
    if (!mine) { ignored.push(name); continue; }
    if (!r || ![r.x, r.y, r.w, r.h].every((v) => Number.isFinite(Number(v)))) { ignored.push(name); continue; }
    layout[mine] = { x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h), ...(r.z !== undefined && Number.isFinite(Number(r.z)) ? { z: Number(r.z) } : {}) };
  }
  if (!Object.keys(layout).length) return { ok: false, error: "None of the rooms in this file match your rooms." };
  return { ok: true, layout, used: Object.keys(layout), ignored };
}
