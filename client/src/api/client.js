import axios from "axios";

// API servers, in order of preference. If one is down the client falls over
// to the next. Override with REACT_APP_API_URLS (comma separated) at build time.
// xxdr is the fixed address apps use to find the current server list (see "Server registry" below).
// The main server. Other servers come from the Stashr server list (the Servers page), never from here.
// Every server runs the same database, so any of these works and the next one takes over if the first is down.
// EORE is the extra standby for the website only; it sleeps when unused and wakes when the others are down.
const DEFAULT_SERVERS = [
    "https://password-manager-server-10od.onrender.com",
    "https://password-manager-server-g305.onrender.com",
    "https://password-manager-server-xxdr.onrender.com",
    "https://stashr-home-automation.onrender.com",
    "https://stashr-home-automation-gk9p.onrender.com"
];
const WEB_STANDBY = "https://stashr-home-automation-eore.onrender.com";

const SERVERS = (import.meta.env.VITE_API_URLS || import.meta.env.REACT_APP_API_URLS || import.meta.env.REACT_APP_API_URL || "")
    .split(",")
    .map((u) => u.trim().replace(/\/+$/, ""))
    .filter(Boolean);
// The build-time list (VITE_API_URLS) goes first, and every known server is always added after it, so a short env list
// can never leave the web with only servers that are suspended.
for (const u of [...DEFAULT_SERVERS, WEB_STANDBY]) if (!SERVERS.includes(u)) SERVERS.push(u);
// The public status page is served by the API, so its link points at the first server.
export const publicApiBase = SERVERS[0];
export const webStandbyServer = WEB_STANDBY;

// The build-time server list is the primary configured endpoint. The Stashr registry adds
// fallback servers on startup; keeping the configured endpoint first ensures this deployment uses v2.
const BOOTSTRAP = [...SERVERS];
const REGISTRY_CACHE_KEY = "pm_registry_stashr";
const REGISTRY_APP = "stashr";

const mergeServers = (fresh) =>
{
    const list = [...BOOTSTRAP, ...fresh].filter((u, i, a) => u && a.indexOf(u) === i);
    const current = SERVERS[active];
    SERVERS.splice(0, SERVERS.length, ...list);
    const i = SERVERS.indexOf(current);
    active = i >= 0 ? i : 0;
};

const cleanList = (urls) =>
    (Array.isArray(urls) ? urls : [])
        .map((u) => (typeof u === "string" ? u.trim().replace(/\/+$/, "") : ""))
        .filter((u) => /^https?:\/\//i.test(u));

const STORAGE_KEY = "pm_active_server";
const REQUEST_TIMEOUT_MS = 8000;

const readActive = () =>
{
    try
    {
        const i = SERVERS.indexOf(sessionStorage.getItem(STORAGE_KEY));
        return i >= 0 ? i : 0;
    }
    catch (e) { return 0; }
};

// The session cookie lives on the one server that signed you in. Remember it, so a failover to another server (which
// has no cookie) is never mistaken for "you are signed out".
const SESSION_SERVER_KEY = "pm_session_server";
const readSessionServer = () => { try { return localStorage.getItem(SESSION_SERVER_KEY) || ""; } catch (e) { return ""; } };
const writeSessionServer = (url) => { try { if (url) localStorage.setItem(SESSION_SERVER_KEY, url); else localStorage.removeItem(SESSION_SERVER_KEY); } catch (e) { /* private mode */ } };

// Sticky: keep using the server that last worked (its login cookie lives there).
let active = readActive();
const setActive = (i) =>
{
    active = i;
    try { sessionStorage.setItem(STORAGE_KEY, SERVERS[i]); } catch (e) { /* ignore */ }
};

try
{
    const cached = cleanList(JSON.parse(localStorage.getItem(REGISTRY_CACHE_KEY) || "[]"));
    if (cached.length) mergeServers(cached);
}
catch (e) { /* no cache yet */ }

const instance = axios.create({
    headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
    },
    timeout: REQUEST_TIMEOUT_MS,
    withCredentials: true
});

// In-flight request count, so the page can show a loader while the server works (see Components/NetBar).
let inflight = 0;
const watchers = new Set();
export const onActivity = (fn) => { watchers.add(fn); fn(inflight); return () => watchers.delete(fn); };
const track = (d) => { inflight = Math.max(0, inflight + d); watchers.forEach((fn) => fn(inflight)); };
const baseAdapter = axios.getAdapter(instance.defaults.adapter);
instance.defaults.adapter = (config) =>
{
    track(1);
    return baseAdapter(config).finally(() => track(-1));
};

// Fallback for browsers that refuse the cross-site session cookie: the sign-in token is kept here and sent as a
// Bearer header instead. Only used after the cookie was seen to fail; cleared on sign-out or a rejected session.
const BEARER_KEY = "pm_bearer";
export const getBearer = () => { try { return localStorage.getItem(BEARER_KEY) || ""; } catch (e) { return ""; } };
export const setBearer = (token) => { try { if (token) localStorage.setItem(BEARER_KEY, token); else localStorage.removeItem(BEARER_KEY); } catch (e) { /* private mode */ } };

instance.interceptors.request.use((config) =>
{
    const bearer = getBearer();
    if (bearer && !/\/(login|register|mpin-login)$/.test(String(config.url || "").split("?")[0])) config.headers.Authorization = "Bearer " + bearer;
    config.headers["X-Client-Id"] = CLIENT_ID;
    // A stale index (the list changed under a request) must never send the call to the website itself, which answers with HTML.
    if (config._server === undefined || !SERVERS[config._server]) config._server = SERVERS[active] ? active : 0;
    config.baseURL = SERVERS[config._server];
    return config;
});

// Down = no response at all (network error / timeout) or a gateway error.
const isServerDown = (error) =>
    !error.response || [502, 503, 504].includes(error.response.status);

instance.interceptors.response.use(
    (response) =>
    {
        if (response.config._server !== undefined && response.config._server !== active)
            setActive(response.config._server);
        // The server that just signed us in (or confirmed the session) is the one that holds the cookie.
        if (/\/(login|authenticate|mpin-login)$/.test(String(response.config.url || "").split("?")[0]) && SERVERS[response.config._server])
            writeSessionServer(SERVERS[response.config._server]);
        if (/\/logout$/.test(String(response.config.url || "").split("?")[0])) { writeSessionServer(""); setBearer(""); }
        return response;
    },
    (error) =>
    {
        const config = error.config;
        // A 401 from a server that never signed us in is not "signed out": ask the server that holds the session once.
        if (config && error.response?.status === 401 && !config._sessionRetry && !/\/(login|register|mpin-login)$/.test(String(config.url || "").split("?")[0]))
        {
            const home = SERVERS.indexOf(readSessionServer());
            if (home >= 0 && home !== config._server)
            {
                config._sessionRetry = true;
                config._server = home;
                return instance(config);
            }
        }
        if (!config || !isServerDown(error)) return Promise.reject(error);

        // Render's free plan sleeps; waking takes up to a minute. Give the same server one long retry first.
        const timedOut = error.code === "ECONNABORTED" || /timeout/i.test(String(error.message || ""));
        if (timedOut && !config._woke)
        {
            config._woke = true;
            config.timeout = Math.max(config.timeout || 0, 25000);
            return instance(config);
        }
        if (SERVERS.length < 2) return Promise.reject(error);

        config._tried = (config._tried || 0) + 1;
        if (config._tried >= SERVERS.length) return Promise.reject(error);

        config._server = (config._server + 1) % SERVERS.length;
        return instance(config);
    }
);

