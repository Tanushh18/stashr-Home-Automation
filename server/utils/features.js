const { ADMINS } = require("./registryDefaults");

/*
 * Which parts of Stashr each person sees. `audience` is who gets it when nobody has changed anything:
 *   "all"   everyone signed in       "admin" administrators only
 * `locked: true` features follow the audience and cannot be switched for individual people.
 * The admin panel stores per-person overrides on the user as { [key]: true | false }.
 */
const CATALOG = [
  { key: "projects", label: "Projects", description: "Project notes, variables and deploy status.", audience: "all" },
  { key: "servers", label: "Servers", description: "Render dashboard: services, deploys, logs.", audience: "all" },
  { key: "services", label: "Services", description: "Usage and limits of connected services.", audience: "all" },
  { key: "cron", label: "Cron and monitoring", description: "Health pings, incidents and monitoring.", audience: "all" },
  { key: "serverUrls", label: "Server URLs", description: "Backend addresses and environment sync.", audience: "admin", locked: true },
  { key: "security", label: "Security scans", description: "Repository security scans.", audience: "admin", locked: true },
  { key: "adminPanel", label: "Admin panel", description: "Users and feature access.", audience: "admin", locked: true },
];
const BY_KEY = new Map(CATALOG.map((f) => [f.key, f]));

const isAdminEmail = (email) => ADMINS.includes(String(email || "").toLowerCase());

/** Effective features for one person: { key: boolean }. `overrides` is the stored map; unknown keys are ignored. */
function resolveFeatures(email, overrides = {}) {
  const admin = isAdminEmail(email);
  const out = {};
  for (const f of CATALOG) {
    const base = f.audience === "all" || admin;
    out[f.key] = !f.locked && typeof overrides?.[f.key] === "boolean" ? overrides[f.key] : base;
  }
  return out;
}
const hasFeature = (user, key) => Boolean(user && resolveFeatures(user.email, user.featureOverrides)[key]);

/** Express middleware: use after `authenticate`. */
const requireFeature = (key) => (req, res, next) => (hasFeature(req.rootUser, key) ? next() : res.status(403).json({ error: "This feature is not enabled for your account." }));

module.exports = { CATALOG, BY_KEY, resolveFeatures, hasFeature, requireFeature, isAdminEmail };
