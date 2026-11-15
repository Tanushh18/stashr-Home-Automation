/*
 * Rules for the Stashr Home command centre, kept apart from React so they can be tested (scripts/commandCentre.test.mjs).
 * Everything here works only from data the server really returned; nothing is invented.
 */

/** How old the picture is: "live" under 45 s, "recent" under 3 min, otherwise "stale". `at` is the time of the last good load. */
export function freshness(at, now = Date.now()) {
  if (!at) return "none";
  const s = (now - at) / 1000;
  return s < 45 ? "live" : s < 180 ? "recent" : "stale";
}

/** The devices drawn around the orb: TV, hub and family phones, each with an honest tone. */
export function nodesOf(devices, now = Date.now()) {
  const order = { tv: 0, hub: 1, phone: 2 };
  return (devices || [])
    .filter((d) => d && order[d.kind] !== undefined)
    .sort((a, b) => order[a.kind] - order[b.kind])
    .slice(0, 8)
    .map((d) => {
      const st = d.status || {};
      let line = d.online ? "Online" : "Offline";
      if (d.kind === "tv" && d.online) line = st.screen === "off" ? "Standby" : st.app && st.app.label ? st.app.label : "On";
      if (d.kind === "hub" && d.online && st.camera && st.camera.armed) line = "Camera armed";
      if (d.kind === "phone" && d.online && Number.isFinite(Number(st.battery))) line = `${Math.round(Number(st.battery))}% battery`;
      const tone = !d.online ? "off" : d.kind === "tv" && st.screen === "off" ? "idle" : "on";
      return { id: d.id, kind: d.kind, name: String(d.name || d.kind), line, tone };
    });
}

/** One headline for the top of the screen. `bad` is the number of failing health items; `offline` the devices that stopped reporting. */
export function headline({ bad = 0, offline = 0, error = "", fresh = "none" } = {}) {
  if (fresh === "none" && error) return { tone: "bad", text: "Can't reach Stashr", sub: "Showing nothing until it answers" };
  if (bad > 0) return { tone: "bad", text: "Attention needed", sub: `${bad} thing${bad > 1 ? "s" : ""} on your devices need${bad > 1 ? "" : "s"} fixing` };
  if (offline > 0) return { tone: "warn", text: "Some devices are offline", sub: `${offline} not reporting` };
  if (fresh === "stale") return { tone: "warn", text: "Showing older information", sub: "Stashr could not refresh just now" };
  return { tone: "ok", text: "All good", sub: "Everything that reports is online" };
}

export const GREETING = (hour) => (hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 22 ? "Good evening" : "Good night");

/** Quick actions that only exist when the matching device is really linked. Each one is a command the server whitelists. */
export function quickActions(devices) {
  const tv = (devices || []).find((d) => d.kind === "tv");
  const hub = (devices || []).find((d) => d.kind === "hub" && d.status && d.status.agent === "stashr-hub");
  const out = [];
  if (tv) {
    out.push({ key: "playpause", label: "Play / pause", icon: "▶", device: tv, type: "media", args: { action: "play_pause" }, disabled: !tv.online });
    out.push({ key: "mute", label: "Mute TV", icon: "🔇", device: tv, type: "volume", args: { action: "mute" }, disabled: !tv.online });
  }
  if (hub) out.push({ key: "snap", label: "Camera photo", icon: "📷", device: hub, type: "camera", args: { action: "snapshot" }, disabled: !hub.online });
  return out;
}
