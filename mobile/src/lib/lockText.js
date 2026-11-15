/*
 * The "lock another phone" button: the words and the link rules, kept apart from React so they can be tested
 * (scripts/lockText.test.mjs). The server only says a lock was SENT; the phone itself reports whether it locked.
 */

export const ID24 = /^[a-f0-9]{24}$/;

const WHY = {
  admin_off: "Remote lock is switched off on that phone",
  stale: "the request arrived too late and was ignored",
  not_linked: "that phone is not linked to Stashr any more",
  lock_failed: "Android refused to lock the screen",
};
export const lockWhy = (reason) => WHY[String(reason || "")] || "unknown reason";

/** A pinned or widget link: stashr://action?do=lock&id=<device id>&k=<this install's key>. */
export const lockLink = (id, key) => `stashr://action?do=lock&id=${encodeURIComponent(id)}&k=${encodeURIComponent(key)}`;

/** From the link's parameters: which phone to lock, or null when it is not a well-formed lock link. */
export function lockPlan(p) {
  if (!p || p.do !== "lock") return null;
  return typeof p.id === "string" && ID24.test(p.id) ? { id: p.id } : null;
}

/** What to show for one phone from its status.health: is Remote lock on, and what happened to the last request. */
export function lockState(health, now = Date.now()) {
  const h = health || {};
  const remote = h.remoteLock === true ? "on" : h.remoteLock === false ? "off" : "unknown";
  const l = h.lastLock && Number.isFinite(Number(h.lastLock.at)) ? h.lastLock : null;
  const last = l ? { at: Number(l.at), ok: l.ok === true, why: l.ok === true ? "" : lockWhy(l.reason), ageMin: Math.max(0, Math.round((now - Number(l.at)) / 60000)) } : null;
  return { remote, last };
}

/** The line under the phone's name. */
export function remoteLockLine(state) {
  if (state.remote === "on") return "Remote lock is on";
  if (state.remote === "off") return "Remote lock is OFF: switch it on in Stashr Location on that phone";
  return "Remote lock: not known yet (update Stashr Location on that phone)";
}
