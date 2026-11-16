const mongoose = require("mongoose");
const User = require("../models/schema");
const { PROVIDERS } = require("./hosts");
const { renderRequest } = require("./renderOps");
const { fetchAllPages } = require("./renderPaging");
const { mapWithConcurrency } = require("./renderGuards");
const { linkedServices } = require("./projectMerge");
const { planEnvSync, pendingNames, NAME } = require("./serviceEnvSync");
const { projectsSharingRepo } = require("./projectServiceSync");

/*
 * One layer for every hosting provider. A project's Render servers and its linked host sites (Vercel, Netlify,
 * Railway, Cloudflare Pages) are all "targets" with the same operations: read/write variables, redeploy, deploy
 * history, build logs, change branch and change account. Credentials are used here and never returned: every
 * result holds names, counts, statuses, URLs and log lines only.
 */
const safeId = (value) => /^[A-Za-z0-9_-]{1,160}$/.test(String(value || ""));
const STRIP = ["_id", "createdAt", "updatedAt", "broken"];
const MAX_TARGETS = 20;
const fail = (status, message) => Object.assign(new Error(message), { status });
const failed = (error) => ({ ok: false, error });
const isRender = (t) => t.provider === "render";
const servicePath = (t) => "/v1/services/" + encodeURIComponent(t.serviceId);

function accountById(user, dataKey, list, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const entry = (list || []).find((item) => String(item._id) === String(id) && item.enc === "udk");
  return entry ? User.publicEntry(entry, dataKey) : null;
}

/** A project's linked host sites, as stored on the project. */
const hostLinksOf = (fields) => (Array.isArray(fields.hostLinks) ? fields.hostLinks : []).filter((l) => l && l.id && l.provider && l.remoteId);

/** Every deployment target of a project: Render servers, then host sites. Each one carries its credentials in memory only. */
function targetsOf(user, dataKey, fields) {
  const render = linkedServices([fields]).filter((s) => safeId(s.serviceId)).map((s) => {
    const account = accountById(user, dataKey, user.renderAccounts, s.accountId);
    return { ref: "render:" + s.serviceId, provider: "render", label: "Render", name: s.name || s.serviceId, accountId: String(s.accountId), accountName: account?.name || "", apiKey: account?.apiKey || "", serviceId: s.serviceId, url: s.url || "", main: s.serviceId === fields.renderServiceId };
  });
  const hosts = hostLinksOf(fields).map((l) => {
    const account = accountById(user, dataKey, user.hostAccounts, l.hostAccountId);
    const provider = PROVIDERS[l.provider];
    return { ref: "host:" + l.id, provider: l.provider, label: provider?.label || l.provider, name: l.name || l.remoteId, accountId: String(l.hostAccountId || ""), accountName: account?.name || "", account: account && provider && account.provider === l.provider ? account : null, link: l, url: l.url || "", dashboardUrl: l.dashboardUrl || "", main: false };
  });
  return [...render, ...hosts];
}

/** What the browser may see of a target: no credentials, no internal ids beyond the reference. */
const capabilities = (t) => ({ env: true, logs: isRender(t) || PROVIDERS[t.provider]?.logsSupported !== false, branch: true, redeploy: true, account: true });

async function readVars(t) {
  if (isRender(t)) {
    if (!t.apiKey) return failed("Its Render account is no longer connected.");
    try {
      const listing = await fetchAllPages((p) => renderRequest(t.apiKey, p), servicePath(t) + "/env-vars");
      if (listing.truncated) return failed("Too many variables to compare safely.");
      return { ok: true, vars: listing.items.map((i) => i?.envVar || i).filter((i) => i && typeof i.key === "string").map((i) => ({ key: i.key, value: typeof i.value === "string" ? i.value : null })) };
    } catch (error) { return failed(error.status === 404 ? "This service no longer exists on Render." : "Could not read this service from Render."); }
  }
  if (!t.account) return failed("Its hosting connection was removed. Connect it again.");
  return PROVIDERS[t.provider].envRead(t.account.token, t.account, t.link);
}

