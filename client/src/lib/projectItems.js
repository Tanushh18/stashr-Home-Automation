/**
 * Project/infra tracker item model. Stored as one blob, encrypted on the server
 * before upload, same as a password entry (see lib/items.js, state/vault.jsx).
 */
export const emptyDatabase = () => ({ label: "", provider: "", type: "", accountEmail: "", notes: "" });
export const emptyEnvVar = () => ({ name: "", value: "", purpose: "", source: "", renderHash: "" }); // source: "" (manual) | "render" | "render-removed"; renderHash = fingerprint of the value Render last had
export const emptyExtraField = () => ({ label: "", value: "" });

export const emptyProject = () => ({
  name: "",
  description: "",
  category: "",
  techStack: "",
  status: "planning", // planning | in_progress | deployed | broken | paused | archived
  priority: "medium", // low | medium | high
  tags: "",

  repoUrl: "",
  repoAccount: "",
  liveUrl: "",
  customDomain: "",

  hostingProvider: "",
  hostingAccountEmail: "",
  hostingAccountLabel: "",
  hostingServiceName: "",
  hostingPlan: "",
  hostingRegion: "",
  autoDeployBranch: "",

  firebaseProjectId: "",
  firebaseAccountEmail: "",
  googleCloudProjectId: "",
  googleCloudAccountEmail: "",

  playStorePackageName: "",
  playStoreAccountEmail: "",
  playStoreUrl: "",
  playStoreStatus: "",

  dnsProvider: "",
  dnsAccountEmail: "",

  monitoringProvider: "",
  monitoringAccountEmail: "",

  // Render link: variables are pulled one-way from this service into envVars (never written back).
  renderAccountId: "",
  renderServiceId: "",
  renderServiceName: "",
  renderSyncedAt: "",
  renderAutoSync: "", // "on" | ""
  renderAutoLinked: "", // "yes" = linked automatically | "off" = you unlinked it, so it is never auto-linked again

  // Set by the automatic GitHub/Render sync: "github" | "render" = created by Stashr, "" = added by you.
  autoSource: "",
  autoStale: "", // "yes" = repo no longer found anywhere (archived automatically; returns if the repo does)
  autoSyncedAt: "",

  lastDeployedAt: "",
  notes: "",

  databases: [], // [{ label, provider, type, accountEmail, notes }]
  envVars: [], // [{ name, value, purpose }] — the actual secret values, encrypted with everything else
  extraFields: [], // [{ label, value }]
});

const clean = (v) => (v == null ? "" : String(v).trim());

