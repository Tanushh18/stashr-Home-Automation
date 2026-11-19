/*
 * "Is somebody actually here?" The free server plan has a small monthly bandwidth allowance, and a dashboard left open on a second
 * screen used to ask the server for fresh data every few seconds all day. Pollers use this to pause after a few minutes without a
 * touch, key press or scroll, and to catch up at once when the person comes back.
 */
export const IDLE_MS = 5 * 60 * 1000;

/** Pure: has it been quiet for long enough to stop polling? */
export const isIdleAt = (lastActiveAt, now = Date.now(), idleMs = IDLE_MS) => now - lastActiveAt >= idleMs;

let lastActiveAt = Date.now();
const wakers = new Set();
let started = false;

function touch() {
  const wasIdle = isIdleAt(lastActiveAt);
  lastActiveAt = Date.now();
  if (wasIdle) for (const fn of [...wakers]) { try { fn(); } catch { /* one listener must not stop the rest */ } }
}

/** Begin listening (once). Safe to call from many places. */
export function startActivityTracking() {
  if (started || typeof window === "undefined") return;
  started = true;
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) window.addEventListener(ev, touch, { passive: true, capture: true });
  window.addEventListener("focus", touch);
}

export const isUserActive = () => { startActivityTracking(); return !isIdleAt(lastActiveAt); };

/** Call `fn` when the person comes back after being idle. Returns a function that stops listening. */
export function onUserReturn(fn) { startActivityTracking(); wakers.add(fn); return () => wakers.delete(fn); }

/** Test helper. */
export const _setLastActive = (t) => { lastActiveAt = t; };