export const API_URL = () => SERVERS[active];

// Ask the servers for the current list (in the background, never blocks the UI).
export const refreshServers = async () =>
{
    for (const base of [...SERVERS])
    {
        try
        {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 60000);
            const res = await fetch(`${base}/registry/${REGISTRY_APP}`, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) continue;
            const urls = cleanList((await res.json()).urls);
            if (!urls.length) continue;
            mergeServers(urls);
            try { localStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify(urls)); } catch (e) { /* ignore */ }
            return urls;
        }
        catch (e) { /* try the next server */ }
    }
    return null;
};
// A server Render no longer routes (deleted service) fails at once with no CORS headers; a sleeping one is just slow.
// Drop the dead ones so a cold start never fails over to a server that does not exist.
const pruneDeadServers = async () =>
{
    // The web standby (eore) is never pinged on page load: it stays asleep while any main server works.
    const main = SERVERS.filter((u) => u !== WEB_STANDBY);
    if (main.length < 2) return;
    const dead = [];
    await Promise.all(main.map(async (base) =>
    {
        const started = Date.now();
        try
        {
            const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(90000) });
            if (!res.ok && res.status === 404) dead.push(base);
        }
        catch (e) { if (Date.now() - started < 8000 && e?.name !== "TimeoutError") dead.push(base); }
    }));
    const alive = SERVERS.filter((u) => !dead.includes(u));
    if (!alive.length || !dead.length) return;
    const current = SERVERS[active];
    SERVERS.splice(0, SERVERS.length, ...alive);
    const i = SERVERS.indexOf(current);
    setActive(i >= 0 ? i : 0);
};
refreshServers().finally(() => { pruneDeadServers().catch(() => {}); });

/* ── Server registry (admin only) ── */
export const getRegistry = () => instance.get("/registry");
export const saveRegistry = (app, urls, { force = false } = {}) => instance.put(`/registry/${app}`, { urls, force });
/* ── ShineOne website photos, per sector / area (admin) ── */
export const getShineProjects = () => instance.get("/shine/projects").then((r) => r.data);
export const addShineProject = (label) => instance.post("/shine/projects", { label }).then((r) => r.data);
export const signShineUpload = (project, kind) => instance.post("/shine/sign", { project, kind }).then((r) => r.data);
export const markShineUploaded = () => instance.post("/shine/uploaded", {});
export const deleteShineMedia = (item) => instance.post("/shine/delete", { publicId: item.publicId, kind: item.kind });
export const getShineSite = () => instance.get("/shine/site").then((r) => r.data);
export const updateShineSite = (key, update) => instance.put("/shine/site/" + encodeURIComponent(key), update).then((r) => r.data);
export const getRegistryVisitors = () => instance.get("/registry/stats").then((r) => r.data);
export const checkServer = (url) => instance.post("/registry/check", { url }, { timeout: 30000 });

/* ── Personal AI Photo Cloud ── */
export const getPhotoCloudDashboard = () => instance.get("/photo-cloud/dashboard", { timeout: 30000 }).then((r) => r.data);
export const setPhotoFavorite = (id, favorite) => instance.patch(`/photo-cloud/media/${encodeURIComponent(id)}`, { favorite }).then((r) => r.data);
export const removePhotoMedia = (id) => instance.delete(`/photo-cloud/media/${encodeURIComponent(id)}`).then((r) => r.data);
export const connectPhotoGoogleAccount = (data) => instance.post("/photo-cloud/connections", data).then((r) => r.data);
export const startPhotoGoogleOAuth = (label, returnTo) => instance.get("/photo-cloud/google/start", { params: { label, ...(returnTo ? { returnTo } : {}) } }).then((r) => r.data);
export const getBlob = (path) => instance.get(path, { responseType: "blob", timeout: 60000 }).then((r) => r.data);
export const getAdminUsers = (q = "") => instance.get("/admin/users", { params: { q, limit: 300 } }).then((r) => r.data);
export const setUserFeature = (id, key, enabled) => instance.put(`/admin/users/${encodeURIComponent(id)}/features`, { key, enabled }).then((r) => r.data);
export const listPhotoImports = () => instance.get("/photo-import/batches").then((r) => r.data);
export const createPhotoImport = (data) => instance.post("/photo-import/batches", data, { timeout: 60000 }).then((r) => r.data);
export const getPhotoImport = (id) => instance.get(`/photo-import/batches/${encodeURIComponent(id)}`, { timeout: 30000 }).then((r) => r.data);
export const photoImportAction = (id, action) => instance.post(`/photo-import/batches/${encodeURIComponent(id)}/${action}`, {}, { timeout: 60000 }).then((r) => r.data);
export const deletePhotoImport = (id) => instance.delete(`/photo-import/batches/${encodeURIComponent(id)}`).then((r) => r.data);
export const renamePhotoImport = (id, label) => instance.patch(`/photo-import/batches/${encodeURIComponent(id)}`, { label }).then((r) => r.data);
export const createFolderShare = (data) => instance.post("/photo-cloud/folder-shares", data).then((r) => r.data);
export const listFolderShares = () => instance.get("/photo-cloud/folder-shares").then((r) => r.data);
export const revokeFolderShare = (id) => instance.delete(`/photo-cloud/folder-shares/${encodeURIComponent(id)}`).then((r) => r.data);
export const getSharedWithMe = () => instance.get("/photo-cloud/shared-with-me").then((r) => r.data);
export const getSharedMedia = (id) => instance.get(`/photo-cloud/shared/${encodeURIComponent(id)}/media`, { timeout: 30000 }).then((r) => r.data);
export const importExistingPhotos = () => instance.post("/photo-cloud/import-existing", {}, { timeout: 180000 }).then((r) => r.data);
export const createPhotoFolder = (name, parentId) => instance.post("/photo-cloud/folders", { name, parentId }).then((r) => r.data);
export const deletePhotoFolder = (id) => instance.delete(`/photo-cloud/folders/${encodeURIComponent(id)}`).then((r) => r.data);
export const syncPhotoGoogleAccount = (id) => instance.post(`/photo-cloud/connections/${encodeURIComponent(id)}/sync`).then((r) => r.data);
export const updatePhotoConnection = (id, data) => instance.put(`/photo-cloud/connections/${encodeURIComponent(id)}`, data).then((r) => r.data);
export const disconnectPhotoConnection = (id) => instance.delete(`/photo-cloud/connections/${encodeURIComponent(id)}`).then((r) => r.data);
export const exportPhotoManifest = () => instance.get("/photo-cloud/export").then((r) => r.data);
export const savePhotoRoutingPolicy = (data) => instance.put("/photo-cloud/routing-policy", data).then((r) => r.data);
export const createPhotoBackupJob = (data) => instance.post("/photo-cloud/backup/jobs", data).then((r) => r.data);
export const createPhotoShare = (data) => instance.post("/photo-cloud/shares", data).then((r) => r.data);
export const getPhotoShares = () => instance.get("/photo-cloud/shares").then((r) => r.data);
export const revokePhotoShare = (id) => instance.delete(`/photo-cloud/shares/${encodeURIComponent(id)}`).then((r) => r.data);
export const getPublicPhotoShare = (token) => instance.get(`/public/photo-cloud/shares/${encodeURIComponent(token)}`, { withCredentials: false }).then((r) => r.data);