async function writeVar(t, name, value) {
  if (!NAME.test(name)) return failed("That is not a valid variable name.");
  if (isRender(t)) {
    try { await renderRequest(t.apiKey, servicePath(t) + "/env-vars/" + encodeURIComponent(name), { method: "PUT", body: { value } }); return { ok: true }; }
    catch (error) { return failed(error.status === 404 ? "This service no longer exists on Render." : "Render refused this variable."); }
  }
  if (!t.account) return failed("Its hosting connection was removed. Connect it again.");
  return PROVIDERS[t.provider].envWrite(t.account.token, t.account, t.link, name, value);
}

async function redeployTarget(t, { branch = "" } = {}) {
  if (isRender(t)) {
    try {
      if (branch) await renderRequest(t.apiKey, servicePath(t), { method: "PATCH", body: { branch } });
      await renderRequest(t.apiKey, servicePath(t) + "/deploys", { method: "POST", body: { clearCache: "do_not_clear", deployMode: "build_and_deploy" } });
      return { ok: true, branch };
    } catch (error) { return failed(error.status === 422 ? "This service is suspended, so it cannot deploy. Resume it first." : "Render could not start the deploy."); }
  }
  if (!t.account) return failed("Its hosting connection was removed. Connect it again.");
  return PROVIDERS[t.provider].redeploy(t.account.token, t.account, t.link, { branch });
}

async function deploysOf(t) {
  if (isRender(t)) {
    try {
      const raw = await renderRequest(t.apiKey, servicePath(t) + "/deploys?limit=20");
      const rows = (Array.isArray(raw) ? raw : []).map((r) => r?.deploy || r);
      return { ok: true, deploys: rows.map((d) => ({ id: String(d.id || ""), status: String(d.status || "unknown"), at: d.finishedAt || d.createdAt || null, commit: String(d.commit?.message || "").split("\n")[0].slice(0, 100), sha: String(d.commit?.id || "").slice(0, 7) })) };
    } catch { return failed("Could not read the deploys from Render."); }
  }
  if (!t.account) return failed("Its hosting connection was removed. Connect it again.");
  return PROVIDERS[t.provider].deploys(t.account.token, t.account, t.link);
}

async function logsOf(t, deployId) {
  if (isRender(t)) {
    try {
      const raw = await renderRequest(t.apiKey, servicePath(t));
      const service = raw?.service || raw;
      const end = new Date();
      const params = new URLSearchParams({ ownerId: String(service?.ownerId || ""), resource: t.serviceId, startTime: new Date(end.getTime() - 30 * 60000).toISOString(), endTime: end.toISOString(), direction: "backward", limit: "100", type: "app" });
      if (!service?.ownerId) return failed("Render did not return this service's workspace, so its logs cannot be read.");
      const logs = await renderRequest(t.apiKey, "/v1/logs?" + params.toString());
      return { ok: true, lines: (Array.isArray(logs?.logs) ? logs.logs : []).slice().reverse().map((l) => ({ at: l.timestamp || null, text: String(l.message || "").slice(0, 400) })) };
    } catch { return failed("Could not read the logs from Render."); }
  }
  if (!t.account) return failed("Its hosting connection was removed. Connect it again.");
  if (PROVIDERS[t.provider].logsSupported === false) return failed(PROVIDERS[t.provider].label + " does not publish build logs through its API. Open the deploy in " + PROVIDERS[t.provider].label + ".");
  return PROVIDERS[t.provider].logs(t.account.token, t.account, t.link, String(deployId || ""));
}

