import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import Field from "../../Components/Field/Field";
import GithubConnectModal from "../../Components/Project/GithubConnectModal";
import EnvImport from "../../Components/Project/EnvImport";
import EnvText from "../../Components/Project/EnvText";
import RepoPicker from "../../Components/Project/RepoPicker";
import { DeployLogs } from "../../Components/Project/DeployParts";
import HostConnectModal from "../../Components/Project/HostConnectModal";
import { HOSTS, hostById } from "../../lib/hostGuides";
import { Arrow, Check, Copy, Plus, Trash, Alert } from "../../Components/Icons/Icons";
import { useVault } from "../../state/vault";
import { parseEnvBlock } from "../../lib/projectItems";
import { checkRepoCode, createRepo, deployProject, deployToHost, getGithubAccounts, getGithubBranches, getHostAccounts, getRenderAccounts, getRenderOwners, syncProjectServers } from "../../api/client";
import "../Passwords/Passwords.css";
import "./Projects.css";

const TEMPLATES = [
  ["nextjs", "Next.js", "App Router starter with a /health route. Auto-deploys on every push."],
  ["react", "React (Vite)", "Static single-page app, built and hosted for free."],
  ["vue", "Vue (Vite)", "Static single-page app, built and hosted for free."],
  ["svelte", "Svelte (Vite)", "Static single-page app, built and hosted for free."],
  ["astro", "Astro", "Static site, built and hosted for free."],
  ["node", "Node.js (Express)", "Starter server with a /health check. Ready to deploy."],
  ["python", "Python (FastAPI)", "Starter API with a /health check. Ready to deploy."],
  ["flask", "Python (Flask)", "Starter API served by gunicorn, with a /health check."],
  ["go", "Go", "Starter net/http server with a /health check."],
  ["docker", "Docker (any language)", "Dockerfile starter. Swap in PHP/Laravel, Java/Spring, .NET, Rails, Rust..."],
  ["static", "Static site", "A plain index.html, hosted for free."],
  ["empty", "Empty repo", "Creates an empty repo and shows the git commands to push your own code."],
  ["existing", "Existing repo", "Deploy a GitHub repository you already have, with a framework preset."]
];
// Keep in sync with server/utils/templates.js. "Bring your own code" presets: build/start commands per stack.
const RUNTIMES = {
  node: { label: "Node.js (Express, Fastify, ...)", build: "npm install", start: "npm start" },
  nextjs: { label: "Next.js", build: "npm install && npm run build", start: "npm start" },
  nuxt: { label: "Nuxt", build: "npm install && npm run build", start: "node .output/server/index.mjs" },
  sveltekit: { label: "SvelteKit (adapter-node)", build: "npm install && npm run build", start: "node build" },
  remix: { label: "Remix / React Router", build: "npm install && npm run build", start: "npm start" },
  nestjs: { label: "NestJS", build: "npm install && npm run build", start: "node dist/main" },
  python: { label: "Python (FastAPI)", build: "pip install -r requirements.txt", start: "uvicorn app.main:app --host 0.0.0.0 --port $PORT" },
  flask: { label: "Python (Flask)", build: "pip install -r requirements.txt", start: "gunicorn app:app --bind 0.0.0.0:$PORT" },
  django: { label: "Python (Django)", build: "pip install -r requirements.txt && python manage.py collectstatic --noinput", start: "gunicorn config.wsgi:application --bind 0.0.0.0:$PORT" },
  go: { label: "Go", build: "go build -tags netgo -ldflags '-s -w' -o app", start: "./app" },
  rails: { label: "Ruby on Rails", build: "bundle install && bundle exec rake assets:precompile", start: "bundle exec rails server -b 0.0.0.0" },
  rust: { label: "Rust", build: "cargo build --release", start: "cargo run --release" },
  docker: { label: "Docker (PHP/Laravel, Java/Spring, .NET, ...)", build: "", start: "", needsDockerfile: true },
  vite: { label: "React / Vue / Svelte (Vite) — static", build: "npm install && npm run build", start: "", isStatic: true },
  cra: { label: "React (Create React App) — static", build: "npm install && npm run build", start: "", isStatic: true },
  angular: { label: "Angular — static", build: "npm install && npm run build && mkdir -p site && cp -r dist/*/browser/. site/", start: "", isStatic: true },
  astro: { label: "Astro — static", build: "npm install && npm run build", start: "", isStatic: true },
  static: { label: "Static site", build: "", start: "", isStatic: true },
  elixir: { label: "Elixir (Phoenix)", build: "mix deps.get --only prod && mix compile", start: "mix phx.server" },
  bun: { label: "Bun (needs a Dockerfile)", build: "", start: "", needsDockerfile: true },
  deno: { label: "Deno (needs a Dockerfile)", build: "", start: "", needsDockerfile: true }
};
// Which preset a starter template deploys with.
const TEMPLATE_PRESET = { nextjs: "nextjs", react: "vite", vue: "vite", svelte: "vite", astro: "astro", node: "node", python: "python", flask: "flask", go: "go", docker: "docker", static: "static" };
const REGIONS = ["singapore", "oregon", "ohio", "virginia", "frankfurt"];
// What an existing repository deploys: its server folder, its client folder, or both at once.
const SCOPES = [["server", "Server only", "The API or back end, with its own folder."], ["client", "Client only", "The front end, as a static site."], ["both", "Server + client", "Both from one repository, at the same time."]];
const SCOPE_NOTE = {
  server: "Deploys the server folder of this repository. Pick where it runs under Hosting.",
  client: "Deploys the client folder as a static site. Pick the host under Hosting.",
  both: "The server goes to Render. The client goes to the host you pick under Hosting (Render serves it as a static site by default)."
};
const slug = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").replace(/-{2,}/g, "-").slice(0, 60);
const errorOf = (e, fallback) => {
  const data = e?.response?.data?.error;
  if (data) return data;
  const status = e?.response?.status;
  if (!e?.response) return fallback + " The server could not be reached; check your connection and try again.";
  if (status === 429) return fallback + " Too many requests; wait a moment and try again.";
  if (status >= 500) return fallback + " The server had a problem (" + status + "); try again shortly.";
  return fallback;
};

