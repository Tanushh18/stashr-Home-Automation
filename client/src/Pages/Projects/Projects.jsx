import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import useShortcuts from "../../hooks/useShortcuts";
import ProjectCard from "../../Components/Project/ProjectCard";
import ProjectImportModal from "../../Components/Project/ProjectImportModal";
import GithubConnectModal from "../../Components/Project/GithubConnectModal";
import { toast } from "react-toastify";
import { getGithubAccounts, getProjectStatuses, autoSyncProjects, mergeProjects } from "../../api/client";
import { usePolling } from "../Render/renderHooks";
import { timeAgo } from "../Render/renderUtils";
import { repoKeyOf } from "../Render/renderUtils";
import { TreeLeaf } from "../../Components/Project/ProjectTree";
import { Globe, Plus, Search, Grid, Alert, Upload, Refresh } from "../../Components/Icons/Icons";
import { PageHeader, EmptyState, Badge } from "../../Components/UI/ui";
import { useVault } from "../../state/vault";
import { STATUS_LABEL } from "../../lib/projectItems";
import { searchProjects } from "../../lib/projectTree";
import "../Passwords/Passwords.css";
import "../../Components/Project/ProjectTree.css";
import "./Projects.css";

import MascotBanner from "../../Components/Robot/MascotBanner";
import { projectsMood } from "../../lib/pageMoods";
import { useDialogs } from "../../Components/UI/Dialogs";
const STATUSES = ["planning", "in_progress", "deployed", "broken", "paused", "archived"];