async function setBranchOf(t, branch, { deploy = false } = {}) {
  if (isRender(t)) {
    try {
      await renderRequest(t.apiKey, servicePath(t), { method: "PATCH", body: { branch } });
    } catch { return failed("Render could not change the branch."); }
    if (deploy) { const r = await redeployTarget(t); return { ok: true, branch, deployed: r.ok, note: r.ok ? "" : r.error }; }
    return { ok: true, branch, deployed: false, note: "" };
  }
  if (!t.account) return failed("Its hosting connection was removed. Connect it again.");
  const r = await PROVIDERS[t.provider].setBranch(t.account.token, t.account, t.link, branch);
  if (!r.ok) return r;
  if (deploy) { const d = await redeployTarget({ ...t, link: { ...t.link, branch } }, { branch }); return { ok: true, branch, deployed: d.ok, note: d.ok ? "" : d.error }; }
  return { ok: true, branch, deployed: false, note: "" };
}

/** Live status of a target: branch, URL, latest deploy. Read-only. */
async function inspectTarget(t) {
  if (isRender(t)) {
    try {
      const raw = await renderRequest(t.apiKey, servicePath(t));
      const service = raw?.service || raw;
      let latest = null;
      try {
        const rows = await renderRequest(t.apiKey, servicePath(t) + "/deploys?limit=1");
        const d = (Array.isArray(rows) ? rows : []).map((r) => r?.deploy || r)[0];
        if (d) latest = { status: String(d.status || "unknown"), at: d.finishedAt || d.createdAt || null, commit: String(d.commit?.message || "").split("\n")[0].slice(0, 100), sha: String(d.commit?.id || "").slice(0, 7) };
      } catch { /* the deploy line is optional */ }
      return { ok: true, name: String(service?.name || t.name), branch: service?.branch || "", url: /^https:\/\//i.test(String(service?.serviceDetails?.url || "")) ? service.serviceDetails.url : t.url, dashboardUrl: service?.dashboardUrl || "", suspended: service?.suspended === "suspended", latestDeploy: latest };
    } catch (error) { return failed(error.status === 404 ? "This service no longer exists on Render." : "Could not read this service from Render."); }
  }
  if (!t.account) return failed("Its hosting connection was removed. Connect it again.");
  const seen = await PROVIDERS[t.provider].inspect(t.account.token, t.account, t.link);
  if (!seen.ok) return failed(seen.error);
  return { ok: true, name: seen.site.name || t.name, branch: seen.site.branch || t.link.branch || "", url: seen.site.url || t.url, dashboardUrl: seen.site.dashboardUrl || t.dashboardUrl, suspended: false, latestDeploy: seen.latestDeploy || null };
}

/** Public view of a target with its live status. Used by the deployments list. */
async function targetView(t) {
  const info = await inspectTarget(t);
  return {
    ref: t.ref, provider: t.provider, label: t.label, name: info.ok ? info.name : t.name, accountId: t.accountId, accountName: t.accountName,
    url: info.ok ? info.url : t.url, dashboardUrl: info.ok ? info.dashboardUrl : t.dashboardUrl, branch: info.ok ? info.branch : "", suspended: info.ok ? info.suspended : false,
    main: t.main, latestDeploy: info.ok ? info.latestDeploy : null, error: info.ok ? "" : info.error, capabilities: capabilities(t)
  };
}

async function loadProject(user, projectId) {
  if (!mongoose.isValidObjectId(projectId)) throw fail(404, "Could not find that project.");
  const dataKey = await user.getDataKey();
  const entry = (user.projects || []).find((item) => String(item._id) === String(projectId));
  if (!entry) throw fail(404, "Could not find that project.");
  const fields = User.publicEntry(entry, dataKey);
  if (fields.broken) throw fail(422, "This project could not be decrypted.");
  return { entry, dataKey, fields };
}

/** Targets of a project, looked up by reference. Throws 404 for an unknown reference. */
async function findTarget(user, projectId, ref) {
  const { dataKey, fields } = await loadProject(user, projectId);
  const found = targetsOf(user, dataKey, fields).find((t) => t.ref === ref);
  if (!found) throw fail(404, "Could not find that server in this project.");
  return found;
}

async function listTargets(user, projectId) {
  const { dataKey, fields } = await loadProject(user, projectId);
  return mapWithConcurrency(targetsOf(user, dataKey, fields), 3, targetView);
}

/** Every server of every project of this user, any hosting provider. Local data only (no host calls), so it is fast. */
async function listAllServers(user) {
  const dataKey = await user.getDataKey();
  const out = [];
  for (const entry of user.projects || []) {
    if (entry.enc !== "udk") continue;
    const fields = User.publicEntry(entry, dataKey);
    if (fields.broken) continue;
    for (const t of targetsOf(user, dataKey, fields)) out.push({ projectId: String(entry._id), projectName: String(fields.name || "Project"), ref: t.ref, name: t.name, label: t.label, provider: t.provider });
  }
  return out.slice(0, 500);
}

/**
 * Copies variables onto other targets. Source: another target (`sourceRef`) or the names and values sent from a
 * Stashr project (`sourceVars`). Default targets: every other target on the source's branch (`allTargets` for all).
 * Preview unless `apply`. Variables a provider will not reveal are never overwritten, and are listed instead.
 */
async function syncEnv(user, projectId, { apply = false, overwrite = false, deploy = false, sourceRef = "", sourceProjectId = "", names: onlyNames = null, sourceVars = null, targetRefs = null, allTargets = false, acrossProjects = false } = {}) {
  const { dataKey, fields } = await loadProject(user, projectId);
  // acrossProjects: also the targets of every other project that deploys the same GitHub repository.
  const others = acrossProjects ? projectsSharingRepo((user.projects || []).filter((e) => e.enc === "udk").map((e) => ({ ...User.publicEntry(e, dataKey), id: String(e._id) })), { ...fields, id: String(projectId) }) : [];
  const targets = [...targetsOf(user, dataKey, fields), ...others.flatMap((o) => targetsOf(user, dataKey, o))].slice(0, MAX_TARGETS);
  let source = null;
  let sourceRows;
  let sourceBranch = "";
  if (Array.isArray(sourceVars)) {
    sourceRows = sourceVars.filter((v) => v && NAME.test(String(v.name || "")) && typeof v.value === "string").map((v) => ({ key: v.name, value: v.value }));
  } else {
    // sourceProjectId: read the values from a server of ANY other project of this account (any provider).
    if (sourceProjectId && String(sourceProjectId) !== String(projectId)) {
      const other = await loadProject(user, sourceProjectId);
      source = targetsOf(user, other.dataKey, other.fields).find((t) => t.ref === sourceRef);
      if (!source) throw fail(400, "Could not find that source server.");
    } else {
      source = targets.find((t) => t.ref === (sourceRef || targets.find((x) => x.main)?.ref || targets[0]?.ref));
    }
    if (!source) throw fail(400, "Choose a source server from this project.");
    const read = await readVars(source);
    if (!read.ok) throw fail(502, read.error);
    sourceRows = read.vars;
    sourceBranch = (await inspectTarget(source)).branch || "";
  }
  const pool = targets.filter((t) => t !== source);
  // Explicit refs win. Otherwise: every other target when there is no source branch to match (Stashr values, or allTargets), else same-branch only.
  const picked = Array.isArray(targetRefs) ? new Set(targetRefs.map(String)) : null;
  const candidates = picked ? pool.filter((t) => picked.has(t.ref)) : pool;
  const infos = await mapWithConcurrency(candidates, 3, async (t) => ({ t, info: await inspectTarget(t) }));
  const matchBranch = !picked && !allTargets && source && !sourceProjectId;
  const usable = infos.filter(({ info }) => !matchBranch || (info.ok && info.branch === sourceBranch)).slice(0, MAX_TARGETS);

  const plans = await mapWithConcurrency(usable, 3, async ({ t, info }) => {
    const read = await readVars(t);
    if (!read.ok) return { t, info, error: read.error };
    const unreadable = new Set(read.vars.filter((v) => v.value === null).map((v) => v.key));
    const plan = planEnvSync(sourceRows, read.vars.filter((v) => v.value !== null));
    return { t, info, plan, unreadable };
  });

  const summary = {
    source: source ? { ref: source.ref, name: source.name, branch: sourceBranch } : { ref: "stashr", name: "Stashr project", branch: "" },
    targets: plans.map((p) => ({
      ref: p.t.ref, name: p.t.name, provider: p.t.provider, label: p.t.label, branch: p.info.ok ? p.info.branch : "", suspended: Boolean(p.info.suspended),
      error: p.error || (p.info.ok ? "" : p.info.error) || "",
      create: p.plan ? p.plan.create : [], update: p.plan ? p.plan.update : [], same: p.plan ? p.plan.same.length : 0, extra: p.plan ? p.plan.extra : [], skipped: p.plan ? p.plan.skipped : 0,
      unreadable: p.unreadable ? [...p.unreadable] : []
    })),
    applied: false, results: []
  };
  if (!apply) return summary;

  const results = [];
  for (const p of plans) {
    if (p.error || !p.plan || (p.info && !p.info.ok)) { results.push({ ref: p.t.ref, name: p.t.name, written: 0, failed: [], deployed: false, error: p.error || (p.info && p.info.error) || "" }); continue; }
    const only = Array.isArray(onlyNames) ? new Set(onlyNames) : null;
    const names = pendingNames(p.plan, { overwrite }).filter((n) => !p.unreadable.has(n) && (!only || only.has(n)));
    const written = [];
    const failedNames = [];
    let stop = "";
    for (const name of names) {
      const r = await writeVar(p.t, name, p.plan.values.get(name));
      if (r.ok) written.push(name); else { failedNames.push(name); stop = r.error; if (/no longer|connection was removed|not connected/.test(r.error)) break; }
    }
    let deployedNow = false;
    let note = stop;
    if (deploy && written.length) {
      if (p.info.suspended) note = "Suspended, so it was not redeployed.";
      else { const d = await redeployTarget(p.t); deployedNow = d.ok; if (!d.ok) note = d.error; }
    }
    results.push({ ref: p.t.ref, name: p.t.name, written: written.length, failed: failedNames, deployed: deployedNow, error: note, unreadable: [...p.unreadable].filter((n) => p.plan.values.has(n)) });
  }
  return { ...summary, applied: true, results };
}


/**
 * Makes every server of ONE project (one service: its servers on any host) carry the same variables. The reference is the
 * server with the most variables (the freshest, fullest env); any variable that only another server has is added to the
 * reference too, so nothing is lost. A differing value is replaced by the reference's. Other projects are never touched, and a
 * variable a host will not reveal is never overwritten. Preview unless `apply`.
 */
async function syncGroupEnv(user, projectId, { apply = false, deploy = false, overwrite = true } = {}) {
  const { dataKey, fields } = await loadProject(user, projectId);
  const targets = targetsOf(user, dataKey, fields).slice(0, MAX_TARGETS);
  if (targets.length < 2) throw fail(400, "This project needs at least two linked servers to sync.");
  const reads = await mapWithConcurrency(targets, 3, async (t) => ({ t, info: await inspectTarget(t), read: await readVars(t) }));
  const readable = reads.filter((r) => r.read.ok);
  if (readable.length < 2) throw fail(502, "Could not read the variables of at least two servers.");
  const countOf = (r) => r.read.vars.filter((v) => v.value !== null).length;
  // Fullest first; a tie goes to the server that was deployed most recently, then to the main one.
  const stamp = (r) => (r.info && r.info.ok && r.info.latestDeploy && r.info.latestDeploy.at ? new Date(r.info.latestDeploy.at).getTime() || 0 : 0);
  const ranked = [...readable].sort((a, b) => countOf(b) - countOf(a) || stamp(b) - stamp(a) || Number(b.t.main) - Number(a.t.main));
  const source = ranked[0];
  const merged = new Map(source.read.vars.filter((v) => v.value !== null).map((v) => [v.key, v.value]));
  for (const r of ranked.slice(1)) for (const v of r.read.vars) if (v.value !== null && !merged.has(v.key)) merged.set(v.key, v.value);
  const rows = [...merged].map(([key, value]) => ({ key, value }));

  const plans = reads.map((r) => {
    if (!r.read.ok) return { ...r, error: r.read.error };
    const unreadable = new Set(r.read.vars.filter((v) => v.value === null).map((v) => v.key));
    return { ...r, unreadable, plan: planEnvSync(rows, r.read.vars.filter((v) => v.value !== null)) };
  });
  const summary = {
    source: { ref: source.t.ref, name: source.t.name, count: countOf(source) },
    total: rows.length,
    targets: plans.map((p) => ({
      ref: p.t.ref, name: p.t.name, label: p.t.label, error: p.error || "",
      create: p.plan ? p.plan.create : [], update: p.plan ? p.plan.update.filter((n) => !p.unreadable.has(n)) : [], same: p.plan ? p.plan.same.length : 0,
      unreadable: p.unreadable ? [...p.unreadable] : [], isSource: p.t === source.t
    })),
    applied: false, results: []
  };
  if (!apply) return summary;

  const results = [];
  for (const p of plans) {
    if (p.error || !p.plan) { results.push({ ref: p.t.ref, name: p.t.name, written: 0, failed: [], deployed: false, error: p.error || "" }); continue; }
    const names = pendingNames(p.plan, { overwrite }).filter((n) => !p.unreadable.has(n));
    const written = [];
    const failedNames = [];
    let note = "";
    for (const name of names) {
      const r = await writeVar(p.t, name, p.plan.values.get(name));
      if (r.ok) written.push(name); else { failedNames.push(name); note = r.error; if (/no longer|connection was removed|not connected/.test(r.error)) break; }
    }
    let deployedNow = false;
    if (deploy && written.length) {
      if (p.info && p.info.suspended) note = "Suspended, so it was not redeployed.";
      else { const d = await redeployTarget(p.t); deployedNow = d.ok; if (!d.ok) note = d.error; }
    }
    results.push({ ref: p.t.ref, name: p.t.name, written: written.length, failed: failedNames, deployed: deployedNow, error: note });
  }
  return { ...summary, applied: true, results };
}

/** Switches a linked hosting account for non-Render sites. Render needs a real service migration, never an account-reference swap. */
async function moveAccount(user, projectId, ref, accountId) {
  const { entry, dataKey, fields } = await loadProject(user, projectId);
  const target = targetsOf(user, dataKey, fields).find((t) => t.ref === ref);
  if (!target) throw fail(404, "Could not find that server in this project.");
  if (isRender(target)) {
    throw fail(409, "A Render service cannot be moved by changing its account reference. Use the Move to account migration wizard to create and verify a replacement in the destination account.");
  }
  const next = accountById(user, dataKey, user.hostAccounts, accountId);
  if (!next || next.provider !== target.link.provider) throw fail(400, "Choose a connected " + target.label + " account.");
  const moved = { ...target.link, hostAccountId: String(accountId) };
  const seen = await PROVIDERS[next.provider].inspect(next.token, next, moved);
  if (!seen.ok) throw fail(422, seen.error || "That account cannot see this site.");
  const hostLinks = hostLinksOf(fields).map((l) => (l.id === target.link.id ? moved : l));
  const now = new Date();
  const saved = { ...fields, hostLinks };
  STRIP.forEach((key) => delete saved[key]);
  await User.updateOne({ _id: user._id, "projects._id": entry._id }, { $set: { "projects.$.enc": "udk", "projects.$.data": User.sealEntry(dataKey, saved), "projects.$.updatedAt": now } });
  return { ref, accountId: String(accountId), name: target.name };
}

module.exports = { listTargets, findTarget, readVars, writeVar, redeployTarget, deploysOf, logsOf, setBranchOf, syncEnv, syncGroupEnv, listAllServers, moveAccount };
