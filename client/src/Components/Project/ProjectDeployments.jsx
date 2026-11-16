import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { getDeployTargets, redeployDeployTarget, syncDeployEnv, unlinkHostSite } from "../../api/client";
import { usePolling } from "../../Pages/Render/renderHooks";
import { timeAgo, errorMessage } from "../../Pages/Render/renderUtils";
import ServerEnvCopy from "./ServerEnvCopy";
import ServerEnvMatch from "./ServerEnvMatch";
import EnvGroupSync from "./EnvGroupSync";
import RenderMatrix from "./RenderMatrix";
import MoveServerWizard from "./MoveServerWizard";
import { UrlMenu, SortTh, AccountPicker, BranchChange, DeployLogs, PlatformBadge, StatusPill } from "./DeployParts";
import "./ProjectDeployments.css";
import { useDialogs } from "../../Components/UI/Dialogs";

/* Sort keys for each column. */
const SORTERS = {
  name: (t) => String(t.name || "").toLowerCase(),
  platform: (t) => t.label,
  status: (t) => (t.suspended ? 2 : t.error && !t.url ? 3 : /fail|error/.test(String(t.latestDeploy?.status || "")) ? 1 : 0),
  branch: (t) => String(t.branch || ""),
  deploy: (t) => (t.latestDeploy?.at ? Date.parse(t.latestDeploy.at) : 0)
};

