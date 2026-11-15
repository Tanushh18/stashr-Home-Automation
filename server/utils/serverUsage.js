const { parseGithubRepo } = require("./github");
const { githubGet, resolveRepo, loadGithubAccounts } = require("./githubClient");
const { linkedServices } = require("./projectMerge");

/*
 * For one project: which of its deployed things (Render servers, host sites) find their server through the Stashr
 * registry, and which carry an address of their own. Reads the repository read-only through the user's GitHub
 * connection, keeps only addresses and variable NAMES, and discards file contents as soon as they are analysed.
 *
 *   stashr     the code reads /registry/<name> on Stashr (any env or literal address left in it is just the fallback)
 *   hardcoded  a literal server address (an onrender.com host or one of this project's own servers) is in the code
 *   env        the address comes from a build-time variable (REACT_APP_*, VITE_*, ...) and nothing from Stashr
 *   none       no server address was found (a backend, or a page with no API)
 */
const TTL_MS = 30 * 60 * 1000;
const MAX_FILES = 90;
const MAX_FILE_BYTES = 120 * 1024;
const BUDGET_MS = 25 * 1000;
const CACHE_MAX = 60;

const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|\.next|vendor|venv|\.venv|__pycache__|coverage|\.git|test|tests|__tests__|e2e|docs?|assets|static|migrations)\//i;
const SOURCE = /\.(?:[cm]?jsx?|tsx?|py|html?|yml|yaml)$|(^|\/)\.env\.example$/i;
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;
const LIKELY = /(api|client|config|env|server|url|base|registry|service|index|main|app|constants|axios|fetch|render|bootstrap)/i;

const STASHR_HOST = /(password-manager-server|xxdr\.onrender\.com)/i;
const ENV_NAME = /(?:process\.env|import\.meta\.env)\.((?:REACT_APP|VITE|NEXT_PUBLIC|EXPO_PUBLIC|GATSBY)_[A-Za-z0-9_]*?(?:API|URL|URI|BASE|SERVER|BACKEND|HOST)[A-Za-z0-9_]*)/g;
const ONRENDER = /https?:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.onrender\.com(?:\/[^\s"'`)<>]*)?/g;
const origin = (value) => { try { return new URL(String(value || "")).origin.toLowerCase(); } catch (e) { return ""; } };
const isComment = (line) => /^\s*(\/\/|#|\*|\/\*|<!--)/.test(line);

/** What one file says about where the server is. `known` = origins of this project's own servers. Pure. */
function classifyFile(path, text, known = []) {
    const knownSet = new Set(known.map((u) => origin(u)).filter(Boolean));
    const registry = /\/registry\//.test(text) && STASHR_HOST.test(text);
    const env = new Set();
    const hardcoded = [];
    const seen = new Set();
    String(text).split("\n").forEach((line, i) => {
        if (isComment(line)) return;
        for (const m of line.matchAll(ENV_NAME)) env.add(m[1]);
        const found = [...(line.match(ONRENDER) || [])];
        for (const o of knownSet) if (line.includes(o)) found.push(o);
        for (const url of found) {
            if (STASHR_HOST.test(url)) continue;
            const o = origin(url);
            if (!o || /localhost|127\.0\.0\.1/.test(o) || seen.has(o)) continue;
            seen.add(o);
            hardcoded.push({ origin: o, file: path, line: i + 1 });
        }
    });
    return { path, registry, env: [...env], hardcoded };
}

const inScope = (path, folder) => !folder || folder === "." || path === folder || path.startsWith(String(folder).replace(/^\.?\/+|\/+$/g, "") + "/");

/** One deployed thing's verdict from the files under its folder. Pure. */
function verdict(results, folder) {
    const files = results.filter((r) => inScope(r.path, folder));
    const registryFiles = files.filter((f) => f.registry).map((f) => f.path);
    const env = [...new Set(files.flatMap((f) => f.env))];
    const hardcoded = [];
    const seen = new Set();
    for (const f of files) for (const h of f.hardcoded) if (!seen.has(h.origin)) { seen.add(h.origin); hardcoded.push(h); }
    const state = registryFiles.length ? "stashr" : hardcoded.length ? "hardcoded" : env.length ? "env" : "none";
    return {
        state,
        files: files.length,
        registryFiles: registryFiles.slice(0, 3),
        envNames: env.slice(0, 5),
        samples: hardcoded.slice(0, 3),
        fallbacks: state === "stashr" ? { env: env.length, hardcoded: hardcoded.length } : null
    };
}

function pick(tree) {
    return (Array.isArray(tree) ? tree : [])
        .filter((f) => f && f.type === "blob" && f.sha && typeof f.path === "string" && SOURCE.test(f.path) && !SKIP_DIR.test(f.path + "") && !LOCKFILE.test(f.path) && (f.size || 0) <= MAX_FILE_BYTES)
        .sort((a, b) => Number(LIKELY.test(b.path)) - Number(LIKELY.test(a.path)) || a.path.split("/").length - b.path.split("/").length)
        .slice(0, MAX_FILES);
}

async function mapLimit(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const item = items[i++]; await fn(item); } }));
}

