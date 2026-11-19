import { fx } from "../../lib/fx";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getRenderOpsIncidents } from "../../api/client";
import { openIncidents, newIncidents } from "../../lib/alerts";
import { isUserActive, onUserReturn } from "../../lib/activity";
import "./AlertBell.css";

const POLL_MS = 2 * 60 * 1000;   // and not at all while nobody is here (lib/activity), to save the server's bandwidth

/* Bell in the navbar: shows open server incidents and raises a desktop notification for new ones (if allowed). */
export default function AlertBell({ enabled, placement = "down" }) {
  const [open, setOpen] = useState([]);
  const [menu, setMenu] = useState(false);
  const seen = useRef(null); // null until the first load, so old incidents never pop a notification
  const wrap = useRef(null);

  const poll = useCallback(async () => {
    if (document.hidden || !isUserActive()) return;
    try {
      const { incidents } = await getRenderOpsIncidents(100);
      const now = openIncidents(incidents);
      if (seen.current && newIncidents(now, seen.current).length) fx.emit("boom", { big: true, x: window.innerWidth - 70, y: 40 });
      if (seen.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
        newIncidents(now, seen.current).slice(0, 3).forEach((e) => new Notification(`${e.serviceName || "Service"}: ${e.type}`, { body: e.message || "New incident", tag: e.id }));
      }
      seen.current = new Set(now.map((e) => e.id));
      setOpen(now);
    } catch { /* no Render accounts yet, or offline: keep the bell quiet */ }
  }, []);

  useEffect(() => {
    if (!enabled) { seen.current = null; setOpen([]); return undefined; }
    void poll();
    const t = setInterval(poll, POLL_MS);
    const onVisible = () => { if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    const stopReturn = onUserReturn(onVisible);
    return () => { clearInterval(t); stopReturn(); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, poll]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  if (!enabled) return null;
  const canAsk = typeof Notification !== "undefined" && Notification.permission === "default";
  return (
    <div className={`bell bell--${placement}`} ref={wrap}>
      <button type="button" className="bell__btn" onClick={() => setMenu((m) => !m)} aria-label={`Alerts${open.length ? `, ${open.length} open` : ""}`} aria-expanded={menu}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9.5a6 6 0 0 1 12 0c0 4.5 1.8 6 2 6.5H4c.2-.5 2-2 2-6.5ZM10 19.5a2 2 0 0 0 4 0" /></svg>
        {open.length ? <span className="bell__count">{open.length > 9 ? "9+" : open.length}</span> : null}
      </button>
      {menu && (
        <div className="bell__menu card" role="menu">
          {open.length ? open.slice(0, 6).map((e) => (
            <Link key={e.id} to="/render" className="bell__item" role="menuitem" onClick={() => setMenu(false)}>
              <strong>{e.serviceName || "Service"}</strong><small>{e.message}</small>
            </Link>
          )) : <p className="bell__empty">All services are healthy. No open incidents.</p>}
          {open.length > 6 ? <Link to="/render" className="bell__all" onClick={() => setMenu(false)}>See all {open.length} incidents</Link> : null}
          {canAsk && <button type="button" className="btn btn--quiet btn--sm" onClick={() => Notification.requestPermission().then(() => setMenu(false))}>Enable desktop alerts</button>}
        </div>
      )}
    </div>
  );
}