/* ── Auth ── */
// Several screens ask for the profile at once on load; share one in-flight request instead of loading the vault N times.
let profileInFlight = null;
export const checkAuthenticated = () => {
    if (!profileInFlight) profileInFlight = instance.get("/authenticate").finally(() => { profileInFlight = null; });
    return profileInFlight;
};
export const loginUser = (data) => instance.post("/login", data);
export const mpinLogin = (data) => instance.post("/mpin-login", data);
export const setupMpin = (pin) => instance.post("/mpin", { pin }).then((r) => r.data);
export const changeMpin = (deviceId, pin) => instance.put(`/mpin/${deviceId}`, { pin }).then((r) => r.data);
export const listMpin = () => instance.get("/mpin").then((r) => r.data);
export const removeMpin = (deviceId) => instance.delete(`/mpin/${deviceId}`).then((r) => r.data);
export const logoutUser = () => instance.get("/logout");
export const signupUser = (data) => instance.post("/register", data);

/* ── Vault (server-side encrypted) ── */
/* Delta sync + live events. `clientId` marks this tab's own writes so its event stream can ignore them. */
export const CLIENT_ID = Math.random().toString(36).slice(2, 10);
export const getVaultChanges = (since) => instance.get("/vault/changes", { params: since ? { since } : {}, timeout: 30000 }).then((r) => r.data);
/* EventSource cannot send the Authorization header the app fallback uses, so the stream is read with fetch. */
export const openVaultEvents = (signal) => {
    const headers = { Accept: "text/event-stream" };
    const bearer = getBearer();
    if (bearer) headers.Authorization = "Bearer " + bearer;
    return fetch(SERVERS[active] + "/vault/events", { headers, credentials: "include", signal, cache: "no-store" });
};

export const createItem = (data) => instance.post("/vault/items", { data });
export const createItems = (items) => instance.post("/vault/items/bulk", { items });
export const updateItem = (id, data) => instance.put(`/vault/items/${id}`, { data });
export const deleteItem = (id) => instance.delete(`/vault/items/${id}`);

/* ── Project tracker (server-side encrypted) ── */
export const createProject = (data) => instance.post("/projects/items", { data });
export const createProjects = (items) => instance.post("/projects/items/bulk", { items });
export const updateProject = (id, data) => instance.put(`/projects/items/${id}`, { data });
export const deleteProject = (id) => instance.delete(`/projects/items/${id}`);

/* ── Account ── */
export const getSessions = () => instance.get("/account/sessions").then((r) => r.data);
export const revokeSession = (id) => instance.delete("/account/sessions/" + encodeURIComponent(id)).then((r) => r.data);
export const logoutOtherDevices = () => instance.post("/account/logout-all").then((r) => r.data);
export const getAuditLog = (limit = 50) => instance.get("/account/audit", { params: { limit } }).then((r) => r.data);
export const updateProfile = (name) => instance.post("/account/profile", { name });
export const changePassword = (data) => instance.post("/account/password", data);
export const logoutEverywhere = () => instance.post("/account/logout-all");
export const deleteAccount = (data) => instance.post("/account/delete", data);
export const twoFactorSetup = (password) => instance.post("/2fa/setup", { password });
export const twoFactorEnable = (code) => instance.post("/2fa/enable", { code });
export const twoFactorDisable = (data) => instance.post("/2fa/disable", data);
export const twoFactorRecoveryCodes = (data) => instance.post("/2fa/recovery-codes", data);

// Health probe used by the live status indicators (and by the cron job server side).
export const checkHealth = () => instance.get("/health", { withCredentials: false });

export { errorMessage } from "../lib/errors.js";

