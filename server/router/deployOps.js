const express = require("express");
const authenticate = require("../middlewares/authenticate");
const rateLimit = require("../middlewares/rateLimit");
const ops = require("../utils/deployOps");

/*
 * Every hosting provider behind one API: a project's Render servers and linked host sites (Vercel, Netlify,
 * Railway, Cloudflare Pages). Each route acts on one target, named by `ref` ("render:<id>" or "host:<linkId>").
 * Variable values are returned only to the signed-in owner; tokens never leave the server.
 */
const router = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: "Too many deployment requests. Please slow down." });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, message: "Too many changes. Please wait a minute." });
const REF_RE = /^(render|host):[A-Za-z0-9_-]{1,160}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BRANCH_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._\/-]{1,200}$/;
const text = (value, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const refOf = (value) => (REF_RE.test(String(value || "")) ? String(value) : "");

router.use("/deploy-ops", authenticate, limiter);

const send = (res, error) => res.status(Number.isInteger(error.status) ? error.status : 500).json({ error: Number.isInteger(error.status) ? error.message : "Something went wrong. Try again." });
const pass = (res, result) => { if (result && result.ok === false) return res.status(422).json({ error: result.error }); res.set("Cache-Control", "no-store"); return res.json(result); };

router.get("/deploy-ops/projects/:projectId/targets", async (req, res) => {
  try { res.set("Cache-Control", "no-store"); return res.json({ targets: await ops.listTargets(req.rootUser, req.params.projectId) }); }
  catch (error) { return send(res, error); }
});

/* Every server of every project, so env values can be copied from any of them. Names only. */
router.get("/deploy-ops/servers", async (req, res) => {
  try { res.set("Cache-Control", "no-store"); return res.json({ servers: await ops.listAllServers(req.rootUser) }); }
  catch (error) { return send(res, error); }
});

router.get("/deploy-ops/projects/:projectId/env", async (req, res) => {
  const ref = refOf(req.query.ref);
  if (!ref) return res.status(400).json({ error: "Choose a server." });
  try { return pass(res, await ops.readVars(await ops.findTarget(req.rootUser, req.params.projectId, ref))); }
  catch (error) { return send(res, error); }
});

router.put("/deploy-ops/projects/:projectId/env", writeLimiter, async (req, res) => {
  const ref = refOf(req.body?.ref);
  const key = text(req.body?.key, 200);
  const value = typeof req.body?.value === "string" ? req.body.value : null;
  if (!ref || !ENV_NAME.test(key) || value === null || value.length > 8000) return res.status(400).json({ error: "Choose a server, a valid variable name and a value." });
  try { return pass(res, await ops.writeVar(await ops.findTarget(req.rootUser, req.params.projectId, ref), key, value)); }
  catch (error) { return send(res, error); }
});

router.post("/deploy-ops/projects/:projectId/redeploy", writeLimiter, async (req, res) => {
  const ref = refOf(req.body?.ref);
  const branch = text(req.body?.branch, 200);
  if (!ref) return res.status(400).json({ error: "Choose a server." });
  if (branch && !BRANCH_RE.test(branch)) return res.status(400).json({ error: "Choose a valid branch." });
  try { return pass(res, await ops.redeployTarget(await ops.findTarget(req.rootUser, req.params.projectId, ref), { branch })); }
  catch (error) { return send(res, error); }
});

router.get("/deploy-ops/projects/:projectId/deploys", async (req, res) => {
  const ref = refOf(req.query.ref);
  if (!ref) return res.status(400).json({ error: "Choose a server." });
  try { return pass(res, await ops.deploysOf(await ops.findTarget(req.rootUser, req.params.projectId, ref))); }
  catch (error) { return send(res, error); }
});

router.get("/deploy-ops/projects/:projectId/logs", async (req, res) => {
  const ref = refOf(req.query.ref);
  if (!ref) return res.status(400).json({ error: "Choose a server." });
  try { return pass(res, await ops.logsOf(await ops.findTarget(req.rootUser, req.params.projectId, ref), text(req.query.deployId, 120))); }
  catch (error) { return send(res, error); }
});

router.put("/deploy-ops/projects/:projectId/branch", writeLimiter, async (req, res) => {
  const ref = refOf(req.body?.ref);
  const branch = text(req.body?.branch, 200);
  if (!ref) return res.status(400).json({ error: "Choose a server." });
  if (!BRANCH_RE.test(branch)) return res.status(400).json({ error: "Choose a valid branch." });
  try { return pass(res, await ops.setBranchOf(await ops.findTarget(req.rootUser, req.params.projectId, ref), branch, { deploy: req.body?.deploy === true })); }
  catch (error) { return send(res, error); }
});

router.put("/deploy-ops/projects/:projectId/account", writeLimiter, async (req, res) => {
  const ref = refOf(req.body?.ref);
  const accountId = text(req.body?.accountId, 40);
  if (!ref || !accountId) return res.status(400).json({ error: "Choose a server and an account." });
  try { return pass(res, await ops.moveAccount(req.rootUser, req.params.projectId, ref, accountId)); }
  catch (error) { return send(res, error); }
});

/* Copy variables onto other servers. Preview unless apply is set. Source: another server, or the names and values of a Stashr project. */
router.post("/deploy-ops/projects/:projectId/sync", writeLimiter, async (req, res) => {
  const b = req.body || {};
  const list = (value) => (Array.isArray(value) ? value.map(refOf).filter(Boolean).slice(0, 20) : null);
  const sourceVars = Array.isArray(b.sourceVars) ? b.sourceVars.slice(0, 300).map((v) => ({ name: text(v?.name, 200), value: typeof v?.value === "string" ? v.value.slice(0, 8000) : "" })) : null;
  try {
    const result = await ops.syncEnv(req.rootUser, req.params.projectId, {
      apply: b.apply === true, overwrite: b.overwrite === true, deploy: b.deploy === true,
      sourceRef: refOf(b.sourceRef), sourceProjectId: text(b.sourceProjectId, 40), names: Array.isArray(b.names) ? b.names.map((n) => text(n, 200)).filter(Boolean).slice(0, 300) : null, sourceVars, targetRefs: list(b.targetRefs), allTargets: b.allTargets === true, acrossProjects: b.acrossProjects === true
    });
    res.set("Cache-Control", "no-store");
    return res.json(result);
  } catch (error) { return send(res, error); }
});

/* Make all servers of this one project carry the same variables (the fullest env wins). Preview unless apply. Never touches other projects. */
router.post("/deploy-ops/projects/:projectId/sync-group", writeLimiter, async (req, res) => {
  const b = req.body || {};
  try {
    const result = await ops.syncGroupEnv(req.rootUser, req.params.projectId, { apply: b.apply === true, deploy: b.deploy === true, overwrite: b.overwrite !== false });
    res.set("Cache-Control", "no-store");
    return res.json(result);
  } catch (error) { return send(res, error); }
});

module.exports = router;