function Copyable({ text, label }) {
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast.success("Copied."); } catch { toast.error("Clipboard is not available."); } };
  return <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copy()} aria-label={"Copy " + label}><Copy size={13} /> {label}</button>;
}

/** Create a GitHub repo, deploy it on Render's FREE plan with env vars, and link a Stashr project — in one go. */
export default function ProjectDeploy() {
  const { refreshProfile, projects } = useVault();
  const [github, setGithub] = useState(null);
  const [render, setRender] = useState(null);
  const [owners, setOwners] = useState([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [host, setHost] = useState("render"); // render | vercel | netlify | railway | cloudflare (the server's host when deploying both)
  const [clientHost, setClientHost] = useState("render"); // the client's host when deploying both
  const [clientModal, setClientModal] = useState(false);
  const [hostAccounts, setHostAccounts] = useState(null);
  const [hostModal, setHostModal] = useState(false);
  const [pre, setPre] = useState({ status: "idle", branches: [], default: "", message: "" }); // branches of the repo URL typed above, loaded before "Check repository"
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [repo, setRepo] = useState(null); // the repository once it exists (created here, or an existing one)
  const [codeState, setCodeState] = useState({ status: "idle" }); // idle | checking | empty | ready | error
  const [wait, setWait] = useState(false);
  const [form, setForm] = useState({
    name: "", description: "", template: "node", existingRepoUrl: "", branch: "", rootDir: "", hostAccountId: "", hostBuild: "", hostOutput: "", visibility: "public", githubAccountId: "", renderAccountId: "", ownerId: "",
    region: "singapore", runtime: "node", buildCommand: RUNTIMES.node.build, startCommand: RUNTIMES.node.start, envVars: [], useExistingRepo: false,
    deployScope: "server", clientRootDir: "", clientRuntime: "vite"
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const loadGithub = () => getGithubAccounts().then((r) => setGithub(r.accounts || [])).catch(() => setGithub([]));
  const loadHosts = () => getHostAccounts().then((r) => setHostAccounts(r.accounts || [])).catch(() => setHostAccounts([]));
  useEffect(() => { void loadHosts(); }, []);
  const hostChoices = (hostAccounts || []).filter((a) => a.provider === host);
  const clientChoices = (hostAccounts || []).filter((a) => a.provider === clientHost);
  useEffect(() => { if (host !== "render" && !hostChoices.some((a) => a.id === form.hostAccountId)) set({ hostAccountId: hostChoices[0]?.id || "" }); }, [host, hostAccounts]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadGithub(); getRenderAccounts().then((r) => setRender(r.accounts || [])).catch(() => setRender([])); }, []);

  const writable = useMemo(() => (github || []).filter((a) => a.valid !== false && a.write), [github]);
  useEffect(() => { if (!form.githubAccountId && writable.length) set({ githubAccountId: writable[0].id }); }, [writable]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!form.renderAccountId && render?.length) set({ renderAccountId: render[0].id }); }, [render]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!form.renderAccountId) { setOwners([]); return undefined; }
    let live = true;
    getRenderOwners(form.renderAccountId).then((r) => { if (live) { setOwners(r.owners || []); set({ ownerId: r.owners?.length === 1 ? r.owners[0].id : "" }); } }).catch(() => { if (live) setOwners([]); });
    return () => { live = false; };
  }, [form.renderAccountId]);

  useEffect(() => {
    const url = form.existingRepoUrl.trim();
    if (form.template !== "existing" || !form.githubAccountId || !/github\.com[/:][\w.-]+\/[\w.-]+/i.test(url)) { setPre({ status: "idle", branches: [], default: "", message: "" }); return undefined; }
    let live = true;
    setPre((p) => ({ ...p, status: "loading", message: "" }));
    const timer = setTimeout(() => {
      getGithubBranches(form.githubAccountId, url)
        .then((d) => { if (live) setPre({ status: "ready", branches: (d.branches || []).map((b) => b.name), default: d.default || "", rootHint: "", message: "" }); })
        .catch((e) => { if (live) setPre({ status: "error", branches: [], default: "", message: errorOf(e, e?.response ? "Could not read the branches." : "Could not reach the server to read the branches. Check your connection and try again.") + " You can still check the repository; it will use the default branch." }); });
    }, 600);
    return () => { live = false; clearTimeout(timer); };
  }, [form.existingRepoUrl, form.githubAccountId, form.template]);

  const ownCode = form.template === "empty" || form.template === "existing";
  const isStatic = Boolean(RUNTIMES[form.runtime]?.isStatic);
  const scope = form.template === "existing" ? form.deployScope : "server"; // only an existing repo can split into server and client
  useEffect(() => { if (scope === "both" && clientHost !== "render" && !clientChoices.some((a) => a.id === form.clientHostAccountId)) set({ clientHostAccountId: clientChoices[0]?.id || "" }); }, [clientHost, hostAccounts, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const clientOnRender = scope === "both" ? clientHost === "render" : host === "render";
  const renderPart = host === "render" || clientOnRender; // a Render service is part of this deploy
  const deployLabel = scope === "both" ? "Deploy server + client" : "Deploy to " + (host === "render" ? "Render" : hostById(host).label);
  const repoName = slug(form.name);
  const ready = form.name.trim() && repoName && form.githubAccountId && (renderPart ? form.renderAccountId && (owners.length < 2 || form.ownerId) : true) && (host !== "render" ? form.hostAccountId : true) && (scope === "both" && clientHost !== "render" ? form.clientHostAccountId : true) && (form.template !== "existing" || form.existingRepoUrl.trim());

  const pickTemplate = (template) => {
    const preset = TEMPLATE_PRESET[template];
    set({ template, useExistingRepo: template === "existing", ...(preset ? { runtime: preset, buildCommand: RUNTIMES[preset].build, startCommand: RUNTIMES[preset].start } : {}) });
  };
  const pickRuntime = (runtime) => set({ runtime, buildCommand: RUNTIMES[runtime].build, startCommand: RUNTIMES[runtime].start });
  const setEnv = (i, patch) => set({ envVars: form.envVars.map((row, idx) => (idx === i ? { ...row, ...patch } : row)) });
  const applyPaste = () => {
    const parsed = parseEnvBlock(pasteText);
    if (!parsed.length) { toast.error("Couldn't find any KEY=VALUE lines in that."); return; }
    const existing = new Set(form.envVars.map((v) => v.name));
    set({ envVars: [...form.envVars, ...parsed.filter((p) => !existing.has(p.name)).map((p) => ({ name: p.name, value: p.value }))] });
    setPasteText("");
    toast.success(parsed.length + " variable" + (parsed.length === 1 ? "" : "s") + " added.");
  };

  const privateChosen = form.visibility === "private" && form.template !== "existing";
  const locked = Boolean(repo); // the project / GitHub choices are fixed once the repository exists

  /* Step 1: create the (public) repository, or just point at an existing one. */
  const submit = async (event) => {
    event?.preventDefault();
    if (!ready || busy || privateChosen) return;
    setBusy(true); setError(""); setResult(null);
    try {
      if (form.template === "existing") {
        setRepo({ url: form.existingRepoUrl.trim(), existing: true });
        setCodeState({ status: "idle" });
        void checkCode(form.existingRepoUrl.trim());
      } else {
        const data = await createRepo({ ...form, repoName, visibility: "public" });
        setRepo({ ...data.repo, hasStarter: data.hasStarter });
        setCodeState(data.hasStarter ? { status: "ready" } : { status: "empty" });
        toast.success("Repository created. Now push your code.");
        setWait(!data.hasStarter);
      }
    } catch (e) { setError(errorOf(e, "Could not create the repository.")); } finally { setBusy(false); }
  };

  /* Step 2: has any code arrived in the repository? */
  const checkCode = useCallback(async (url, branch = form.branch) => {
    setCodeState((old) => (old.status === "ready" && !branch ? old : { status: "checking", branches: old.branches, default: old.default }));
    try {
      const data = await checkRepoCode({ githubAccountId: form.githubAccountId, repoUrl: url, branch: branch || undefined });
      setCodeState({ status: data.hasCode ? "ready" : "empty", branch: data.branch, branches: data.branches || [], default: data.default, rootHint: data.rootHint || "" });
      if (data.hasCode) setWait(false);
    } catch (e) { setCodeState((old) => ({ status: "error", message: errorOf(e, "Could not check the repository."), branches: old.branches, default: old.default })); setWait(false); }
  }, [form.githubAccountId, form.branch]);

  // While the repository is empty, look again every few seconds so the Deploy button unlocks by itself.
  useEffect(() => {
    if (!repo || !wait) return undefined;
    const timer = setInterval(() => void checkCode(repo.url), 6000);
    return () => clearInterval(timer);
  }, [repo, wait, checkCode]);

  /* Step 3: deploy once the code is there: the server, the client, or both. Each part is its own service. */
  // Variables typed in the text box but not applied yet still go out with the deploy (never silently dropped).
  const envFlush = useRef(null);
  const currentEnvVars = () => { const typed = envFlush.current ? envFlush.current() : null; return typed ? typed.map((r) => ({ name: r.name, value: r.value })) : form.envVars; };
  const renderJob = (overrides) => deployProject({ ...form, envVars: currentEnvVars(), repoName, template: "existing", useExistingRepo: true, existingRepoUrl: repo.url, branch: form.branch, visibility: "public", ...overrides });
  const hostJob = async (overrides) => {
    const data = await deployToHost({ name: form.name, description: form.description, repoUrl: repo.url, branch: form.branch || codeState.branch || "", githubAccountId: form.githubAccountId, hostAccountId: form.hostAccountId, envVars: currentEnvVars(), buildCommand: form.hostBuild, outputDir: form.hostOutput, ...overrides });
    return { ok: true, host: data.host, steps: [{ step: "host", status: "done", detail: "Deployed " + data.repo.owner + "/" + data.repo.repo + " (" + data.repo.branch + ") to " + data.host }], repo: data.repo, service: data.service, projectId: data.projectId, linkId: data.linkId || "", firstDeploy: "started", hostNote: data.note };
  };
  const jobs = [];
  if (scope === "server") jobs.push({ label: "Server", run: () => (host === "render" ? renderJob({}) : hostJob({})) });
  if (scope === "client") jobs.push({ label: "Client", run: () => (host === "render" ? renderJob({ rootDir: form.clientRootDir }) : hostJob({ clientFolder: form.clientRootDir })) });
  if (scope === "both") {
    jobs.push({ label: "Server", run: () => (host === "render" ? renderJob({ rootDir: form.rootDir }) : hostJob({ clientFolder: form.rootDir })) });
    jobs.push({ label: "Client", run: () => (clientHost === "render"
      ? renderJob({ name: form.name + " client", repoName: slug(form.name + "-client"), rootDir: form.clientRootDir, runtime: form.clientRuntime, buildCommand: RUNTIMES[form.clientRuntime]?.build || "", startCommand: "" })
      : hostJob({ name: form.name + " client", clientFolder: form.clientRootDir, hostAccountId: form.clientHostAccountId })) });
  }

  const deploy = async () => {
    if (!repo || busy || !["ready", "error"].includes(codeState.status)) return;
    setBusy(true); setError(""); setResult(null);
    const parts = [];
    try {
      for (const job of jobs) parts.push({ ...(await job.run()), label: job.label });
      setResult({ ok: true, steps: parts.flatMap((p) => p.steps), parts });
      // Every deployed server goes into its project's public Stashr list; later servers of the repo follow by themselves.
      if (scope !== "client") {
        parts.filter((p) => p.projectId && p.label !== "Client").forEach((p) => {
          syncProjectServers(p.projectId).then((r) => { if (r.published) toast.info("Server URL published: /registry/" + r.registryApp); }).catch(() => { /* the background sync retries */ });
        });
      }
      void refreshProfile();
      toast.success(parts.length > 1 ? "Server and client are deploying." : parts[0].host ? "Project created and deploying on " + parts[0].host + "." : "Project created and deploying on the free plan.");
    } catch (e) {
      const data = e?.response?.data;
      const message = data?.error || errorOf(e, "Could not deploy the project.");
      if (!parts.length && !data?.steps) { setError(message); return; }
      setResult({ ok: false, error: message, steps: [...parts.flatMap((p) => p.steps), ...(data?.steps || [])], parts, repo: data?.repo || repo, canReuseRepo: !parts.length && Boolean(data?.canReuseRepo) });
    } finally { setBusy(false); }
  };

  /* ---------------- result screen ---------------- */
  if (result) {
    const ok = result.ok;
    const parts = result.parts || [];
    const waiting = parts.find((p) => p.firstDeploy === "waiting-for-code");
    return (
      <div className="vault page">
        <div className="shell proj-shell">
          <Link to="/projects" className="proj-back"><Arrow size={14} style={{ transform: "rotate(180deg)" }} /> All projects</Link>
          <h1 className="vault__title">{ok ? "All set" : "Stopped part-way"}</h1>
          <section className="card dp-section" aria-live="polite">
            <ul className="dp-steps">
              {result.steps.map((s, i) => (
                <li key={i} className={"is-" + s.status}><span className="mark">{s.status === "done" ? "✓" : s.status === "failed" ? "✕" : "–"}</span><span>{s.detail}</span></li>
              ))}
              {!ok ? <li className="is-failed"><span className="mark">✕</span><span><strong>{result.error}</strong></span></li> : null}
            </ul>
            {!ok && result.repo ? <p className="field__note">Nothing was deleted. Your repository is still at <a href={result.repo.url} target="_blank" rel="noreferrer noopener">{result.repo.url}</a>.</p> : null}
            {!ok && result.canReuseRepo ? (
              <div className="gh-panel__row">
                <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => { setResult(null); void deploy(); }}>{busy ? "Retrying…" : "Retry deploy"}</button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setResult(null)}>Change settings</button>
              </div>
            ) : !ok ? <div className="gh-panel__row"><button type="button" className="btn btn--ghost btn--sm" onClick={() => setResult(null)}>Back</button></div> : null}
          </section>

          {parts.map((part) => (
            <section className="card dp-section" key={part.label + part.repo?.url}>
              <h2>{parts.length > 1 ? part.label + " · " : ""}Your project</h2>
              <div className="dp-links">
                {part.repo ? <a className="btn btn--primary btn--sm" href={part.repo.url} target="_blank" rel="noreferrer noopener">Open repository ↗</a> : null}
                {part.service?.url ? <a className="btn btn--ghost btn--sm" href={part.service.url} target="_blank" rel="noreferrer noopener">Open live site ↗</a> : null}
                {part.service?.dashboardUrl ? <a className="btn btn--ghost btn--sm" href={part.service.dashboardUrl} target="_blank" rel="noreferrer noopener">Open in {part.host || "Render"} ↗</a> : null}
                {part.projectId ? <Link className="btn btn--ghost btn--sm" to={"/projects/" + part.projectId}>Open project in Stashr</Link> : null}
              </div>
              {part.projectId && (part.service?.id || part.linkId) ? (
                <div className="dp-logs">
                  <h3>Deployment progress and logs</h3>
                  <DeployLogs projectId={part.projectId} target={part.linkId ? { ref: "host:" + part.linkId, provider: "host", label: part.host || "Host", name: part.service?.name || part.repo?.repo || "" } : { ref: "render:" + part.service.id, provider: "render", label: "Render", name: part.service.name || part.repo?.repo || "" }} />
                </div>
              ) : null}
              <p className="field__note">
                {part.firstDeploy === "waiting-for-code"
                  ? "Render is waiting for your code. The first git push below triggers the first deploy automatically."
                  : part.host ? "The first deploy is running on " + part.host + ". " + (part.hostNote || "")
                  : "The first deploy is running on Render (free instances take a few minutes to build). Stashr will show its health on the project page."}
              </p>
            </section>
          ))}

          {waiting ? (
            <section className="card dp-section">
              <h2>Push your code from the terminal</h2>
              <p className="field__note">Run these inside your project folder. Sign in to GitHub the way you normally do (<code>gh auth login</code>, a credential manager, or an SSH key) — Stashr never puts its token in the URL.</p>
              <pre className="dp-code">{waiting.repo.commands.join("\n")}</pre>
              <div className="gh-panel__row">
                <Copyable text={waiting.repo.commands.join("\n")} label="Copy commands" />
                <Copyable text={waiting.repo.https} label="Copy HTTPS URL" />
                <Copyable text={waiting.repo.ssh} label="Copy SSH URL" />
              </div>
            </section>
          ) : null}
          {ok ? <div className="gh-panel__row"><Link className="btn btn--ghost" to="/projects/deploy" onClick={() => { setResult(null); setRepo(null); setCodeState({ status: "idle" }); set({ name: "", description: "", envVars: [], existingRepoUrl: "", branch: "", deployScope: "server", clientRootDir: "" }); }}>Create another</Link></div> : null}
        </div>
      </div>
    );
  }

  /* ---------------- form ---------------- */
  const noWrite = github && !writable.length;
  return (
    <div className="vault page">
      <div className="shell proj-shell">
        <Link to="/projects" className="proj-back"><Arrow size={14} style={{ transform: "rotate(180deg)" }} /> All projects</Link>
        <h1 className="vault__title">Create &amp; deploy</h1>
        <p className="vault__count">1) Create a public GitHub repository (or use one you already have). 2) Push your code. 3) Deploy it on Render’s free plan with your environment variables, linked to a Stashr project.</p>

        <form className="dp-form" onSubmit={submit}>
          <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>
          <section className="card dp-section">
            <h2>1 · Project</h2>
            <div className="dp-grid">
              <Field id="dp-name" label="Project name" placeholder="e.g. My Cool App" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} autoComplete="off" hint={repoName ? "Repository: " + repoName : "Used for the repository and the Render service."} />
              <Field id="dp-desc" label="Description (optional)" value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={300} autoComplete="off" />
            </div>
            <div className="dp-templates" role="group" aria-label="Template">
              {TEMPLATES.map(([id, label, hint]) => (
                <button key={id} type="button" className="dp-template" aria-pressed={form.template === id} onClick={() => pickTemplate(id)}><strong>{label}</strong><small>{hint}</small></button>
              ))}
            </div>
            {form.template === "existing" && form.githubAccountId ? <RepoPicker accountId={form.githubAccountId} selected={form.existingRepoUrl.trim()} disabled={locked} onPick={(r) => set({ existingRepoUrl: r.url, branch: "", rootDir: "", clientRootDir: "", ...(form.name.trim() ? {} : { name: String(r.name || r.url.split("/").pop() || "") }) })} /> : null}
            {form.template === "existing" ? <Field id="dp-existing" label="Existing repository URL" placeholder="https://github.com/you/your-repo" value={form.existingRepoUrl} onChange={(e) => set({ existingRepoUrl: e.target.value, branch: "", rootDir: "" })} autoComplete="off" spellCheck="false" hint="Deploying a repo that already has a project? Use a different project name so the new server gets its own name." /> : null}
            {form.template === "existing" && pre.status !== "idle" ? (
              <div className="field">
                <label className="field__label" htmlFor="dp-prebranch">Branch to deploy</label>
                <select id="dp-prebranch" className="input" value={form.branch || pre.default} disabled={pre.status !== "ready" || locked} onChange={(e) => set({ branch: e.target.value })}>
                  {pre.status === "loading" ? <option value="">Loading branches…</option> : null}
                  {pre.status === "error" ? <option value="">Branches unavailable</option> : null}
                  {pre.branches.map((b) => <option key={b} value={b}>{b}{b === pre.default ? " (default)" : ""}</option>)}
                </select>
                <p className="field__note">{pre.status === "error" ? pre.message : "Pick a feature branch to test it on its own server before it goes live."}</p>
              </div>
            ) : null}
          </section>

          <section className="card dp-section">
            <h2>2 · GitHub</h2>
            {noWrite ? (
              <div className="notice notice--err" role="alert"><Alert size={15} /> No connected GitHub token can create repositories yet. Add a classic token with the <code>repo</code> scope.</div>
            ) : null}
            <div className="dp-grid">
              <div className="field">
                <label className="field__label" htmlFor="dp-gh">GitHub account</label>
                <select id="dp-gh" className="input" value={form.githubAccountId} onChange={(e) => set({ githubAccountId: e.target.value })} disabled={!writable.length}>
                  {!writable.length ? <option value="">{github ? "No write-capable token" : "Loading…"}</option> : null}
                  {writable.map((a) => <option key={a.id} value={a.id}>{a.login}{a.name !== a.login ? " (" + a.name + ")" : ""}</option>)}
                </select>
              </div>
              {form.template !== "existing" ? (
                <div className="field">
                  <span className="field__label">Visibility</span>
                  <div className="dp-templates" role="group" aria-label="Repository visibility">
                    {[["public", "Public"], ["private", "Private"]].map(([id, label]) => <button key={id} type="button" className="dp-template" aria-pressed={form.visibility === id} onClick={() => set({ visibility: id })}><strong>{label}</strong></button>)}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="gh-panel__row"><button type="button" className="btn btn--ghost btn--sm" onClick={() => setConnectOpen(true)}>Manage GitHub tokens</button></div>
            {privateChosen ? <div className="notice notice--err" role="alert"><Alert size={15} /> Private repositories are not supported on the free tier. Choose Public.</div> : <p className="field__note">The repository is public: the free tier deploys public GitHub repositories only.</p>}
          </section>

          </fieldset>

          {form.template === "existing" ? (
            <section className="card dp-section dp-scope">
              <h2>Deploy what?</h2>
              <div className="dp-templates" role="group" aria-label="What to deploy">
                {SCOPES.map(([id, label, hint]) => <button key={id} type="button" className="dp-template" aria-pressed={form.deployScope === id} onClick={() => set({ deployScope: id })}><strong>{label}</strong><small>{hint}</small></button>)}
              </div>
              <p className="dp-scope__note">{SCOPE_NOTE[scope]}</p>
            </section>
          ) : null}

          <section className="card dp-section">
            <h2>{scope === "both" ? "3 · Server hosting" : "3 · Hosting"}</h2>
            <div className="dp-templates" role="group" aria-label="Hosting provider">
              <button type="button" className="dp-template" aria-pressed={host === "render"} onClick={() => setHost("render")}><strong>Render</strong><small>Servers and static sites, free plan.</small></button>
              {HOSTS.map((h) => <button key={h.id} type="button" className="dp-template" aria-pressed={host === h.id} onClick={() => setHost(h.id)}><strong>{h.label}</strong><small>{h.best}</small></button>)}
            </div>
          </section>

          {host !== "render" ? (
            <section className="card dp-section">
              <h2>{hostById(host).label}</h2>
              <p className="field__note">Deploys the repository above (and the branch you pick after “Check repository”) to {hostById(host).label}. Your env vars below are sent to it as well.</p>
              <div className="dp-grid">
                <div className="field">
                  <label className="field__label" htmlFor="dp-host">{hostById(host).label} account</label>
                  <select id="dp-host" className="input" value={form.hostAccountId} onChange={(e) => set({ hostAccountId: e.target.value })} disabled={!hostChoices.length}>
                    {!hostChoices.length ? <option value="">{hostAccounts ? "No " + hostById(host).label + " account connected" : "Loading…"}</option> : null}
                    {hostChoices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <Field id="dp-hbuild" label="Build command (optional)" placeholder="auto-detected" value={form.hostBuild} onChange={(e) => set({ hostBuild: e.target.value })} autoComplete="off" spellCheck="false" />
                <Field id="dp-hout" label="Output directory (optional)" placeholder="auto-detected" value={form.hostOutput} onChange={(e) => set({ hostOutput: e.target.value })} autoComplete="off" spellCheck="false" />
              </div>
              <div className="gh-panel__row"><button type="button" className="btn btn--ghost btn--sm" onClick={() => setHostModal(true)}>{hostChoices.length ? "Manage " : "Connect "}{hostById(host).label}</button></div>
              {!hostChoices.length ? <p className="field__note">No {hostById(host).label} token yet. Press Connect for the step-by-step way to get one.</p> : null}
            </section>
          ) : null}
          {scope === "both" ? (
            <section className="card dp-section">
              <h2>Client hosting</h2>
              <p className="field__note">The client is deployed on its own. Render serves it as a static site on the free plan; the other hosts take the repository’s client folder.</p>
              <div className="dp-templates" role="group" aria-label="Client hosting provider">
                <button type="button" className="dp-template" aria-pressed={clientHost === "render"} onClick={() => setClientHost("render")}><strong>Render</strong><small>Static site, free plan.</small></button>
                {HOSTS.map((h) => <button key={h.id} type="button" className="dp-template" aria-pressed={clientHost === h.id} onClick={() => setClientHost(h.id)}><strong>{h.label}</strong><small>{h.best}</small></button>)}
              </div>
              {clientHost !== "render" ? (
                <>
                  <div className="dp-grid">
                    <div className="field">
                      <label className="field__label" htmlFor="dp-chost">{hostById(clientHost).label} account</label>
                      <select id="dp-chost" className="input" value={form.clientHostAccountId} onChange={(e) => set({ clientHostAccountId: e.target.value })} disabled={!clientChoices.length}>
                        {!clientChoices.length ? <option value="">{hostAccounts ? "No " + hostById(clientHost).label + " account connected" : "Loading…"}</option> : null}
                        {clientChoices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="gh-panel__row"><button type="button" className="btn btn--ghost btn--sm" onClick={() => setClientModal(true)}>{clientChoices.length ? "Manage " : "Connect "}{hostById(clientHost).label}</button></div>
                </>
              ) : null}
            </section>
          ) : null}

          {renderPart ? (
          <section className="card dp-section">
            <h2>Render</h2>
            <div className="dp-free"><Check size={16} /><span><strong>Free plan only.</strong> Stashr always creates the service on Render’s free plan; there is no option to choose a paid one. Free services sleep after about 15 minutes without traffic and wake on the next request.</span></div>
            <div className="dp-grid">
              <div className="field"><label className="field__label" htmlFor="dp-runtime">Framework / runtime</label><select id="dp-runtime" className="input" value={form.runtime} onChange={(e) => pickRuntime(e.target.value)}>{Object.entries(RUNTIMES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></div>
              {form.runtime !== "static" ? <Field id="dp-build" label="Build command" value={form.buildCommand} onChange={(e) => set({ buildCommand: e.target.value })} autoComplete="off" spellCheck="false" /> : null}
              {!RUNTIMES[form.runtime].isStatic && form.runtime !== "docker" ? <Field id="dp-start" label="Start command" value={form.startCommand} onChange={(e) => set({ startCommand: e.target.value })} autoComplete="off" spellCheck="false" /> : null}
            </div>
            {scope === "both" && clientHost === "render" ? (
              <div className="field"><label className="field__label" htmlFor="dp-croute">Client framework (static site)</label><select id="dp-croute" className="input" value={form.clientRuntime} onChange={(e) => set({ clientRuntime: e.target.value })}>{Object.entries(RUNTIMES).filter(([, r]) => r.isStatic).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></div>
            ) : null}
            {RUNTIMES[form.runtime]?.needsDockerfile ? <p className="field__note">Render builds this from a <code>Dockerfile</code> at the root of the repository. Use it for PHP/Laravel, Java/Spring Boot, .NET and anything else without a native runtime.</p> : null}
            {ownCode ? (
              <>
                {scope === "client" ? (
                  <Field id="dp-root" label="Client folder" placeholder="e.g. client" value={form.clientRootDir} onChange={(e) => set({ clientRootDir: e.target.value })} autoComplete="off" spellCheck="false" hint="The folder with the client's package.json." />
                ) : (
                  <Field id="dp-root" label={scope === "both" ? "Server folder" : "Root directory (monorepo)"} placeholder="e.g. server (leave empty if package.json is at the repo root)" value={form.rootDir} onChange={(e) => set({ rootDir: e.target.value })} autoComplete="off" spellCheck="false" />
                )}
                {scope === "both" ? <Field id="dp-croot" label="Client folder" placeholder="e.g. client" value={form.clientRootDir} onChange={(e) => set({ clientRootDir: e.target.value })} autoComplete="off" spellCheck="false" /> : null}
                {!form.rootDir && (codeState.rootHint || pre.rootHint) ? (
                  <div className="notice notice--err" role="alert"><Alert size={15} /> No <code>package.json</code> (or other app file) at the top of this repo, so the build will fail. The app looks like it lives in <code>{codeState.rootHint || pre.rootHint}/</code>.{" "}
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => set({ rootDir: codeState.rootHint || pre.rootHint })}>Use “{codeState.rootHint || pre.rootHint}”</button></div>
                ) : null}
              </>
            ) : null}
            <p className="field__note">Every push to the deployed branch redeploys automatically.</p>
            <div className="dp-grid">
              <div className="field">
                <label className="field__label" htmlFor="dp-render">Render account</label>
                <select id="dp-render" className="input" value={form.renderAccountId} onChange={(e) => set({ renderAccountId: e.target.value, ownerId: "" })} disabled={!render?.length}>
                  {!render?.length ? <option value="">{render ? "No Render account connected" : "Loading…"}</option> : null}
                  {(render || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {render && !render.length ? <p className="field__note"><Link to="/render">Connect a Render account</Link> first.</p> : null}
              </div>
              {owners.length > 1 ? (
                <div className="field"><label className="field__label" htmlFor="dp-owner">Workspace</label><select id="dp-owner" className="input" value={form.ownerId} onChange={(e) => set({ ownerId: e.target.value })}><option value="">Choose a workspace…</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}{o.type ? " (" + o.type + ")" : ""}</option>)}</select></div>
              ) : null}
              {!isStatic ? (
                <div className="field"><label className="field__label" htmlFor="dp-region">Region</label><select id="dp-region" className="input" value={form.region} onChange={(e) => set({ region: e.target.value })}>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
              ) : null}
            </div>
          </section>

          ) : null}

          <section className="card dp-section">
            <h2>4 · Environment variables</h2>
            <p className="field__note">Sent straight to the host and saved, encrypted, in the Stashr project.</p>
            <div className="dp-env">
              {form.envVars.map((row, i) => (
                <div key={i} className="dp-env-row">
                  <input className="input" placeholder="NAME" aria-label={"Variable name " + (i + 1)} value={row.name} onChange={(e) => setEnv(i, { name: e.target.value })} autoComplete="off" spellCheck="false" />
                  <input className="input" type="password" placeholder="value" aria-label={"Value " + (i + 1)} value={row.value} onChange={(e) => setEnv(i, { value: e.target.value })} autoComplete="new-password" spellCheck="false" />
                  <button type="button" className="icon-btn icon-btn--quiet" aria-label={"Remove variable " + (i + 1)} onClick={() => set({ envVars: form.envVars.filter((_, idx) => idx !== i) })}><Trash size={15} /></button>
                </div>
              ))}
              <div className="gh-panel__row"><button type="button" className="btn btn--ghost btn--sm" onClick={() => set({ envVars: [...form.envVars, { name: "", value: "" }] })}><Plus size={13} /> Add variable</button></div>
              <EnvImport renderAccounts={render || []} projects={projects} repoUrl={form.existingRepoUrl || repo?.url || ""} taken={form.envVars.map((v) => v.name)} onImport={(rows) => set({ envVars: [...form.envVars.filter((v) => v.name || v.value), ...rows] })} />
              <textarea className="input" rows={3} placeholder={"Or paste a .env file:\nAPI_KEY=abc123\nDATABASE_URL=postgres://…"} aria-label="Paste a .env file" value={pasteText} onChange={(e) => setPasteText(e.target.value)} spellCheck="false" />
              {pasteText.trim() ? <div className="gh-panel__row"><button type="button" className="btn btn--ghost btn--sm" onClick={applyPaste}>Add pasted variables</button></div> : null}
              <EnvText rows={form.envVars} onChange={(rows) => set({ envVars: rows })} idPrefix="dp-env" flushRef={envFlush} />
            </div>
          </section>

          {error ? <div className="notice notice--err" role="alert"><Alert size={15} /> {error}</div> : null}

          {repo ? (
            <section className="card dp-section" aria-live="polite">
              <h2>5 · Push your code, then deploy</h2>
              <p className="field__note">Repository: <a href={repo.url} target="_blank" rel="noreferrer noopener">{repo.url}</a></p>
              {!repo.existing ? (
                <>
                  <p className="field__note">{repo.hasStarter ? "Starter files are already in the repository. Clone it, add your code and push:" : "The repository is empty. Run these in your project folder to push your code (sign in to GitHub the way you normally do; Stashr never puts its token in the URL):"}</p>
                  <pre className="dp-code">{repo.commands.join("\n")}</pre>
                  <div className="gh-panel__row">
                    <Copyable text={repo.commands.join("\n")} label="Copy commands" />
                    <Copyable text={repo.https} label="Copy HTTPS URL" />
                    <Copyable text={repo.ssh} label="Copy SSH URL" />
                  </div>
                </>
              ) : null}
              <div className={"notice " + (codeState.status === "ready" ? "notice--ok" : codeState.status === "error" ? "notice--err" : "")} role="status">
                {codeState.status === "ready" ? <><Check size={15} /> Code found{codeState.branch ? " on " + codeState.branch : ""}. You can deploy.</>
                  : codeState.status === "checking" ? "Checking the repository for code…"
                  : codeState.status === "error" ? <><Alert size={15} /> {codeState.message}</>
                  : "No code in the repository yet. This page checks again every few seconds, or press “Check again” after you push."}
              </div>
              {repo.existing && codeState.branches?.length ? (
                <div className="field">
                  <label className="field__label" htmlFor="dp-branch">Branch to deploy</label>
                  <select id="dp-branch" className="input" value={form.branch || codeState.default || ""} disabled={busy || codeState.status === "checking"} onChange={(e) => { set({ branch: e.target.value }); void checkCode(repo.url, e.target.value); }}>
                    {codeState.branches.map((b) => <option key={b} value={b}>{b}{b === codeState.default ? " (default)" : ""}</option>)}
                  </select>
                  <p className="field__note">Pick a feature branch to test it on its own server before it goes live. Pushes to this branch redeploy it.</p>
                </div>
              ) : null}
              <div className="gh-panel__row">
                <button type="button" className="btn btn--ghost btn--sm" disabled={codeState.status === "checking"} onClick={() => { setWait(true); void checkCode(repo.url); }}>Check again</button>
                <button type="button" className="btn btn--primary btn--lg" disabled={busy || !["ready", "error"].includes(codeState.status) || !ready} onClick={() => void deploy()}>{busy ? <><span className="spinner" /> Deploying… this can take up to a minute</> : deployLabel}</button>
              </div>
            </section>
          ) : (
            <div className="gh-panel__row">
              <button type="submit" className="btn btn--primary btn--lg" disabled={!ready || busy || privateChosen}>{busy ? <><span className="spinner" /> Working…</> : form.template === "existing" ? "Check repository" : "Create repository"}</button>
              <Link to="/projects" className="btn btn--ghost btn--lg">Cancel</Link>
            </div>
          )}
        </form>
      </div>
      <HostConnectModal open={hostModal} initial={host === "render" ? "vercel" : host} onClose={() => setHostModal(false)} onChange={(a) => setHostAccounts(a)} />
      <HostConnectModal open={clientModal} initial={clientHost === "render" ? "vercel" : clientHost} onClose={() => setClientModal(false)} onChange={(a) => setHostAccounts(a)} />
      <GithubConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} onChange={() => void loadGithub()} />
    </div>
  );
}