/* ── Render dashboard (all requests use Stashr's authenticated session) ── */
export const getRenderAccounts = () => instance.get("/render/accounts", { timeout: 30000 }).then((r) => r.data);
export const connectRenderAccount = (data) => instance.post("/render/accounts", data).then((r) => r.data);
export const deleteRenderAccount = (id) => instance.delete("/render/accounts/" + encodeURIComponent(id)).then((r) => r.data);
export const getRenderServices = (accountId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services", { timeout: 20000 }).then((r) => r.data);
export const renameRenderService = (accountId, serviceId, name) => instance.patch(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/name`, { name }).then((r) => r.data);
export const getRenderLogs = (accountId, params) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/logs?" + new URLSearchParams(params).toString()).then((r) => r.data);
export const getServiceBranches = (accountId, serviceId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/branches", { timeout: 30000 }).then((r) => r.data);
export const setServiceBranch = (accountId, serviceId, branch, deploy = true) => instance.post("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/branch", { branch, deploy }, { timeout: 60000 }).then((r) => r.data);
export const getRenderEnvVars = (accountId, serviceId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/env-vars").then((r) => r.data);
export const updateRenderEnvVar = (accountId, serviceId, key, value) => instance.put("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/env-vars/" + encodeURIComponent(key), { value }).then((r) => r.data);
export const deleteRenderEnvVar = (accountId, serviceId, key) => instance.delete("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/env-vars/" + encodeURIComponent(key)).then((r) => r.data);
export const getRenderDeploys = (accountId, serviceId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/deploys").then((r) => r.data);
export const triggerRenderDeploy = (accountId, serviceId, clearCache = false) => instance.post("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/deploys", { clearCache }).then((r) => r.data);
export const restartRenderService = (accountId, serviceId) => instance.post("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/restart").then((r) => r.data);
export const checkRenderHealth = (accountId, serviceId) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/health`).then((r) => r.data);
export const deleteRenderService = (accountId, serviceId, confirmName, allowActive = false) => instance.delete(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}`, { data: { confirmName, ...(allowActive ? { allowActive: true } : {}) } }).then((r) => r.data);
export const bulkDeleteRenderServices = (services, allowActive = false) => instance.post("/render/services/bulk-delete", { services, ...(allowActive ? { allowActive: true } : {}) }, { timeout: 120000 }).then((r) => r.data);
export const suspendRenderService = (accountId, serviceId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/suspend`).then((r) => r.data);
export const resumeRenderService = (accountId, serviceId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/resume`).then((r) => r.data);
export const rollbackRenderDeploy = (accountId, serviceId, deployId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/rollback`, { deployId }).then((r) => r.data);
export const cancelRenderDeploy = (accountId, serviceId, deployId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}/cancel`).then((r) => r.data);
export const createRenderSnapshot = (accountId, serviceId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/snapshots`).then((r) => r.data);
export const getRenderSnapshots = (accountId, serviceId) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/snapshots`).then((r) => r.data);
export const restoreRenderSnapshot = (accountId, serviceId, snapshotId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`).then((r) => r.data);
export const getRenderAudit = (limit = 50) => instance.get("/render/audit?limit=" + encodeURIComponent(limit)).then((r) => r.data);
export const getRenderEnvGroups = (accountId) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/env-groups`).then((r) => r.data);


// Aim for ~120 points whatever the range: a fixed 60s step makes 24h/7d pull 1,440+ points from Render, which is what made charts slow.
const metricResolution = (startTime) => Math.max(60, Math.min(3600, Math.ceil((Date.now() - Date.parse(startTime)) / 1000 / 120 / 30) * 30 || 60));
export const getRenderMetrics = (accountId, serviceId, metric, startTime) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/services/${encodeURIComponent(serviceId)}/metrics`, { params: { metric, startTime, resolutionSeconds: metricResolution(startTime) } }).then((r) => r.data);

export const getRenderDbExports = (accountId, postgresId) => instance.get(`/render/accounts/${encodeURIComponent(accountId)}/postgres/${encodeURIComponent(postgresId)}/exports`).then((r) => r.data);
export const createRenderDbExport = (accountId, postgresId) => instance.post(`/render/accounts/${encodeURIComponent(accountId)}/postgres/${encodeURIComponent(postgresId)}/exports`).then((r) => r.data);

export const syncProjectRenderEnv = (projectId, options = {}) => instance.post("/render/project-sync/" + encodeURIComponent(projectId), options, { timeout: 60000 }).then((r) => r.data);

/* One-click create & deploy (GitHub repo + free Render service + env vars) and Stashr -> Render env push. */
export const getRenderOwners = (accountId) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/owners").then((r) => r.data);
export const provisionProject = (body) => instance.post("/render/provision", body, { timeout: 180000 }).then((r) => r.data);
export const createRepo = (body) => instance.post("/render/repo/create", body, { timeout: 120000 }).then((r) => r.data);
export const checkRepoCode = (body) => instance.post("/render/repo/check", body, { timeout: 45000 }).then((r) => r.data);
export const deployProject = (body) => instance.post("/render/deploy", body, { timeout: 180000 }).then((r) => r.data);
export const getProjectDeployments = (projectId) => instance.get("/render/projects/" + encodeURIComponent(projectId) + "/deployments", { timeout: 30000 }).then((r) => r.data);
export const autoSyncProjects = (force = false) => instance.post("/render/projects/auto-sync", { force }, { timeout: 120000 }).then((r) => r.data);
export const syncAllProjectsWithRender = () => instance.post("/render/projects/sync-all", {}, { timeout: 120000 }).then((r) => r.data);
export const mergeProjects = (ids, keepId) => instance.post("/projects/merge", { ids, ...(keepId ? { keepId } : {}) }).then((r) => r.data);
export const pushProjectRenderEnv = (projectId, options = {}) => instance.post("/render/project-push/" + encodeURIComponent(projectId), options, { timeout: 90000 }).then((r) => r.data);

/* Automatic upkeep: live project health/drift (auto-links to Render first) and Servers-tab sync. */
export const getProjectStatuses = ({ id, refresh } = {}) => instance.get("/render/projects/status", { params: { ...(id ? { id } : {}), ...(refresh ? { refresh: 1 } : {}) }, timeout: 30000 }).then((r) => r.data);
export const getAllRenderServers = ({ refresh } = {}) => instance.get("/render/all-servers", { params: refresh ? { refresh: 1 } : {}, timeout: 30000 }).then((r) => r.data);
export const syncProjectServers = (id, body = {}) => instance.post(`/projects/items/${id}/servers/sync`, body, { timeout: 60000 }).then((r) => r.data);
export const deleteAdminUser = (id, confirmEmail) => instance.delete(`/admin/users/${encodeURIComponent(id)}`, { data: { confirmEmail } }).then((r) => r.data);
export const getServerUsage = (id, force = false) => instance.post(`/projects/items/${id}/server-usage`, { force }, { timeout: 60000 }).then((r) => r.data);
export const getRegistrySync = ({ refresh } = {}) => instance.get("/render/registry-sync", { params: refresh ? { refresh: 1 } : {}, timeout: 30000 }).then((r) => r.data);
export const syncRegistryEnv = (app, options = {}) => instance.post("/render/registry-env-sync/" + encodeURIComponent(app), options, { timeout: 90000 }).then((r) => r.data);
export const setRegistryAutoSync = (app, autoSync) => instance.put("/render/registry-sync/" + encodeURIComponent(app), { autoSync }).then((r) => r.data);

