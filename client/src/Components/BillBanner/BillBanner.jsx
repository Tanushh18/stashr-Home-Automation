import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getBillsDue } from "../../api/client";
import { useVault } from "../../state/vault";
import { bannerDays, hiddenToday, hideForToday, whenWord } from "../../lib/bills";
import "./BillBanner.css";

/** At the very top of every page: bills that are overdue or due within a few days. "Hide until tomorrow" brings it back the next day. */
export default function BillBanner() {
  const { status } = useVault();
  const [due, setDue] = useState([]);
  const [hidden, setHidden] = useState(() => hiddenToday());

  const load = useCallback(() => {
    getBillsDue(bannerDays()).then((d) => setDue(d.due || [])).catch(() => setDue([]));
  }, []);
  useEffect(() => {
    if (status !== "ready") { setDue([]); return undefined; }
    load();
    const onVisible = () => { if (!document.hidden) { setHidden(hiddenToday()); load(); } };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("stashr-bills-changed", load);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("stashr-bills-changed", load); };
  }, [status, load]);

  if (status !== "ready" || hidden || !due.length) return null;
  const late = due.some((b) => b.state === "overdue");
  const shown = due.slice(0, 3);
  return (
    <div className={"billbar" + (late ? " is-late" : "")} role="alert">
      <span className="billbar__icon" aria-hidden="true">🧾</span>
      <div className="billbar__text">
        <b>{due.length === 1 ? "1 bill needs paying" : `${due.length} bills need paying`}</b>
        <span>{shown.map((b) => `${b.name} (${whenWord(b)})`).join(" · ")}{due.length > shown.length ? ` · +${due.length - shown.length} more` : ""}</span>
      </div>
      <Link className="billbar__btn" to="/bills">Open bills</Link>
      <button type="button" className="billbar__btn billbar__btn--quiet" onClick={() => { hideForToday(); setHidden(true); }} title="It comes back tomorrow">Hide until tomorrow</button>
    </div>
  );
}