export default function Projects() {
  const { confirm } = useDialogs();
  const { projects, projectsBroken, importProjects, prefs, refreshProfile } = useVault();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("__active"); // __active = everything except archived
  const [source, setSource] = useState("any"); // any | github | render | manual
  const [platform, setPlatform] = useState("all"); // all | Render | Vercel | ... (where the project is hosted)
  const [sortBy, setSortBy] = useState("recent"); // recent | name | status | platform
  const [view, setView] = useState("all"); // all | values | projects (while searching)
  const [importing, setImporting] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubAccounts, setGithubAccounts] = useState(null);
  const refreshRef = useRef(refreshProfile);
  refreshRef.current = refreshProfile;
  const [statuses, setStatuses] = useState({}); // projectId -> live status (auto-loaded, no buttons)
  useEffect(() => { getGithubAccounts().then((r) => setGithubAccounts(r.accounts || [])).catch(() => setGithubAccounts(null)); }, []);
  // Health, drift and auto-linking are computed server-side; the list just reads them when it opens.
  useEffect(() => {
    let live = true;
    getProjectStatuses().then((data) => {
      if (!live) return;
      setStatuses(Object.fromEntries((data.statuses || []).map((st) => [st.projectId, st])));
      if (data.linkedNow?.length) void refreshRef.current?.();
    }).catch(() => { /* badges are optional */ });
    return () => { live = false; };
  }, []);
  const [syncing, setSyncing] = useState(false);
  const [sync, setSync] = useState(null); // last automatic sync result
  const [syncFailed, setSyncFailed] = useState(false);
  // Same GitHub repo = same app. Offer to merge (e.g. one repo deployed several times on Render).
  const duplicates = useMemo(() => {
    const groups = new Map();
    for (const p of projects) { const k = repoKeyOf(p.repoUrl); if (!k) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    return [...groups.entries()].filter(([, list]) => list.length > 1).map(([repo, list]) => ({ repo, list }));
  }, [projects]);
  const reloadStatuses = async () => {
    const data = await getProjectStatuses({ refresh: true });
    setStatuses(Object.fromEntries((data.statuses || []).map((st) => [st.projectId, st])));
  };
  const mergeGroup = async (group) => {
    if (!(await confirm({ title: `Merge ${group.list.length} projects for ${group.repo}?`, details: group.list.map((p) => p.name), message: "The one with the most details is kept; the others fill in anything it’s missing. Every linked Render service stays linked.", confirmLabel: "Merge" }))) return;
    try {
      const r = await mergeProjects(group.list.map((p) => String(p.id)));
      await refreshProfile();
      toast.success("Merged into one project." + (r.conflicts?.length ? " Kept the main project’s value for: " + r.conflicts.join(", ") : ""));
      void reloadStatuses();
    } catch (e) { toast.error(e?.response?.data?.error || "Could not merge."); }
  };
  // Automatic sync with GitHub + Render. The server throttles it, so opening the page and polling are cheap.
  const runSync = async (force = false) => {
    setSyncing(true);
    try {
      const r = await autoSyncProjects(force);
      setSync(r); setSyncFailed(false);
      const changed = (r.created?.length || 0) + (r.archived || 0) + (r.revived || 0) + (r.refreshed || 0) + (r.derived || 0);
      if (changed) { await refreshRef.current?.(); void reloadStatuses(); }
      if (!r.throttled && r.created?.length) toast.success(r.created.length + " project" + (r.created.length === 1 ? "" : "s") + " added from GitHub/Render" + (r.created.length <= 3 ? ": " + r.created.join(", ") : "") + ".");
      if (force && !changed) toast.success("Already up to date.");
    } catch { setSyncFailed(true); if (force) toast.error("Could not sync right now."); }
    finally { setSyncing(false); }
  };
  useEffect(() => { void runSync(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing connected: there is nothing to sync, so do not ask the server every 2 minutes (it only repeats the same empty answer).
  const nothingConnected = Boolean(sync) && !(sync.github?.accounts || 0) && !(sync.render?.accounts || 0);
  usePolling(() => runSync(), 120000, !nothingConnected);
  const navigate = useNavigate();
  const searchRef = useShortcuts(() => navigate("/projects/new"));

  const sourceOf = (p) => p.autoSource || "manual";
  const platformOf = (p) => p.hostingProvider || (p.renderServiceId || (p.renderServices || []).length ? "Render" : "");
  const platforms = useMemo(() => {
    const counts = new Map();
    for (const p of projects) { const k = platformOf(p); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [projects]);
  const byStatus = useMemo(() => projects.filter((p) =>
    (status === "__all" || (status === "__active" ? p.status !== "archived" : p.status === status)) && (source === "any" || sourceOf(p) === source) && (platform === "all" || platformOf(p) === platform)), [projects, status, source, platform]);
  const tiles = useMemo(() => ({
    active: projects.filter((p) => p.status !== "archived").length,
    deployed: projects.filter((p) => p.status === "deployed").length,
    auto: projects.filter((p) => p.autoSource).length,
    archived: projects.filter((p) => p.status === "archived").length
  }), [projects]);

  const results = useMemo(() => {
    const r = searchProjects(byStatus, search);
    const recent = (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    const sorters = {
      recent,
      name: (a, b) => String(a.name).localeCompare(String(b.name)),
      status: (a, b) => String(a.status || "").localeCompare(String(b.status || "")) || String(a.name).localeCompare(String(b.name)),
      platform: (a, b) => platformOf(a).localeCompare(platformOf(b)) || String(a.name).localeCompare(String(b.name))
    };
    return { projects: [...r.projects].sort(sorters[sortBy] || recent), values: r.values };
  }, [byStatus, search, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const searching = search.trim().length > 0;
  const showValues = searching && view !== "projects" && results.values.length > 0;
  const showProjects = !searching || view !== "values";
  const visible = results.projects;

  return (
    <div className="vault page">
      <div className="shell">
        <PageHeader
          title="Projects"
          subtitle={projects.length === 0
            ? "Hosting, databases, accounts and environment variables for the apps you run, encrypted like your passwords."
            : `${tiles.active} active project${tiles.active === 1 ? "" : "s"}${tiles.archived ? ` · ${tiles.archived} archived` : ""} · encrypted`}
          actions={
            <>
              <button className="btn btn--quiet btn--sm" onClick={() => setGithubOpen(true)} title="Connect a GitHub token to fetch commits, pull requests and CI for each project">
                GitHub{githubAccounts ? <Badge tone={githubAccounts.length ? "ok" : "neutral"} className="pv2-ghbadge">{githubAccounts.length ? githubAccounts.length + " connected" : "not connected"}</Badge> : null}
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setImporting(true)}><Upload size={14} /> Import</button>
              <Link className="btn btn--ghost btn--sm" to="/projects/deploy" title="Create a GitHub repo and deploy it on Render's free plan in one step">Create &amp; deploy</Link>
              <Link className="btn btn--primary btn--sm" to="/projects/new"><Plus size={14} /> New project <kbd className="kbd">N</kbd></Link>
            </>
          }
        />
        <MascotBanner kind="rocket" {...projectsMood(projects, statuses)} />

        <section className={"pv2-sync" + (syncFailed ? " is-error" : "")} aria-live="polite">
          <span className={"pv2-sync__dot" + (syncing ? " is-busy" : "")} aria-hidden="true" />
          <div className="pv2-sync__text">
            <strong>{syncing ? "Syncing with GitHub and Render…" : syncFailed ? "Couldn’t reach GitHub or Render" : nothingConnected ? "Auto-sync is waiting for an account" : "Auto-sync is on"}</strong>
            <small>
              {nothingConnected ? "Connect GitHub or Render and new repos and servers become projects by themselves." : null}
              {nothingConnected ? null : sync?.checkedAt ? "Last synced " + timeAgo(sync.checkedAt) + " · " : ""}
              {nothingConnected ? null : sync ? `GitHub ${sync.github?.repos ?? 0} repo${sync.github?.repos === 1 ? "" : "s"} · Render ${sync.render?.services ?? 0} service${sync.render?.services === 1 ? "" : "s"}` : "New repos and servers are added automatically."}
              {nothingConnected ? null : sync?.github?.failed ? " · a GitHub token failed — reconnect it" : ""}
            </small>
          </div>
          {githubAccounts && !githubAccounts.length ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => setGithubOpen(true)}>Connect GitHub to import repos</button> : null}
          <button type="button" className="btn btn--ghost btn--sm" disabled={syncing} onClick={() => void runSync(true)}><Refresh size={14} /> {syncing ? "Syncing…" : "Sync now"}</button>
        </section>

        <div className="pv2-tiles">
          {[
            ["active", "Active projects", tiles.active, "__active", "Everything not archived"],
            ["deployed", "Live", tiles.deployed, "deployed", "Deployed on Render"],
            ["auto", "Auto-synced", tiles.auto, "__all", "From GitHub and Render"],
            ["archived", "Archived", tiles.archived, "archived", "Repo gone or archived"]
          ].map(([id, label, value, target, hint]) => (
            <button key={id} type="button" className={"pv2-tile" + (status === target && (id !== "auto" || source !== "any") ? " is-active" : "")}
              onClick={() => { setStatus(target); setSource(id === "auto" ? "github" : "any"); }} title={hint}>
              <span>{label}</span><b>{value}</b><small>{hint}</small>
            </button>
          ))}
        </div>

        {projectsBroken ? (
          <div className="notice notice--err vault__notice">
            <Alert size={15} /> {projectsBroken} project{projectsBroken === 1 ? "" : "s"} couldn't be decrypted with this key and {projectsBroken === 1 ? "is" : "are"} hidden.
          </div>
        ) : null}

        {platforms.length ? (
          <nav className="pv2-platforms" aria-label="Filter by platform">
            <span className="pv2-platforms__label">Platform</span>
            <button type="button" className={"folder-chip " + (platform === "all" ? "is-active" : "")} onClick={() => setPlatform("all")}>All <span>{projects.length}</span></button>
            {platforms.map(([name, count]) => (
              <button key={name} type="button" className={"folder-chip " + (platform === name ? "is-active" : "")} aria-pressed={platform === name} onClick={() => setPlatform(name)}>{name} <span>{count}</span></button>
            ))}
            <label className="pv2-platforms__sort">Sort
              <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort projects">
                <option value="recent">Recently updated</option>
                <option value="name">Name</option>
                <option value="status">Status</option>
                <option value="platform">Platform</option>
              </select>
            </label>
          </nav>
        ) : null}

        <div className="vault__tools">
          <div className="vault__search field__wrap">
            <span className="vault__search-icon"><Search size={17} /></span>
            <input
              className="input vault__search-input"
              type="search"
              ref={searchRef}
              placeholder="Search projects, variables (e.g. MONGO_URI) and values…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search your projects and their variables"
            />
          </div>
        </div>

        {duplicates.map((group) => (
          <div key={group.repo} className="notice vault__notice" role="status">
            <Alert size={15} /> {group.list.length} projects use the same repo <strong>{group.repo}</strong> ({group.list.map((p) => p.name).join(", ")}).
            <button type="button" className="btn btn--primary btn--sm" style={{ marginLeft: 8 }} onClick={() => void mergeGroup(group)}>Merge into one</button>
          </div>
        ))}

        <nav className="folders" aria-label="Filters">
          {searching ? (
            <>
              <button type="button" className={`folder-chip ${view === "all" ? "is-active" : ""}`} onClick={() => setView("all")}>
                All results
              </button>
              <button type="button" className={`folder-chip ${view === "values" ? "is-active" : ""}`} onClick={() => setView("values")}>
                Values <span>{results.values.length}</span>
              </button>
              <button type="button" className={`folder-chip ${view === "projects" ? "is-active" : ""}`} onClick={() => setView("projects")}>
                Projects <span>{results.projects.length}</span>
              </button>
              <span className="folders__sep" />
            </>
          ) : null}
          <button type="button" className={`folder-chip ${status === "__active" ? "is-active" : ""}`} onClick={() => setStatus("__active")}>
            <Grid size={13} /> Active <span>{tiles.active}</span>
          </button>
          {STATUSES.map((st) => {
            const count = projects.filter((p) => p.status === st).length;
            if (!count) return null;
            return (
              <button key={st} type="button" className={`folder-chip ${status === st ? "is-active" : ""}`} onClick={() => setStatus(st)}>
                {STATUS_LABEL[st]} <span>{count}</span>
              </button>
            );
          })}
          <button type="button" className={`folder-chip ${status === "__all" ? "is-active" : ""}`} onClick={() => setStatus("__all")}>
            All <span>{projects.length}</span>
          </button>
          <span className="folders__sep" />
          <span className="pv2-segment" role="group" aria-label="Source">
            {[["any", "Any source"], ["github", "GitHub"], ["render", "Render"], ["manual", "Manual"]].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={source === id} className={source === id ? "is-active" : ""} onClick={() => setSource(id)}>{label}</button>
            ))}
          </span>
        </nav>

        {showValues ? (
          <section className="card proj-values" aria-label="Matching values">
            <h2 className="proj-values__title">Values matching “{search.trim()}”</h2>
            {results.values.slice(0, 50).map((hit, i) => (
              <div key={`${hit.project.id}-${i}`} className="proj-values__row">
                <Link to={`/projects/${hit.project.id}`} className="proj-values__project">{hit.project.name}</Link>
                <TreeLeaf node={hit.field} showPath={hit.field.path.join(" › ")} reveal={prefs.searchValues !== false} />
              </div>
            ))}
            {results.values.length > 50 ? <p className="field__note">Showing the first 50. Type more to narrow it down.</p> : null}
          </section>
        ) : null}

        {projects.length === 0 ? (
          <EmptyState
            icon={<Globe size={24} />}
            title="No projects yet"
            actions={
              <>
                <Link className="btn btn--primary" to="/projects/new"><Plus size={15} /> Add your first project</Link>
                <button className="btn btn--ghost" onClick={() => setGithubOpen(true)}>Connect GitHub</button>
                <button className="btn btn--ghost" onClick={() => setImporting(true)}><Upload size={15} /> Import from Excel</button>
              </>
            }
          >
            Connect GitHub or Render and new repos and services become projects automatically. Or add one by hand with its hosting, database, accounts and env vars.
          </EmptyState>
        ) : searching && !visible.length && !results.values.length ? (
          <EmptyState compact icon={<Search size={22} />} title={<>Nothing matches “{search}”</>} actions={<button className="btn btn--ghost" onClick={() => { setSearch(""); setStatus("__all"); setSource("any"); }}>Clear search and filters</button>}>
            Search looks at project names, variable names and their values.
          </EmptyState>
        ) : showProjects && visible.length ? (
          <>
            {searching ? <h2 className="proj-values__title proj-list__title">Projects</h2> : null}
            <div className="vault__grid">
              {visible.map((project) => (
                <ProjectCard key={project.id} project={project} status={statuses[String(project.id)]} />
              ))}
            </div>
          </>
        ) : null}
      </div>

      <GithubConnectModal open={githubOpen} onClose={() => setGithubOpen(false)} onChange={(list) => { setGithubAccounts(list); if (list && list.length) void runSync(true); }} />
      <ProjectImportModal open={importing} onClose={() => setImporting(false)} onImport={importProjects} />
    </div>
  );
}