/* GitHub connections for the Projects page (tokens stay encrypted server-side). */
export const getGithubAccounts = () => instance.get("/github/accounts").then((r) => r.data);
export const connectGithubAccount = (data) => instance.post("/github/accounts", data).then((r) => r.data);
export const deleteGithubAccount = (id) => instance.delete("/github/accounts/" + encodeURIComponent(id)).then((r) => r.data);
export const getGithubRepo = (url, refresh = false) => instance.get("/github/repo", { params: { url, ...(refresh ? { refresh: 1 } : {}) } }).then((r) => r.data);
export const getGithubRepos = (accountId, refresh = false) => instance.get("/github/accounts/" + encodeURIComponent(accountId) + "/repos", { params: refresh ? { refresh: 1 } : {}, timeout: 30000 }).then((r) => r.data);
export const getGithubBranches = (githubAccountId, url) => instance.get("/github/repo/branches", { params: { githubAccountId, url }, timeout: 30000 }).then((r) => r.data);
export const deleteGithubBranches = (body) => instance.post("/github/repo/branches/delete", body, { timeout: 120000 }).then((r) => r.data);
const deployOpsPath = (projectId) => "/deploy-ops/projects/" + encodeURIComponent(projectId);
/* Every hosting provider (Render, Vercel, Netlify, Railway, Cloudflare Pages) behind one set of calls. `ref` names one server. */
export const getDeployTargets = (projectId) => instance.get(deployOpsPath(projectId) + "/targets", { timeout: 90000 }).then((r) => r.data);
export const getDeployEnv = (projectId, ref) => instance.get(deployOpsPath(projectId) + "/env", { params: { ref }, timeout: 60000 }).then((r) => r.data);
export const setDeployEnv = (projectId, ref, key, value) => instance.put(deployOpsPath(projectId) + "/env", { ref, key, value }).then((r) => r.data);
export const redeployDeployTarget = (projectId, ref, branch = "") => instance.post(deployOpsPath(projectId) + "/redeploy", { ref, branch }, { timeout: 120000 }).then((r) => r.data);
export const getDeployHistory = (projectId, ref) => instance.get(deployOpsPath(projectId) + "/deploys", { params: { ref }, timeout: 60000 }).then((r) => r.data);
export const getDeployLogs = (projectId, ref, deployId = "") => instance.get(deployOpsPath(projectId) + "/logs", { params: { ref, deployId }, timeout: 60000 }).then((r) => r.data);
export const setDeployBranch = (projectId, ref, branch, deploy = true) => instance.put(deployOpsPath(projectId) + "/branch", { ref, branch, deploy }, { timeout: 120000 }).then((r) => r.data);
export const moveDeployAccount = (projectId, ref, accountId) => instance.put(deployOpsPath(projectId) + "/account", { ref, accountId }).then((r) => r.data);
export const getAllDeployServers = () => instance.get("/deploy-ops/servers").then((r) => r.data);
export const syncDeployEnv = (projectId, body) => instance.post(deployOpsPath(projectId) + "/sync", body, { timeout: 180000 }).then((r) => r.data);
const movePath = (projectId) => "/move-server/" + encodeURIComponent(projectId);
/* Move one Render server to another account, one step per call (plan, create, status, frontends, relink, delete-old). */
export const movePlan = (projectId, body) => instance.post(movePath(projectId) + "/plan", body, { timeout: 90000 }).then((r) => r.data);
export const moveCreate = (projectId, body) => instance.post(movePath(projectId) + "/create", body, { timeout: 90000 }).then((r) => r.data);
export const moveCopyGroups = (projectId, body) => instance.post(movePath(projectId) + "/config/copy-groups", body, { timeout: 180000 }).then((r) => r.data);
export const moveStatus = (projectId, params) => instance.get(movePath(projectId) + "/status", { params, timeout: 60000 }).then((r) => r.data);
export const moveOrigin = (projectId, serviceId) => instance.get(movePath(projectId) + "/origin", { params: { serviceId } }).then((r) => r.data);
export const movePrepareDomains = (projectId, body) => instance.post(movePath(projectId) + "/domains/prepare", body, { timeout: 120000 }).then((r) => r.data);
export const moveVerifyDomains = (projectId, body) => instance.post(movePath(projectId) + "/domains/verify", body, { timeout: 120000 }).then((r) => r.data);
export const moveFrontends = (projectId, body) => instance.post(movePath(projectId) + "/frontends", body, { timeout: 180000 }).then((r) => r.data);
export const moveRelink = (projectId, body) => instance.post(movePath(projectId) + "/relink", body).then((r) => r.data);
export const moveDeleteOld = (projectId, body) => instance.post(movePath(projectId) + "/delete-old", body, { timeout: 60000 }).then((r) => r.data);