const cache = new Map();

async function scanRepo(accounts, target, known, get) {
    const resolved = await resolveRepo(accounts, target);
    if (resolved.error) return { error: resolved.error.message || "Could not read the repository." };
    const { repo, used, base } = resolved;
    const tree = await get(used.token, base + "/git/trees/" + encodeURIComponent(repo.default_branch || "HEAD") + "?recursive=1");
    if (!tree.ok) return { error: "Could not list the repository files." };
    const picked = pick(tree.body && tree.body.tree);
    const deadline = Date.now() + BUDGET_MS;
    const results = [];
    await mapLimit(picked, 6, async (file) => {
        if (Date.now() > deadline) return;
        const blob = await get(used.token, base + "/git/blobs/" + file.sha);
        if (!blob.ok || !blob.body || blob.body.encoding !== "base64" || typeof blob.body.content !== "string") return;
        results.push(classifyFile(file.path, Buffer.from(blob.body.content, "base64").toString("utf8"), known));
    });
    return { results, scannedAt: new Date().toISOString(), truncated: Boolean(tree.body && tree.body.truncated) || results.length < picked.length };
}

/** The project's deployed things, each with the folder it is built from when known. */
function thingsOf(fields, liveServices) {
    const live = new Map((liveServices || []).map((s) => [String(s.id), s]));
    const things = linkedServices([fields]).map((s) => {
        const l = live.get(String(s.serviceId));
        const type = l ? String(l.type || "") : "";
        return { key: "render:" + s.serviceId, name: s.name || (l && l.name) || s.serviceId, provider: "Render", kind: type === "static_site" ? "site" : "server", url: (l && l.url) || s.url || "", folder: (l && l.rootDir) || "", suspended: l ? l.suspended === true : Boolean(s.suspended) };
    });
    for (const link of Array.isArray(fields.hostLinks) ? fields.hostLinks : []) {
        if (!link || !link.id) continue;
        things.push({ key: "host:" + link.id, name: link.name || link.remoteId || link.id, provider: link.provider || "Host", kind: "site", url: link.url || "", folder: "", suspended: false });
    }
    return things;
}

/** Full report for one project. `get` is injectable for tests. */
async function usageForProject(user, dataKey, fields, liveServices, { force = false, get = githubGet } = {}) {
    const target = parseGithubRepo(fields.repoUrl);
    if (!target) return { error: "Add the GitHub repository to this project to check its code." };
    const accounts = loadGithubAccounts(user, dataKey);
    if (!accounts.length) return { error: "Connect GitHub (Projects → GitHub) so Stashr can read the repository." };
    const things = thingsOf(fields, liveServices);
    const known = [...things.map((t) => t.url), ...(fields.serverUrls || []).map((r) => r.url)].filter(Boolean);
    const key = (target.owner + "/" + target.repo).toLowerCase();
    let hit = cache.get(key);
    if (!hit || force || Date.now() - hit.at > TTL_MS) {
        const data = await scanRepo(accounts, target, known, get);
        if (data.error) return { error: data.error };
        hit = { at: Date.now(), data };
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(key, hit);
    }
    const rows = (things.length ? things : [{ key: "repo", name: target.repo, provider: "GitHub", kind: "repo", url: "", folder: "" }])
        .map((t) => ({ ...t, ...verdict(hit.data.results, t.folder) }));
    return { repo: target.owner + "/" + target.repo, scannedAt: hit.data.scannedAt, truncated: hit.data.truncated, things: rows };
}

module.exports = { classifyFile, verdict, thingsOf, usageForProject };
