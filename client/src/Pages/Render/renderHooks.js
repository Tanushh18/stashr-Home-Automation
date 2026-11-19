import { useEffect, useRef } from "react";
import { isUserActive, onUserReturn } from "../../lib/activity";

/**
 * Calls `callback` every `ms` while `enabled`, the tab is visible and the person is around (no touch for 5 minutes pauses it, to save
 * the server's bandwidth; it catches up at once when they come back).
 * Catches up immediately when a hidden tab becomes visible again, and always
 * invokes the latest callback so intervals never act on stale closures.
 */
export function usePolling(callback, ms, enabled = true) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const tick = () => { if (!document.hidden && isUserActive()) void saved.current(); };
    const stopReturn = onUserReturn(() => { if (!document.hidden) void saved.current(); });
    const start = () => { if (timer == null) timer = window.setInterval(tick, ms); };
    const stop = () => { if (timer != null) { window.clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { tick(); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); stopReturn(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [ms, enabled]);
}

/** Guards against out-of-order async responses: only the newest request may commit. */
export function useRequestGate() {
  const counter = useRef(0);
  return () => {
    counter.current += 1;
    const mine = counter.current;
    return () => mine === counter.current;
  };
}