/* Persistent Render operations: all credentials remain encrypted server-side. */
export const getRenderOpsConfig = () => instance.get("/render/ops/config").then((r) => r.data);
export const saveRenderOpsConfig = (config) => instance.put("/render/ops/config", config).then((r) => r.data);
export const getRenderOpsHistory = (limit = 100) => instance.get("/render/ops/history", { params: { limit } }).then((r) => r.data);
export const getRenderOpsIncidents = (limit = 100) => instance.get("/render/ops/incidents", { params: { limit } }).then((r) => r.data);
export const resolveRenderIncidents = (payload) => instance.post("/render/ops/incidents/resolve", payload).then((r) => r.data);
export const clearRenderIncidents = () => instance.post("/render/ops/incidents/clear").then((r) => r.data);
export const getRenderEvents = (accountId, serviceId, startTime) => instance.get("/render/accounts/" + encodeURIComponent(accountId) + "/services/" + encodeURIComponent(serviceId) + "/events", { params: startTime ? { startTime } : {} }).then((r) => r.data);
const domainsPath = (a, s) => "/render/accounts/" + encodeURIComponent(a) + "/services/" + encodeURIComponent(s) + "/custom-domains";
export const getCustomDomains = (a, s) => instance.get(domainsPath(a, s)).then((r) => r.data);
export const addCustomDomain = (a, s, name) => instance.post(domainsPath(a, s), { name }).then((r) => r.data);
export const verifyCustomDomain = (a, s, name) => instance.post(domainsPath(a, s) + "/" + encodeURIComponent(name) + "/verify").then((r) => r.data);
export const removeCustomDomain = (a, s, name) => instance.delete(domainsPath(a, s) + "/" + encodeURIComponent(name)).then((r) => r.data);
export const findUrlReferences = (fromUrl) => instance.post("/render/url-references", { fromUrl }, { timeout: 180000 }).then((r) => r.data);
export const replaceUrlReferences = (payload) => instance.post("/render/url-replace", payload, { timeout: 180000 }).then((r) => r.data);
export const forgotPassword = (email) => instance.post("/forgot-password", { email }, { timeout: 60000 }).then((r) => r.data);
export const resetPassword = (payload) => instance.post("/reset-password", payload, { timeout: 60000 }).then((r) => r.data);
export const getTelegram = () => instance.get("/telegram").then((r) => r.data);
export const connectTelegram = (token) => instance.post("/telegram/connect", { token }, { timeout: 60000 }).then((r) => r.data);
export const saveTelegram = (patch) => instance.put("/telegram/settings", patch).then((r) => r.data);
export const testTelegramBot = () => instance.post("/telegram/test", {}, { timeout: 60000 }).then((r) => r.data);
/* Stashr Home: the TV, the tablet hub and the assistant. */
export const getHomeDevices = () => instance.get("/home/devices").then((r) => r.data);
export const renameHomeDevice = (id, name) => instance.put(`/home/devices/${id}`, { name }).then((r) => r.data);
export const setHomeSyncPaused = (id, paused) => instance.put(`/home/devices/${id}/sync`, { paused }).then((r) => r.data);
export const mergeHomeDevice = (id, into) => instance.post(`/home/devices/${id}/merge`, { into }).then((r) => r.data);
export const removeHomeDevice = (id) => instance.delete(`/home/devices/${id}`).then((r) => r.data);
export const sendHomeCommand = (id, type, args = {}) => instance.post(`/home/devices/${id}/commands`, { type, args }).then((r) => r.data);
export const labelHomeLanDevice = (id, key, label, room) => instance.put(`/home/devices/${id}/lan/${key}`, { label, room }).then((r) => r.data);
export const getHomeEvents = (limit = 40) => instance.get("/home/events", { params: { limit } }).then((r) => r.data);
export const getHomeMovies = () => instance.get("/home/movies/settings").then((r) => r.data);
export const startHomeMoviesGoogle = (full, label) => instance.get("/home/movies/google/start", { params: { ...(full ? { full: 1 } : {}), ...(label ? { label } : {}) } }).then((r) => r.data);
export const saveHomeMovies = (body) => instance.put("/home/movies/settings", body).then((r) => r.data);
export const askHomeAssistant = (text) => instance.post("/home/assistant", { text }).then((r) => r.data);
export const labelHomeLan = (id, key, body) => instance.put(`/home/devices/${id}/lan/${key}`, body).then((r) => r.data);
export const mergeHomeLan = (id, key, into) => instance.post(`/home/devices/${id}/lan/${key}/merge`, { into }).then((r) => r.data);
export const forgetHomeLan = (id, key) => instance.delete(`/home/devices/${id}/lan/${key}`).then((r) => r.data);
export const setHomePhonePerson = (id, person) => instance.put(`/home/devices/${id}/person`, { person }).then((r) => r.data);
export const makeHomePairCode = (kind, name) => instance.post("/home/pair-codes", { kind, name }).then((r) => r.data);
export const getHomeSettings = () => instance.get("/home/settings").then((r) => r.data);
export const saveHomeSettings = (body) => instance.put("/home/settings", body).then((r) => r.data);
export const getHomeDashboard = () => instance.get("/home/dashboard").then((r) => r.data);
export const getLocationCode = () => instance.get("/home/location-code").then((r) => r.data);
export const rotateLocationCode = () => instance.post("/home/location-code/rotate").then((r) => r.data);
export const getHubCode = () => instance.get("/home/hub-code").then((r) => r.data);
export const rotateHubCode = () => instance.post("/home/hub-code/rotate").then((r) => r.data);
export const getHomeInsights = () => instance.get("/home/insights").then((r) => r.data);
export const getHomeMap = () => instance.get("/home/map").then((r) => r.data);
export const saveHomeMap = (body) => instance.put("/home/map", body).then((r) => r.data);
export const getAppRollout = () => instance.get("/api/app-rollout").then((r) => r.data);
export const saveAppRollout = (app, body) => instance.put(`/api/app-rollout/${app}`, body).then((r) => r.data);
export const getRoomLive = () => instance.get("/home/room/live").then((r) => r.data);
export const setRoomModel = (on) => instance.post("/home/room/model", { on }).then((r) => r.data);
export const getHomeRooms = () => instance.get("/home/rooms").then((r) => r.data);
export const saveHomeRooms = (rooms) => instance.put("/home/rooms", { rooms }).then((r) => r.data);
export const setRoomPhone = (id, on) => instance.put(`/home/rooms/phone/${id}`, { on }).then((r) => r.data);
export const deleteRoomSamples = (body) => instance.delete("/home/rooms/samples", { data: body }).then((r) => r.data);
/** Deletes one room everywhere: every phone's training for it, its place on the map, a phone's "current room" that was it. */
export const deleteHomeRoom = (name) => instance.delete(`/home/room/${encodeURIComponent(name)}`).then((r) => r.data);
/** Auto-improve on or off for one phone. */
export const setRoomAuto = (id, auto) => instance.put(`/home/rooms/phone/${id}`, { auto }).then((r) => r.data);
/** Tune every phone's model and check its auto samples now (it also runs by itself once an hour). */
export const maintainRoomModel = () => instance.post("/home/room/maintain").then((r) => r.data);
export const getHomeTrail = () => instance.get("/home/trail").then((r) => r.data);
export const getTelegramDiagnose = () => instance.get("/telegram/diagnose").then((r) => r.data);
export const repairTelegram = () => instance.post("/telegram/repair").then((r) => r.data);
export const saveHouseLayout = (layout, reset = false) => instance.put("/home/map/layout", reset ? { reset: true } : { layout }).then((r) => r.data);
export const getHomeAddress = (lat, lon) => instance.get("/home/address", { params: { lat, lon } }).then((r) => r.data);
export const saveHomeHistory = (body) => instance.put("/home/history", body).then((r) => r.data);
export const deleteHomeHistory = () => instance.delete("/home/history").then((r) => r.data);
export const saveHomeSpots = (spots) => instance.put("/home/spots", { spots }).then((r) => r.data);
export const getHomeLive = (passive) => instance.get("/home/live" + (passive ? "?passive=1" : "")).then((r) => r.data);
export const searchPlace = (q) => instance.get("/home/geocode", { params: { q } }).then((r) => r.data);
export const getHomeWhere = () => instance.get("/home/where").then((r) => r.data);
/** "Refresh location": every family phone reports right away and every few seconds for the next 90 seconds. */
export const locateNow = () => instance.post("/home/locate-now").then((r) => r.data);
export const saveHomePlaces = (places) => instance.put("/home/places", { places }).then((r) => r.data);
export const getHomeShare = () => instance.get("/home/share").then((r) => r.data.share);
export const saveHomeShare = (body) => instance.put("/home/share", body).then((r) => r.data.share);
export const getHomePlaceTrail = (id) => instance.get(`/home/places/${id}/trail`).then((r) => r.data);
export const testHomePlace = (id, text) => instance.post(`/home/places/${id}/test`, { text }).then((r) => r.data);
export const saveHomeSchedules = (schedules) => instance.put("/home/schedules", { schedules }).then((r) => r.data);
export const saveHomeScenes = (scenes) => instance.put("/home/scenes", { scenes }).then((r) => r.data);
export const runHomeScene = (id) => instance.post(`/home/scenes/${id}/run`).then((r) => r.data);
export const getHomeUsage = (days = 14) => instance.get("/home/usage", { params: { days } }).then((r) => r.data);
export const getHomeSpeed = (days = 7) => instance.get("/home/speed", { params: { days } }).then((r) => r.data);
export const getHomeMedia = () => instance.get("/home/media").then((r) => r.data);
export const getHomeMediaBlob = (id) => instance.get(`/home/media/${id}`, { responseType: "blob" }).then((r) => r.data);
export const getHomeLiveFrame = () => instance.get("/home/camera/live", { responseType: "blob", validateStatus: (s) => s === 200 || s === 204 }).then((r) => (r.status === 200 ? r.data : null));
export const deleteHomeMedia = (id) => instance.delete(`/home/media/${id}`).then((r) => r.data);
export const testHomeBrief = (which = "brief") => instance.post("/home/brief/test", { which }).then((r) => r.data);
export const disconnectTelegram = () => instance.post("/telegram/disconnect").then((r) => r.data);
export const getRenderOpsStatus = () => instance.get("/render/ops/status").then((r) => r.data);
export const getPingResults = () => instance.get("/render/ops/pings").then((r) => r.data);
export const runPingsNow = () => instance.post("/render/ops/pings/run", {}, { timeout: 120000 }).then((r) => r.data);
export const scanHealthRoutes = () => instance.post("/render/ops/health-scan", {}, { timeout: 180000 }).then((r) => r.data);
export const addHealthRoute = (repoUrl, rootDir, merge = true) => instance.post("/github/health-route", { repoUrl, rootDir, merge }, { timeout: 120000 }).then((r) => r.data);
export const runRenderOpsNow = () => instance.post("/render/ops/run").then((r) => r.data);
export const testRenderOpsNotification = () => instance.post("/render/ops/notify/test").then((r) => r.data);
export const getRenderOpsReport = (format = "json") => instance.get("/render/ops/report", { params: { format }, responseType: format === "csv" ? "blob" : "json" }).then((r) => r.data);
export const diagnoseRenderLogs = (serviceName, logs, allowExternalProcessing = false) => instance.post("/render/ops/diagnose", { serviceName, logs, allowExternalProcessing }).then((r) => r.data);

