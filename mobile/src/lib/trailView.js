/** Small pure helpers for the "where everyone went" map (no React, no Leaflet), so they can be tested. */
export const COLOURS = ["#2a78d6", "#e5484d", "#2f9e44", "#d4880b", "#8e4ec6", "#0e9f9f", "#c2255c", "#5c6b7a"];
export const colourFor = (i) => COLOURS[i % COLOURS.length];

/** The oldest time still shown for a "last N hours" choice. */
export const cutoff = (hours, now = Date.now()) => now - Math.max(0, Number(hours) || 24) * 3600 * 1000;

/** Points in the chosen window, oldest first. */
export const pointsSince = (points, hours, now = Date.now()) => (points || []).filter((p) => p.at >= cutoff(hours, now));

/** Stays and moves that end inside the window (a stay that began earlier but is still going on counts). */
export const itemsSince = (timeline, hours, now = Date.now()) => (timeline || []).filter((e) => e.to >= cutoff(hours, now));

/** The memory key for an address: about 11 m, the same rounding the server uses. */
export const coordKey = (lat, lon) => `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;

export const mapsLink = (lat, lon) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;

/** "Home", else the street address, else the coordinates: what to call a place on the page. */
export function placeLabel(found, lat, lon) {
  if (found && found.name) return found.name;
  if (found && found.address) return found.address;
  return `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
}

/** Distance covered by a list of points, ignoring GPS wobble under 50 m (same rule as the server). */
export function kmOf(points) {
  const rad = (x) => (x * Math.PI) / 180;
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    const d = 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
    if (d >= 50) m += d;
  }
  return Math.round(m / 100) / 10;
}
