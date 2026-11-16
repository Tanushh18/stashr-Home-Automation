import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { ggnAdminHttp as instance } from "../../api/client";
import { Section, Skeleton } from "../Render/RenderUi";
import { errorMessage } from "../Render/renderUtils";
import "../Render/RenderDashboard.css";
import "../WhatsApp/WhatsAppSender.css";

/*
 * ggnHome Admin panel, inside Stashr. Sign-in (the OTP ggnHome sends to the admin) and every call go through the Stashr server,
 * so no ggnhome.com page is opened. Each tab reads one part of ggnHome's admin API.
 */

const call = (method, path, body) => instance.request({ method, url: "/ggnadmin/api" + path, data: body, timeout: 70000 }).then((r) => r.data);

const TABS = [
  { id: "overview", label: "Overview", path: "/api/admin/overview" },
  { id: "users", label: "Users", path: "/admin/usermanagement" },
  { id: "properties", label: "Properties", path: "/api/admin/properties?limit=50" },
  { id: "toggles", label: "Feature toggles", path: "/api/admin/feature-toggles" },
  { id: "downloads", label: "App downloads", path: "/api/admin/app-downloads" },
  { id: "promos", label: "Promos", path: "/api/admin/promos" },
  { id: "partners", label: "Partner access", path: "/api/admin/partners/access" },
];

const short = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return Array.isArray(v) ? `${v.length} items` : JSON.stringify(v).slice(0, 80);
  return String(v).slice(0, 80);
};

/** Shows whatever ggnHome answered: a list of rows becomes a table, an object becomes name/value pairs. */
function Data({ data }) {
  if (data === null || data === undefined) return null;
  const list = Array.isArray(data) ? data : Object.values(data).find((v) => Array.isArray(v) && v.length && typeof v[0] === "object");
  if (list && list.length) {
    const cols = [...new Set(list.slice(0, 30).flatMap((r) => Object.keys(r || {})))].filter((c) => !/password|token|otp|^__v$/i.test(c)).slice(0, 8);
    return (
      <div className="wa-table-wrap">
        <table className="wa-table">
          <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{list.slice(0, 200).map((r, i) => <tr key={r._id || r.id || i}>{cols.map((c) => <td key={c}>{short(r[c])}</td>)}</tr>)}</tbody>
        </table>
        {list.length > 200 ? <p className="wa-muted">Showing the first 200 of {list.length}.</p> : null}
      </div>
    );
  }
  const entries = Object.entries(data).filter(([k]) => !/password|token|otp/i.test(k));
  return (
    <ul className="wa-people">
      {entries.map(([k, v]) => (
        <li key={k} className="wa-person"><div className="wa-person__main"><span><b>{k}</b></span><span className="wa-muted">{typeof v === "object" && v !== null ? <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(v, null, 1).slice(0, 1500)}</pre> : short(v)}</span></div></li>
      ))}
    </ul>
  );
}

function Login({ onDone }) {
  const [id, setId] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const who = id.includes("@") ? { email: id.trim() } : { mobileNumber: id };
  const act = async (fn) => { setBusy(true); try { await fn(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  return (
    <Section title="Sign in to the ggnHome admin" subtitle="Use the ggnHome admin's mobile number or email. ggnHome sends the code; you type it here. Nothing opens ggnhome.com.">
      <div className="wa-row">
        <input className="wa-input" placeholder="Admin mobile number or email" value={id} onChange={(e) => setId(e.target.value)} />
        <button className="rd-btn" disabled={busy || !id.trim()} onClick={() => act(async () => { await instance.post("/ggnadmin/otp", who); setSent(true); toast.success("Code sent."); })}>Send code</button>
      </div>
      {sent ? (
        <div className="wa-row">
          <input className="wa-input is-short" placeholder="Code" inputMode="numeric" value={otp} onChange={(e) => setOtp(e.target.value)} />
          <button className="rd-btn is-primary" disabled={busy || !otp.trim()} onClick={() => act(async () => { await instance.post("/ggnadmin/login", { ...who, otp }); toast.success("Signed in."); onDone(); })}>Sign in</button>
        </div>
      ) : null}
    </Section>
  );
}

function Panel({ tab }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    setData(null); setErr("");
    try { setData(await call("GET", tab.path)); } catch (e) { setErr(errorMessage(e, "Could not load.")); }
  }, [tab.path]);
  useEffect(() => { load(); }, [load]);
  return (
    <Section title={tab.label} actions={<button className="rd-btn is-quiet" onClick={load}>Refresh</button>}>
      {err ? <p className="wa-error">{err}</p> : data ? <Data data={data} /> : <Skeleton />}
    </Section>
  );
}

export default function GgnAdmin() {
  const [status, setStatus] = useState(null);
  const [tabId, setTabId] = useState("overview");
  const refresh = useCallback(() => instance.get("/ggnadmin/status").then((r) => setStatus(r.data)).catch(() => setStatus({ connected: false })), []);
  useEffect(() => { refresh(); }, [refresh]);
  if (!status) return <div className="rd-page"><Skeleton /></div>;
  const tab = TABS.find((t) => t.id === tabId) || TABS[0];
  return (
    <div className="rd-page wa-page">
      <header className="rd-pagehead"><h1>ggnHome admin</h1><p>The ggnHome admin panel, opened and signed in from inside Stashr.</p></header>
      {!status.connected ? <Login onDone={refresh} /> : (
        <>
          <div className="wa-row">
            <span className="wa-muted">Signed in as <b>{status.name || status.mobile}</b></span>
            <button className="rd-btn is-quiet" onClick={async () => { await instance.post("/ggnadmin/logout"); refresh(); }}>Sign out</button>
          </div>
          <div className="wa-row" role="tablist">
            {TABS.map((t) => <button key={t.id} role="tab" aria-selected={t.id === tabId} className={"rd-btn" + (t.id === tabId ? " is-primary" : " is-quiet")} onClick={() => setTabId(t.id)}>{t.label}</button>)}
          </div>
          <Panel key={tab.id} tab={tab} />
        </>
      )}
    </div>
  );
}