/** Every server of the project, on every hosting provider: account, URLs, status, branch, env comparison, logs and actions. */
export default function ProjectDeployments({ project, refreshKey, hideRefresh }) {
  const { confirm } = useDialogs();
  const [targets, setTargets] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [compare, setCompare] = useState(null); // ref -> env comparison against the main server
  const [comparing, setComparing] = useState(false);
  const [syncFrom, setSyncFrom] = useState(null);
  const [copyFor, setCopyFor] = useState(null);
  const [matchOpen, setMatchOpen] = useState(false);
  const [moveFor, setMoveFor] = useState(null);
  const [moveTargetAccountId, setMoveTargetAccountId] = useState("");
  const [moveTargetSnapshot, setMoveTargetSnapshot] = useState(null);
  const [openLogs, setOpenLogs] = useState(() => new Set());
  const [busyRef, setBusyRef] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try { setTargets((await getDeployTargets(project.id)).targets || []); setError(""); }
    catch (e) { if (!quiet) setError(errorMessage(e, "Could not read the deployments.")); }
    finally { if (!quiet) setLoading(false); }
  }, [project.id]);
  useEffect(() => { void load(); }, [load, (project.renderServices || []).length, (project.hostLinks || []).length]);
  useEffect(() => { if (refreshKey) void load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(() => load({ quiet: true }), 120000, true);

  const list = targets || [];
  const main = list.find((t) => t.main) || list[0];
  const sorted = useMemo(() => {
    const key = SORTERS[sort.key] || SORTERS.name;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => { const x = key(a), y = key(b); return x === y ? String(a.name).localeCompare(String(b.name)) : (x > y ? 1 : -1) * dir; });
  }, [list, sort]);
  const platforms = [...new Set(list.map((t) => t.label))];

  // Compare once the servers are known, so the differences are visible without pressing anything.
  const runCompare = async () => {
    if (!main) return;
    setComparing(true);
    try {
      const r = await syncDeployEnv(project.id, { apply: false, sourceRef: main.ref, allTargets: true });
      setCompare(Object.fromEntries(r.targets.map((t) => [t.ref, t])));
    } catch (e) { toast.error(errorMessage(e, "Could not compare the variables.")); }
    finally { setComparing(false); }
  };

  const unlink = async (t) => {
    if (!(await confirm({ title: `Unlink ${t.name}?`, message: "It is removed from this project only. The site itself is not touched.", confirmLabel: "Unlink" }))) return;
    try { await unlinkHostSite(project.id, t.ref.replace(/^host:/, "")); toast.success("Unlinked " + t.name + "."); void load({ quiet: true }); }
    catch (e) { toast.error(errorMessage(e, "Could not unlink.")); }
  };

  const redeploy = async (t) => {
    if (!(await confirm({ title: `Deploy ${t.name} now?`, message: `The latest commit is deployed on ${t.label}.`, confirmLabel: "Deploy" }))) return;
    setBusyRef(t.ref);
    try { await redeployDeployTarget(project.id, t.ref); toast.success("Deploy started on " + t.label + "."); void load({ quiet: true }); }
    catch (e) { toast.error(errorMessage(e, "Could not start the deploy.")); }
    finally { setBusyRef(""); }
  };

  useEffect(() => { if (!compare && main && list.length > 1 && !comparing) void runCompare(); }, [main?.ref, list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLogs = (ref) => setOpenLogs((old) => { const next = new Set(old); if (next.has(ref)) next.delete(ref); else next.add(ref); return next; });
  const running = list.filter((t) => !t.suspended && !(t.error && !t.url)).length;
  const branches = new Set(list.map((t) => t.branch).filter(Boolean)).size;

  const envCell = (t) => {
    const c = compare?.[t.ref];
    if (!compare) return <button type="button" className="btn btn--ghost btn--sm" onClick={() => void runCompare()} disabled={comparing || !main}>{comparing ? "Comparing…" : "Compare"}</button>;
    if (t.main) return <span className="pdep__dim">main</span>;
    if (!c) return <span className="pdep__dim">—</span>;
    if (c.error) return <small className="pdep__err" title={c.error}>{c.error}</small>;
    return (
      <span className="pdep__envcell" title={[c.create.length && "new: " + c.create.join(", "), c.update.length && "different: " + c.update.join(", "), c.unreadable.length && "hidden by " + t.label + ": " + c.unreadable.join(", ")].filter(Boolean).join("\n")}>
        <b className="is-add">+{c.create.length}</b><b className="is-change">~{c.update.length}</b><span>{c.same} same</span>
        {c.unreadable.length ? <small>{c.unreadable.length} hidden</small> : null}
      </span>
    );
  };

  return (
    <section className="card pdep" aria-label="Deployments">
      <header className="pdep__head">
        <div>
          <h2>Deployments</h2>
          <p>{loading && !targets ? "Reading every server…" : `${list.length} server${list.length === 1 ? "" : "s"} on ${platforms.length || 0} platform${platforms.length === 1 ? "" : "s"} · ${running} running · ${branches} branch${branches === 1 ? "" : "es"}`}</p>
        </div>
        <div className="pdep__actions">
          {main ? <button type="button" className="btn btn--primary btn--sm" disabled={list.length < 2} title={list.length < 2 ? "Link a second server to sync variables between servers" : "Copy variables from the main server to the others"} onClick={() => setSyncFrom(main.ref)}>Sync env across servers</button> : null}
          {hideRefresh ? null : <button type="button" className="btn btn--ghost btn--sm" disabled={loading} onClick={() => void load()}>{loading ? "Reading…" : "↻ Refresh"}</button>}
        </div>
      </header>
      {error ? <div className="notice notice--err" role="alert">{error}</div> : null}

      {list.length > 0 && (
        <div className="pdep__scroll">
          <table className="pdep__table pdep__servers">
            <thead><tr>
              <SortTh id="name" label="Server" sort={sort} onSort={setSort} />
              <th>URL</th>
              <SortTh id="status" label="Status" sort={sort} onSort={setSort} />
              <SortTh id="deploy" label="Last deploy" sort={sort} onSort={setSort} />
              <SortTh id="branch" label="Branch" sort={sort} onSort={setSort} />
              <th>Env vs main</th>
              <th />
            </tr></thead>
            <tbody>
              {sorted.map((t) => {
                const logsOpen = openLogs.has(t.ref);
                return (
                  <React.Fragment key={t.ref}>
                    <tr className={t.suspended ? "is-suspended" : ""}>
                      <td>
                        <strong>{t.name}</strong>
                        <div><PlatformBadge target={t} /></div>
                        <AccountPicker projectId={project.id} target={t} onDone={() => void load({ quiet: true })} onMove={(accountId) => { setMoveTargetAccountId(accountId); setMoveTargetSnapshot(t); setMoveFor(t.ref); }} />
                      </td>
                      <td><UrlMenu urls={[t.url]} /></td>
                      <td><StatusPill target={t} />{t.error ? <small className="pdep__err">{t.error}</small> : null}</td>
                      <td>{t.latestDeploy ? <><span className={"pdep__deploy is-" + (/live|ready|success/.test(t.latestDeploy.status) ? "ok" : /fail|error|cancel/.test(t.latestDeploy.status) ? "bad" : "mid")}>{t.latestDeploy.status}</span><small>{timeAgo(t.latestDeploy.at)}{t.latestDeploy.sha ? " · " + t.latestDeploy.sha : ""}</small></> : <span className="pdep__dim">—</span>}</td>
                      <td><BranchChange projectId={project.id} project={project} target={t} onDone={() => void load({ quiet: true })} /></td>
                      <td>{envCell(t)}</td>
                      <td>
                        <div className="pdep__branch">
                          <button type="button" className="btn btn--ghost btn--sm" aria-expanded={logsOpen} onClick={() => toggleLogs(t.ref)}>{logsOpen ? "Hide logs" : "Logs"}</button>
                          {t.capabilities?.env ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCopyFor(t.ref)}>Copy env</button> : null}
                          {t.capabilities?.env && list.length > 1 ? <button type="button" className="btn btn--ghost btn--sm" title="Make every server of this project carry the same, freshest env" onClick={() => setMatchOpen(true)}>Sync env</button> : null}
                          <button type="button" className="btn btn--ghost btn--sm" disabled={busyRef === t.ref} onClick={() => void redeploy(t)}>{busyRef === t.ref ? "Deploying…" : "Redeploy"}</button>
                          {t.provider !== "render" ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => void unlink(t)}>Unlink</button> : <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setMoveTargetAccountId(""); setMoveTargetSnapshot(t); setMoveFor(t.ref); }}>Move to account</button>}
                          {t.dashboardUrl ? <a href={t.dashboardUrl} target="_blank" rel="noopener noreferrer" aria-label={"Open " + t.name + " on " + t.label}>{t.label} ↗</a> : null}
                        </div>
                      </td>
                    </tr>
                    {logsOpen ? <tr className="pdep__logrow"><td colSpan={7}><DeployLogs projectId={project.id} target={t} /></td></tr> : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && targets && !list.length && !error ? <p className="pdep__dim">This project has no linked server yet. Link one from Hosting or Render below.</p> : null}

      {list.some((t) => t.provider === "render") ? <RenderMatrix project={project} /> : null}

      {syncFrom ? <EnvGroupSync projectId={project.id} targets={list} initialSource={syncFrom} open={Boolean(syncFrom)} onClose={() => setSyncFrom(null)} onDone={() => { setCompare(null); void load({ quiet: true }); }} /> : null}
      {moveFor ? <MoveServerWizard projectId={project.id} target={list.find((t) => t.ref === moveFor) || moveTargetSnapshot} initialTargetAccountId={moveTargetAccountId} open={Boolean(moveFor)} onClose={() => { setMoveFor(null); setMoveTargetAccountId(""); setMoveTargetSnapshot(null); }} onDone={() => { setCompare(null); void load({ quiet: true }); }} /> : null}
      {matchOpen ? <ServerEnvMatch projectId={project.id} open={matchOpen} onClose={() => setMatchOpen(false)} onDone={() => { setCompare(null); void load({ quiet: true }); }} /> : null}
      {copyFor ? <ServerEnvCopy projectId={project.id} target={list.find((t) => t.ref === copyFor)} targets={list} open={Boolean(copyFor)} onClose={() => setCopyFor(null)} onDone={() => { setCompare(null); void load({ quiet: true }); }} /> : null}
    </section>
  );
}