/* Live-services usage dashboard (running Render services only; read-only provider checks). */
export const getLiveDashboard = ({ refresh, rescan } = {}) => instance.get("/render/live-dashboard", { params: { ...(refresh || rescan ? { refresh: 1 } : {}), ...(rescan ? { rescan: 1 } : {}) }, timeout: rescan ? 90000 : 45000 }).then((r) => r.data);
export const getUsageNeeds = () => instance.get("/render/usage-needs").then((r) => r.data);
export const getStatusPage = () => instance.get("/render/status-page").then((r) => r.data);
export const saveStatusPage = (body) => instance.put("/render/status-page", body).then((r) => r.data);
export const getStatusPageServices = () => instance.get("/render/status-page/services").then((r) => r.data);
export const getEnvScan = () => instance.get("/render/env-scan").then((r) => r.data);
export const getStashrPropagation = () => instance.get("/stashr/propagation").then((r) => r.data);
export const saveStashrPropagation = (body) => instance.put("/stashr/propagation", body).then((r) => r.data);
export const testStashrPropagation = (projectId) => instance.post("/stashr/propagation/test", { projectId }, { timeout: 90000 }).then((r) => r.data);
export const runStashrPropagation = () => instance.post("/stashr/propagation/run", {}, { timeout: 120000 }).then((r) => r.data);
export const getHoursBudget = () => instance.get("/render/hours-budget").then((r) => r.data);
export const getUsageSettings = () => instance.get("/render/usage-settings").then((r) => r.data);
export const saveUsageSettings = (body) => instance.put("/render/usage-settings", body).then((r) => r.data);

/* Other hosting providers (Vercel, Netlify, Railway, Cloudflare Pages): connections and "deploy this repo + branch". */
export const getHostAccounts = () => instance.get("/hosts/accounts").then((r) => r.data);
export const connectHostAccount = (body) => instance.post("/hosts/accounts", body, { timeout: 45000 }).then((r) => r.data);
export const deleteHostAccount = (id) => instance.delete("/hosts/accounts/" + encodeURIComponent(id)).then((r) => r.data);
export const deployToHost = (body) => instance.post("/hosts/deploy", body, { timeout: 180000 }).then((r) => r.data);
export const getHostOverview = () => instance.get("/hosts/overview", { timeout: 60000 }).then((r) => r.data);
export const getHostSites = (accountId) => instance.get("/hosts/accounts/" + encodeURIComponent(accountId) + "/sites", { timeout: 45000 }).then((r) => r.data);
export const getProjectHostLinks = (projectId) => instance.get("/hosts/projects/" + encodeURIComponent(projectId) + "/links", { timeout: 60000 }).then((r) => r.data);
export const linkHostSite = (projectId, body) => instance.post("/hosts/projects/" + encodeURIComponent(projectId) + "/links", body, { timeout: 45000 }).then((r) => r.data);
export const unlinkHostSite = (projectId, linkId) => instance.delete("/hosts/projects/" + encodeURIComponent(projectId) + "/links/" + encodeURIComponent(linkId)).then((r) => r.data);
export const getHostLinkBranches = (projectId, linkId) => instance.get("/hosts/projects/" + encodeURIComponent(projectId) + "/links/" + encodeURIComponent(linkId) + "/branches", { timeout: 30000 }).then((r) => r.data);
export const redeployHostLink = (projectId, linkId, branch) => instance.post("/hosts/projects/" + encodeURIComponent(projectId) + "/links/" + encodeURIComponent(linkId) + "/redeploy", { branch }, { timeout: 60000 }).then((r) => r.data);

