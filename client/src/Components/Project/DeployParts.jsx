import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { getDeployHistory, getDeployLogs, getGithubAccounts, getGithubBranches, getHostAccounts, getRenderAccounts, moveDeployAccount, setDeployBranch } from "../../api/client";
import { timeAgo, safeUrl, errorMessage } from "../../Pages/Render/renderUtils";
import { useDialogs } from "../../Components/UI/Dialogs";
import { isUserActive } from "../../lib/activity";

export const hostOf = (url) => String(url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
export const DEPLOY_LABEL = {
  live: "Live", ready: "Live", success: "Live", building: "Building", build_in_progress: "Building", update_in_progress: "Deploying", pre_deploy_in_progress: "Pre-deploy",
  failed: "Failed", build_failed: "Build failed", update_failed: "Deploy failed", error: "Failed", canceled: "Canceled", cancelled: "Canceled", deactivated: "Replaced", created: "Queued", queued: "Queued", unknown: "Unknown"
};
const IN_PROGRESS = /build|deploy|queue|creat|pre_deploy|building/;

/** Coloured tag for the platform a server runs on. */
export function PlatformBadge({ target }) {
  return <span className={"plat plat--" + target.provider}>{target.label}{target.main ? " · main" : ""}</span>;
}

/** One URL as a link; several open as a dropdown. */
export function UrlMenu({ urls, label = "live URLs" }) {
  const list = [...new Set((urls || []).filter((u) => /^https:\/\//i.test(String(u || ""))))];
  if (!list.length) return <span className="pdep__dim">—</span>;
  if (list.length === 1) return <a href={safeUrl(list[0], "")} target="_blank" rel="noopener noreferrer" className="pdep__url">{hostOf(list[0])} ↗</a>;
  return (
    <details className="urlmenu">
      <summary>{list.length} {label}</summary>
      <ul>{list.map((u) => <li key={u}><a href={safeUrl(u, "")} target="_blank" rel="noopener noreferrer">{hostOf(u)} ↗</a></li>)}</ul>
    </details>
  );
}

/** Header cell that sorts its column. `sort` is { key, dir }. */
export function SortTh({ id, label, sort, onSort, className }) {
  const active = sort?.key === id;
  return (
    <th className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={"pdep__sort" + (active ? " is-active" : "")} onClick={() => onSort({ key: id, dir: active && sort.dir === "asc" ? "desc" : "asc" })}>
        {label}<span aria-hidden="true">{active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</span>
      </button>
    </th>
  );
}

/** Status of a server from its live state and latest deploy. */
export function StatusPill({ target }) {
  if (target.error && !target.url && !target.latestDeploy) return <span className="pdep__pill is-unknown" title={target.error}>Unreadable</span>;
  const raw = String(target.latestDeploy?.status || "").toLowerCase();
  if (target.suspended) return <span className="pdep__pill is-suspended">Suspended</span>;
  const label = DEPLOY_LABEL[raw] || (raw ? raw.replace(/_/g, " ") : "Running");
  const cls = /fail|error|canceled|cancelled/.test(raw) ? "bad" : IN_PROGRESS.test(raw) ? "mid" : "live";
  return <span className={"pdep__pill is-" + cls}>{label}</span>;
}

/** Which connected account this server is read through (Render or the same host). Hidden when there is only one. */
export function AccountPicker({ projectId, target, onDone, onMove }) {
  const [accounts, setAccounts] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const load = target.provider === "render" ? getRenderAccounts().then((r) => r.accounts || []) : getHostAccounts().then((r) => (r.accounts || []).filter((a) => a.provider === target.provider));
    load.then(setAccounts).catch(() => setAccounts([]));
  }, [target.provider]);
  if (!accounts) return <span className="pdep__dim">…</span>;
  if (accounts.length < 2) return <span>{target.accountName || "—"}</span>;
  const change = async (accountId) => {
    if (accountId === target.accountId) return;
    setBusy(true);
    try {
      if (target.provider === "render") {
        // A Render service cannot be moved by changing the account reference; create a replacement instead.
        if (typeof onMove === "function") onMove(accountId);
        return;
      }
      await moveDeployAccount(projectId, target.ref, accountId);
      toast.success("Now read through " + (accounts.find((a) => a.id === accountId)?.name || "that account") + ".");
      onDone();
    } catch (e) { toast.error(errorMessage(e, "Could not change the account.")); }
    finally { setBusy(false); }
  };
  return (
    <select className="input pdep__account" value={target.accountId} disabled={busy} aria-label={target.provider === "render" ? "Move " + target.name + " to another account" : "Account for " + target.name} onChange={(e) => void change(e.target.value)}>
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      {!accounts.some((a) => a.id === target.accountId) ? <option value={target.accountId}>{target.accountName || "Unknown account"}</option> : null}
    </select>
  );
}

/** The repository's branches, read from GitHub with the first usable token. Loaded only when a branch is changed. */
export async function loadRepoBranches(repoUrl) {
  const accounts = (await getGithubAccounts()).accounts || [];
  const usable = accounts.find((a) => a.valid !== false && a.write) || accounts.find((a) => a.valid !== false);
  if (!usable) return { connected: false, branches: [], default: "" };
  const r = await getGithubBranches(usable.id, repoUrl);
  return { connected: true, branches: (r.branches || []).map((b) => b.name), default: r.default || "" };
}

/** Switch the branch a server deploys (any provider), optionally deploying it straight away. */
export function BranchChange({ projectId, project, target, onDone }) {
  const { confirm } = useDialogs();
  const [info, setInfo] = useState(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const open = async () => {
    if (info || busy) return;
    setBusy(true);
    try { const r = await loadRepoBranches(project.repoUrl); setInfo(r); setChoice(target.branch || r.default || ""); setErr(""); }
    catch (e) { setErr(errorMessage(e, "Could not read the branches.")); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    const same = choice === target.branch;
    if (!(await confirm(same
      ? { title: `Deploy “${choice}” again?`, message: `${target.name} is rebuilt from the same branch.`, confirmLabel: "Deploy" }
      : { title: `Switch ${target.name} to “${choice}”?`, message: `It currently builds from “${target.branch || "its current branch"}”. The switch deploys right away.`, confirmLabel: "Switch and deploy" }))) return;
    setBusy(true);
    try {
      const r = await setDeployBranch(projectId, target.ref, choice, true);
      toast.success(r.deployed ? `Deploying ${r.branch}.` : r.note || `Branch set to ${r.branch}.`);
      setInfo(null);
      onDone();
    } catch (e) { toast.error(errorMessage(e, "Could not change the branch.")); }
    finally { setBusy(false); }
  };
  if (!info) return (
    <div className="pdep__branch">
      <span>{target.branch || "default"}</span>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void open()} disabled={busy}>{busy ? "Reading…" : "Change"}</button>
      {err ? <small className="pdep__err">{err}</small> : null}
    </div>
  );
  if (!info.connected) return <small className="pdep__err">Connect GitHub to choose a branch.</small>;
  return (
    <div className="pdep__branch">
      <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={`Branch for ${target.name}`} disabled={busy}>
        {target.branch && !info.branches.includes(target.branch) ? <option value={target.branch}>{target.branch}</option> : null}
        {info.branches.map((b) => <option key={b} value={b}>{b}{b === info.default ? " (default)" : ""}</option>)}
      </select>
      <button type="button" className="btn btn--primary btn--sm" onClick={() => void apply()} disabled={busy || !choice}>{busy ? "Working…" : choice === target.branch ? "Redeploy" : "Switch and deploy"}</button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setInfo(null)} disabled={busy}>Cancel</button>
    </div>
  );
}

/** Deploy history and build/app logs for one server. Starts open when mounted; refreshes while open. */
export function DeployLogs({ projectId, target }) {
  const [deploys, setDeploys] = useState(null);
  const [lines, setLines] = useState(null);
  const [logError, setLogError] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const history = await getDeployHistory(projectId, target.ref);
      const list = history.deploys || [];
      setDeploys(list.slice(0, 8));
      setError("");
      try {
        const logs = await getDeployLogs(projectId, target.ref, list[0]?.id || "");
        setLines(logs.lines || []);
        setLogError("");
      } catch (e) { setLines([]); setLogError(errorMessage(e, "Could not read the logs.")); }
    } catch (e) { setError(errorMessage(e, "Could not read the deploys.")); }
  }, [projectId, target.ref]);
  useEffect(() => { void load(); const timer = setInterval(() => { if (!document.hidden && isUserActive()) void load(); }, 10000); return () => clearInterval(timer); }, [load]);

  const latest = deploys?.[0];
  const raw = String(latest?.status || "").toLowerCase();
  return (
    <div className="srvlogs">
      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}
      {!deploys && !error ? <p className="field__note">Reading from {target.label}…</p> : null}
      {deploys ? (
        <>
          {latest ? (
            <p className="srvlogs__now"><span className={"pdep__deploy is-" + (raw === "live" || raw === "ready" || raw === "success" || raw === "live" ? "ok" : /fail|error|cancel/.test(raw) ? "bad" : "mid")}>{DEPLOY_LABEL[raw] || raw}</span>{latest.commit ? <span>{latest.commit}</span> : null}<small>{timeAgo(latest.at)}{latest.sha ? " · " + latest.sha : ""}</small></p>
          ) : <p className="field__note">No deploys yet.</p>}
          {deploys.length ? (
            <ul className="srvlogs__deploys">
              {deploys.map((d) => (
                <li key={d.id || d.at}>
                  <span className={"pdep__deploy is-" + (/live|ready|success/.test(String(d.status)) ? "ok" : /fail|error|cancel/.test(String(d.status)) ? "bad" : "mid")}>{DEPLOY_LABEL[String(d.status).toLowerCase()] || d.status}</span>
                  <span>{String(d.commit || "").slice(0, 90) || "Deploy"}</span>
                  <small>{timeAgo(d.at)}{d.sha ? " · " + d.sha : ""}</small>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="field__label srvlogs__label">{target.provider === "render" ? "App logs (last 30 min)" : "Build and runtime logs"}</p>
          {logError ? <div className="notice notice--err" role="status">{logError}</div> : null}
          <pre className="srvlogs__log" aria-label="Logs">{lines === null ? "" : lines.length ? lines.map((l) => (l.at ? l.at.slice(11, 19) + " " : "") + l.text).join("\n") : logError ? "" : "No log lines yet."}</pre>
        </>
      ) : null}
    </div>
  );
}
