import { request } from "./api";

/* Administrator calls (the website's Admin panel and App updates pages). The server refuses them for anyone who is not an administrator. */
const j = (path, method, body, timeout) => request(path, { method, body, timeout });

export const admin = {
  users: (q = "") => request(`/admin/users?q=${encodeURIComponent(q)}&limit=300`, { timeout: 30000 }),
  setFeature: (id, key, enabled) => j(`/admin/users/${encodeURIComponent(id)}/features`, "PUT", { key, enabled }),
  deleteUser: (id, confirmEmail) => j(`/admin/users/${encodeURIComponent(id)}`, "DELETE", { confirmEmail }, 30000),
  // Live usage and limits of the services each Render app uses.
  liveDashboard: (refresh) => request(`/render/live-dashboard${refresh ? "?refresh=1" : ""}`, { timeout: 60000 }),
  rollout: () => request("/api/app-rollout", { timeout: 30000 }),
  saveRollout: (app, body) => j(`/api/app-rollout/${app}`, "PUT", body),
};

/** One line that says what will happen with the newest release of an app. */
export function rolloutSummary(app) {
  if (!app.latest) return app.error || "No release found yet.";
  const total = app.devices.length, offered = app.devices.filter((d) => d.offered).length;
  const v = app.latest.version;
  if (app.rule.mode === "hold") return `${v}: not offered to anyone (hold).`;
  if (app.rule.mode === "all") return app.selectable ? `${v}: offered to everyone (${total} device${total === 1 ? "" : "s"}).` : `${v}: offered to everyone.`;
  return `${v}: offered to ${offered} device${offered === 1 ? "" : "s"} only${total ? ` (of ${total})` : ""}.`;
}

/** The ticked devices that would NOT really be offered the update: their app is too old to say who it is. */
export const cannotBePicked = (app, ticked) => app.devices.filter((d) => new Set(ticked).has(d.id) && d.canIdentify === false);

/** What to send to the server for "Save": the mode, the devices only for "selected", and the default for later releases. */
export const rolloutPayload = (mode, ticked, waitForMe) => ({ mode, ...(mode === "selected" ? { devices: [...ticked] } : {}), defaultMode: waitForMe ? "hold" : "all" });