/* ───────── money: UPI / bank messages and statements, kept only in the owner's Google Sheet ───────── */
export const getExpenseSettings = () => instance.get("/expenses/settings").then((r) => r.data);
export const saveExpenseSheet = (sheetUrl) => instance.put("/expenses/sheet", { sheetUrl }).then((r) => r.data);
export const setExpenseStorage = (mode) => instance.put("/expenses/storage", { mode }).then((r) => r.data);
export const unlinkExpenseSheet = () => instance.delete("/expenses/sheet").then((r) => r.data);
export const exportExpenseSheet = () => instance.post("/expenses/export-sheet").then((r) => r.data);
export const changeExpenseStart = (date) => instance.put("/expenses/start", { date }).then((r) => r.data);
export const setExpenseStart = (date) => instance.post("/expenses/start", { date }).then((r) => r.data);
export const removeUnmatchedExpenses = () => instance.post("/expenses/remove-unmatched").then((r) => r.data);
export const requestExpenseSync = () => instance.post("/expenses/sync-request").then((r) => r.data);
export const postExpenseSms = (messages) => instance.post("/expenses/sms", { messages }).then((r) => r.data);
export const getExpenses = (month) => instance.get("/expenses", { params: month ? { month } : {} }).then((r) => r.data);
export const setExpenseDescription = (index, description) => instance.put("/expenses/description", { index, description }).then((r) => r.data);
export const getUncategorized = (month) => instance.get("/expenses/uncategorized", { params: month ? { month } : {} }).then((r) => r.data);
export const setExpenseCategory = (index, category, remember) => instance.put("/expenses/category", { index, category, remember }).then((r) => r.data);
export const reviewExpense = (index, action) => instance.put("/expenses/review", { index, action }).then((r) => r.data);
export const getExpenseRules = () => instance.get("/expenses/rules").then((r) => r.data);
export const saveExpenseRules = (rules) => instance.put("/expenses/rules", { rules }).then((r) => r.data);
// The statement goes up first (the answer comes at once); reading, matching and saving carry on in the background and are followed with getStatementJob.
export const uploadStatementAsync = (file, onUploadProgress, { password, month } = {}) => instance.post("/expenses/statement", file, {
  params: { filename: file.name, async: 1, ...(month ? { month } : {}) },
  // a locked file's password goes in a header (never the address), URL-encoded so any characters survive
  headers: { "Content-Type": "application/octet-stream", ...(password ? { "X-Statement-Password": encodeURIComponent(password) } : {}) },
  transformRequest: [(data) => data],
  onUploadProgress,
  timeout: 120000
}).then((r) => r.data);
// Statements kept for searching later.
export const getSavedStatements = () => instance.get("/expenses/statement/saved").then((r) => r.data);
export const searchStatements = (q, month) => instance.get("/expenses/statement/search", { params: { q, ...(month ? { month } : {}) } }).then((r) => r.data);
export const deleteSavedStatement = (id) => instance.delete(`/expenses/statement/saved/${id}`).then((r) => r.data);
export const recheckStatements = ({ month } = {}) => instance.post("/expenses/statement/recheck", {}, { params: { async: 1, ...(month ? { month } : {}) } }).then((r) => r.data);
export const getStatementJob = (id) => instance.get("/expenses/statement/status", { params: id ? { job: id } : {} }).then((r) => r.data);
export const uploadStatement = (file) => instance.post("/expenses/statement", file, {
  params: { filename: file.name },
  headers: { "Content-Type": "application/octet-stream" },
  transformRequest: [(data) => data],
  timeout: 120000
}).then((r) => r.data);
export const getHouseModel = () => instance.get("/home/map/model", { responseType: "arraybuffer" }).then((r) => r.data);
export const saveHouseModel = (buffer, name) => instance.put("/home/map/model", buffer, { params: { name }, headers: { "Content-Type": "application/octet-stream" }, transformRequest: [(d) => d] }).then((r) => r.data);
export const deleteHouseModel = () => instance.delete("/home/map/model").then((r) => r.data);

/* WhatsApp sender: sheets, limits, on/off and test messages sent from the tablet. */
export const getWaOverview = () => instance.get("/wa/overview").then((r) => r.data);
export const saveWaSettings = (body) => instance.put("/wa/settings", body).then((r) => r.data);
/* SMS sender: Shine One's SMS to the We Three sheets, sent by the SMS Service phones and managed here. */
export const getSmsOverview = () => instance.get("/sms/overview", { timeout: 60000 }).then((r) => r.data);
export const saveSmsSettings = (body) => instance.put("/sms/settings", body).then((r) => r.data);
export const saveSmsSheet = (body) => instance.put("/sms/sheets", body).then((r) => r.data);
export const saveSmsDevice = (id, body) => instance.patch(`/sms/devices/${encodeURIComponent(id)}`, body).then((r) => r.data);
export const getSmsLog = (limit = 50) => instance.get("/sms/log", { params: { limit } }).then((r) => r.data);
export const sendSmsTest = (phoneNumber, message) => instance.post("/sms/test", { phoneNumber, message }).then((r) => r.data);
export const sendWaSheetToWeThree = (id) => instance.post(`/wa/sheets/${id}/we-three`, {}, { timeout: 120000 }).then((r) => r.data);
export const createWaSheet = (body) => instance.post("/wa/sheets", body).then((r) => r.data);
export const saveWaSheet = (id, body) => instance.patch(`/wa/sheets/${id}`, body).then((r) => r.data);
export const deleteWaSheet = (id, { alsoWeThree = false } = {}) => instance.delete(`/wa/sheets/${id}`, { params: alsoWeThree ? { alsoWeThree: 1 } : undefined, timeout: 60000 }).then((r) => r.data);
export const getWaPeople = (id, params) => instance.get(`/wa/sheets/${id}/people`, { params, timeout: 120000 }).then((r) => r.data);
export const editWaPerson = (id, pid, body) => instance.patch(`/wa/sheets/${id}/people/${pid}`, body).then((r) => r.data);
export const addWaPeople = (id, recipients) => instance.post(`/wa/sheets/${id}/recipients`, { recipients }, { timeout: 60000 }).then((r) => r.data);
/** Adds many people in requests of 500, so a big sheet never goes over the request size limit; returns the totals. */
export async function addWaPeopleInBatches(id, recipients, size = 500, onProgress) {
  const out = { added: 0, duplicates: 0, invalid: 0, total: 0, weThree: null, weThreeError: "" };
  for (let i = 0; i < recipients.length; i += size) {
    const r = await addWaPeople(id, recipients.slice(i, i + size));
    out.added += r.added || 0; out.duplicates += r.duplicates || 0; out.invalid += r.invalid || 0; out.total += r.total || 0;
    if (r.weThree) out.weThree = r.weThree;
    if (r.weThreeError) out.weThreeError = r.weThreeError;
    if (onProgress) onProgress(Math.min(i + size, recipients.length), recipients.length);
  }
  return out;
}
export const retryWaSheet = (id) => instance.post(`/wa/sheets/${id}/retry`).then((r) => r.data);
export const sendWaTest = (body) => instance.post("/wa/test", body).then((r) => r.data);
export const getWaSend = (id) => instance.get(`/wa/sends/${id}`).then((r) => r.data);
export const getWaLink = () => instance.get("/wa/threads").then((r) => r.data);
export const connectWaLink = (mobile, mpin) => instance.post("/wa/threads/connect", { mobile, mpin }, { timeout: 45000 }).then((r) => r.data);
export const disconnectWaLink = () => instance.delete("/wa/threads").then((r) => r.data);
export const getWaOrigins = () => instance.get("/wa/threads/origins", { timeout: 45000 }).then((r) => r.data);
export const importWaOrigin = (origin) => instance.post("/wa/threads/import", { origin }, { timeout: 180000 }).then((r) => r.data);
export const getWaPictures = () => instance.get("/wa/pictures").then((r) => r.data);
export const getWaPicture = (sheet, index) => instance.get(`/wa/pictures/${sheet}/${index}`).then((r) => r.data);
export const resetWaSheet = (id) => instance.post(`/wa/sheets/${id}/reset`).then((r) => r.data);
export const sendWaReportNow = () => instance.post("/wa/report/now").then((r) => r.data);