export function normalizeProject(raw = {}) {
  const base = emptyProject();
  const next = { ...base };
  Object.keys(base).forEach((k) => {
    if (k === "databases" || k === "envVars" || k === "extraFields") return;
    next[k] = raw[k] == null ? base[k] : clean(raw[k]) || raw[k];
  });
  next.status = clean(raw.status) || "planning";
  next.priority = clean(raw.priority) || "medium";
  next.databases = Array.isArray(raw.databases)
    ? raw.databases.map((d) => ({ ...emptyDatabase(), ...d })).filter((d) => d.label || d.provider || d.type || d.accountEmail || d.notes)
    : [];
  next.envVars = Array.isArray(raw.envVars)
    ? raw.envVars.map((v) => ({ ...emptyEnvVar(), ...v })).filter((v) => v.name || v.value)
    : [];
  next.extraFields = Array.isArray(raw.extraFields)
    ? raw.extraFields.map((f) => ({ ...emptyExtraField(), ...f })).filter((f) => f.label)
    : [];
  // Every Render service deployed from this repo (kept in step with Render by the server).
  if (Array.isArray(raw.renderServices) && raw.renderServices.length) {
    next.renderServices = raw.renderServices.filter((s) => s && s.serviceId).map((s) => ({ accountId: String(s.accountId || ""), serviceId: String(s.serviceId), name: String(s.name || ""), url: /^https:\/\//i.test(String(s.url || "")) ? String(s.url) : "", suspended: Boolean(s.suspended) }));
  }
  // Existing Vercel / Netlify / Railway / Cloudflare servers linked to this project (kept in step by the server).
  if (Array.isArray(raw.hostLinks) && raw.hostLinks.length) next.hostLinks = raw.hostLinks.filter((l) => l && l.id && l.remoteId);
  // Backend URLs this project's apps use, each switchable; `registryApp` names the app that reads them from Stashr.
  if (Array.isArray(raw.serverUrls) && raw.serverUrls.length) {
    next.serverUrls = raw.serverUrls.filter((s) => s && /^https?:\/\//i.test(String(s.url || ""))).map((s) => ({ url: String(s.url).trim().replace(/\/+$/, ""), enabled: s.enabled !== false, ...(s.auto ? { auto: true } : {}) }));
  }
  // Servers removed by hand: the automatic sync never adds these back.
  if (Array.isArray(raw.serverUrlsIgnored) && raw.serverUrlsIgnored.length) next.serverUrlsIgnored = raw.serverUrlsIgnored.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u)).map((u) => u.trim().replace(/\/+$/, "").toLowerCase());
  // Locked public list: its address (the /registry/<name> link) cannot be renamed or unpublished until it is unlocked.
  if (raw.registryLocked === true && clean(raw.registryApp)) next.registryLocked = true;
  if (clean(raw.registryApp)) next.registryApp = clean(raw.registryApp).toLowerCase();
  return next;
}

// Excel header (snake_case, matches the project-tracker template) -> project field.
const COLUMN_MAP = {
  name: "name", description: "description", category: "category", tech_stack: "techStack",
  status: "status", priority: "priority", tags: "tags",
  repo_url: "repoUrl", repo_account: "repoAccount", live_url: "liveUrl", custom_domain: "customDomain",
  hosting_provider: "hostingProvider", hosting_account_email: "hostingAccountEmail",
  hosting_account_label: "hostingAccountLabel", hosting_service_name: "hostingServiceName",
  hosting_plan: "hostingPlan", hosting_region: "hostingRegion", auto_deploy_branch: "autoDeployBranch",
  firebase_project_id: "firebaseProjectId", firebase_account_email: "firebaseAccountEmail",
  google_cloud_project_id: "googleCloudProjectId", google_cloud_account_email: "googleCloudAccountEmail",
  play_store_package_name: "playStorePackageName", play_store_account_email: "playStoreAccountEmail",
  play_store_url: "playStoreUrl", play_store_status: "playStoreStatus",
  dns_provider: "dnsProvider", dns_account_email: "dnsAccountEmail",
  monitoring_provider: "monitoringProvider", monitoring_account_email: "monitoringAccountEmail",
  last_deployed_at: "lastDeployedAt", notes: "notes",
};

const cell = (row, key) => String(row[key] ?? "").trim();

/**
 * Turns rows from the project-tracker Excel template into project objects,
 * matching Databases rows to their project by name. Runs entirely in the
 * browser — nothing here touches the network.
 *   projectRows: rows from the "Projects" sheet
 *   databaseRows: rows from the "Databases" sheet (project_name, label, provider, type, account_email, notes)
 */
export function rowsToProjects(projectRows = [], databaseRows = []) {
  const projects = new Map();

  projectRows
    .filter((row) => cell(row, "name"))
    .forEach((row) => {
      const project = emptyProject();
      Object.entries(COLUMN_MAP).forEach(([col, field]) => { project[field] = cell(row, col); });
      if (!project.status) project.status = "planning";
      if (!project.priority) project.priority = "medium";
      projects.set(project.name, project);
    });

  databaseRows.forEach((row) => {
    const project = projects.get(cell(row, "project_name"));
    if (!project) return;
    if (!cell(row, "provider") && !cell(row, "type") && !cell(row, "label")) return;
    project.databases.push({
      label: cell(row, "label"),
      provider: cell(row, "provider"),
      type: cell(row, "type"),
      accountEmail: cell(row, "account_email"),
      notes: cell(row, "notes"),
    });
  });

  return [...projects.values()];
}

/**
 * Parses a raw .env-style block — exactly what you get pasting from Render's
 * Environment tab (or any KEY=VALUE dump) — into { name, value } rows.
 * Handles single-line values, quoted values, and multi-line quoted blocks
 * (e.g. a pasted Firebase service-account JSON wrapped in '...').
 * Runs entirely in the browser; nothing here is sent anywhere.
 */
export function parseEnvBlock(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const rows = [];
  let i = 0;

  const stripQuotes = (v) => {
    if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
      return v.slice(1, -1);
    }
    return v;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) { i += 1; continue; }

    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) { i += 1; continue; }

    const [, key, rest] = m;

    // A value that starts with a quote but never closes it on this line is a
    // multi-line block (e.g. a pasted JSON credential) — collect until we
    // hit a line that closes it: a bare closing brace, or brace+quote.
    const startsQuoted = /^['"]/.test(rest.trim());
    const quoteChar = startsQuoted ? rest.trim()[0] : null;
    const closesOnSameLine = quoteChar && rest.trim().length > 1 && rest.trim().endsWith(quoteChar);

    if (startsQuoted && !closesOnSameLine) {
      const blockLines = [rest.trim().slice(1)];
      i += 1;
      while (i < lines.length) {
        const l = lines[i];
        const closesHere = l.trim() === "}" || l.trim() === `}${quoteChar}` || l.trim().endsWith(`}${quoteChar}`);
        if (closesHere) { blockLines.push(l.trim().replace(new RegExp(`${quoteChar}$`), "")); i += 1; break; }
        blockLines.push(l);
        i += 1;
      }
      rows.push({ name: key, value: blockLines.join("\n") });
      continue;
    }

    rows.push({ name: key, value: stripQuotes(rest.trim()) });
    i += 1;
  }

  return rows.filter((r) => r.name);
}

export const STATUS_LABEL = {
  planning: "Planning",
  in_progress: "In progress",
  deployed: "Deployed",
  broken: "Broken",
  paused: "Paused",
  archived: "Archived",
};

/**
 * Variables typed into the "all as text" box but not applied yet, merged over the rows already in the form: the notes (purpose) of a
 * name that stays are kept, names that are gone are dropped. Used by Save so pressing it never silently loses typed text.
 */
export function mergeTypedEnv(existing, typed) {
  return (typed || []).map((r) => ({ ...emptyEnvVar(), ...((existing || []).find((x) => x.name === r.name) || {}), name: r.name, value: r.value }));
}
