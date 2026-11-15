const express = require("express");
const { fetchWithHeaderTimeout, pipeUpstream } = require("../utils/upstreamStream");
const { latestFromFeed } = require("../utils/releaseFeed");

const rollout = require("../utils/rollout");

const router = express.Router();
const GITHUB_REPOSITORY = process.env.STASHR_UPDATE_REPOSITORY || "Tanushh18/stashr-Home-Automation";
const EXPECTED_PACKAGE = "com.tanush.stashr.com";
// GitHub lets a server without a token call its API only 60 times an hour, and Render shares one address between many sites. A longer cache
// (and one shared release list for the small apps) keeps this server far below that.
const CACHE_MS = 5 * 60_000;
let cachedRelease = null;
let cachedAt = 0;

async function githubJson(url) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Stashr-Android-Updater",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.STASHR_UPDATE_GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.STASHR_UPDATE_GITHUB_TOKEN}`;
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const error = new Error(`Release service returned HTTP ${response.status}`);
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  return response.json();
}

async function latestRelease() {
  if (cachedRelease && Date.now() - cachedAt < CACHE_MS) return cachedRelease;

  let release;
  try { release = await githubJson(`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`); }
  catch (error) {
    // GitHub is rate limiting this server (shared address, no token) or is down: keep serving the last good answer.
    if (cachedRelease && error.status !== 404) { console.error(`[mobile-updates] ${error.message}; serving the last known release`); return cachedRelease; }
    throw error;
  }
  if (release.draft || release.prerelease) {
    const error = new Error("No stable Stashr Android release is published yet.");
    error.status = 404;
    throw error;
  }

  const apk = (release.assets || []).find((asset) => asset.name === "stashr-release.apk");
  const manifestAsset = (release.assets || []).find((asset) => asset.name === "stashr-update.json");
  if (!apk || !manifestAsset || !apk.browser_download_url || !manifestAsset.browser_download_url) {
    const error = new Error("The latest release is missing its APK or update manifest.");
    error.status = 503;
    throw error;
  }

  const manifestResponse = await fetch(manifestAsset.url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "Stashr-Android-Updater",
      ...(process.env.STASHR_UPDATE_GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.STASHR_UPDATE_GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!manifestResponse.ok) {
    const error = new Error("Could not read the latest release manifest.");
    error.status = 502;
    throw error;
  }
  const manifest = await manifestResponse.json();
  const versionCode = Number(manifest.versionCode);
  if (manifest.packageName !== EXPECTED_PACKAGE || !Number.isSafeInteger(versionCode) || versionCode < 1 ||
      typeof manifest.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.version) ||
      typeof manifest.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.sha256) ||
      !Number.isSafeInteger(Number(manifest.sizeBytes)) || Number(manifest.sizeBytes) < 1) {
    const error = new Error("The latest Android release manifest is invalid.");
    error.status = 502;
    throw error;
  }

  cachedRelease = {
    version: manifest.version,
    versionCode,
    buildNumber: Number(manifest.buildNumber || versionCode),
    packageName: EXPECTED_PACKAGE,
    sha256: String(manifest.sha256 || ""),
    sizeBytes: Number(manifest.sizeBytes || apk.size || 0),
    releaseNotes: String(manifest.releaseNotes || release.name || "Stashr update"),
    publishedAt: release.published_at || null,
    tagName: release.tag_name,
    downloadUrl: apk.browser_download_url,
    assetApiUrl: apk.url,
  };
  cachedAt = Date.now();
  return cachedRelease;
}

router.get("/android/latest", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const release = await latestRelease();
    const currentVersionCode = Number.parseInt(String(req.query.currentVersionCode || "0"), 10) || 0;
    const origin = `${req.protocol}://${req.get("host")}`;
    return res.json({
      appId: release.packageName,
      version: release.version,
      versionCode: release.versionCode,
      buildNumber: release.buildNumber,
      sha256: release.sha256,
      sizeBytes: release.sizeBytes,
      releaseNotes: release.releaseNotes,
      publishedAt: release.publishedAt,
      tagName: release.tagName,
      updateAvailable: currentVersionCode < release.versionCode && await rollout.offered("android", release.versionCode, req),
      downloadUrl: `${origin}/api/mobile-updates/android/download`,
    });
  } catch (error) {
    return res.status(error.status || 502).json({
      error: "Android update information is temporarily unavailable.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

router.get("/android/download", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const release = await latestRelease();
    const headers = {
      Accept: "application/octet-stream",
      "User-Agent": "Stashr-Android-Updater",
      ...(process.env.STASHR_UPDATE_GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.STASHR_UPDATE_GITHUB_TOKEN}` } : {}),
    };
    const response = await fetchWithHeaderTimeout(release.assetApiUrl, { headers }, 30_000);
    if (!response.ok || !response.body) {
      const error = new Error(`GitHub asset download returned HTTP ${response.status}`);
      error.status = 502;
      throw error;
    }
    res.status(200);
    res.set("Content-Type", "application/vnd.android.package-archive");
    res.set("Content-Disposition", `attachment; filename="Stashr-${release.version}-build-${release.versionCode}.apk"`);
    res.set("X-Content-Type-Options", "nosniff");
    if (release.sizeBytes > 0) res.set("Content-Length", String(release.sizeBytes));
    return pipeUpstream(response, res);
  } catch (error) {
    if (res.headersSent) return res.destroy(error);
    // The release is public on GitHub: its own "latest" link needs no API call, so a rate-limited server still gives the APK.
    if (error.status !== 404) return res.redirect(302, `https://github.com/${GITHUB_REPOSITORY}/releases/latest/download/stashr-release.apk`);
    return res.status(error.status || 502).json({
      error: "The latest Android APK is not available yet.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

/*
 * Stashr Hub (the home tablet and family phone app) and Stashr Location (the location-only app for family phones) ship
 * from the same repository as their own GitHub Releases, tagged "stashr-<app>-v<version>-build-<code>" and never marked
 * "latest", so the main app's update check is not affected.
 */
const SIDE_APPS = {
  hub: { label: "Stashr Hub", pkg: "com.tanush.stashr.hub", prefix: "stashr-hub-v", apk: "stashr-hub.apk", manifest: "stashr-hub-update.json", file: "Stashr-Hub" },
  tv: { label: "Stashr TV", pkg: "com.tanush.stashr.tv", prefix: "stashr-tv-v", apk: "stashr-tv.apk", manifest: "stashr-tv-update.json", file: "Stashr-TV" },
  cast: { label: "Stashr Cast", pkg: "com.tanush.stashr.cast", prefix: "stashr-cast-v", apk: "stashr-cast.apk", manifest: "stashr-cast-update.json", file: "Stashr-Cast" },
  where: { label: "Stashr Location", pkg: "com.tanush.stashr.where", prefix: "stashr-where-v", apk: "stashr-where.apk", manifest: "stashr-where-update.json", file: "Stashr-Location" },
  // The phone launcher (Lawnchair + Stashr changes, launcher-app/). No device identity, so like Cast it is offered to everyone.
  launcher: { label: "Stashr Launcher", pkg: "com.tanush.stashr.launcher", prefix: "stashr-launcher-v", apk: "stashr-launcher.apk", manifest: "stashr-launcher-update.json", file: "Stashr-Launcher" },
};
const NO_ROLLOUT = new Set(["cast", "launcher"]);
const sideCache = {};

function ghHeaders(accept) {
  return { Accept: accept, "User-Agent": "Stashr-Android-Updater", ...(process.env.STASHR_UPDATE_GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.STASHR_UPDATE_GITHUB_TOKEN}` } : {}) };
}

let sideList = null, sideListAt = 0;
/** One GitHub call for the release list, shared by Hub, TV, Cast, Location and the launcher. */
async function sideReleases() {
  if (sideList && Date.now() - sideListAt < CACHE_MS) return sideList;
  const list = await githubJson(`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases?per_page=40`);
  sideList = list; sideListAt = Date.now();
  return list;
}

async function latestSideRelease(key) {
  const app = SIDE_APPS[key];
  const hit = sideCache[key];
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let releases;
  try { releases = await sideReleases(); }
  catch (error) {
    // GitHub is rate limiting this server or is down: keep serving the last good answer instead of failing every update check.
    console.error(`[mobile-updates] ${app.label}: ${error.message}`);
    if (hit) return hit.value;
    // No earlier answer to fall back on: ask GitHub's public release feed, which is not rate limited like the API.
    const viaFeed = await latestFromFeed(GITHUB_REPOSITORY, app).catch(() => null);
    if (viaFeed) { sideCache[key] = { value: viaFeed, at: Date.now() }; return viaFeed; }
    throw error;
  }
  const release = (Array.isArray(releases) ? releases : []).find((r) => !r.draft && !r.prerelease && String(r.tag_name || "").startsWith(app.prefix));
  const apk = release && (release.assets || []).find((a) => a.name === app.apk);
  const manifestAsset = release && (release.assets || []).find((a) => a.name === app.manifest);
  if (!release || !apk || !manifestAsset) throw Object.assign(new Error(`No ${app.label} release is published yet.`), { status: 404 });
  const manifestResponse = await fetch(manifestAsset.url, { headers: ghHeaders("application/octet-stream"), signal: AbortSignal.timeout(10_000) });
  if (!manifestResponse.ok) throw Object.assign(new Error(`Could not read the ${app.label} release manifest.`), { status: 502 });
  const manifest = await manifestResponse.json();
  const versionCode = Number(manifest.versionCode);
  if (manifest.packageName !== app.pkg || !Number.isSafeInteger(versionCode) || versionCode < 1 || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(String(manifest.version || "")) ||
      !/^[a-f0-9]{64}$/i.test(String(manifest.sha256 || "")) || !Number.isSafeInteger(Number(manifest.sizeBytes)) || Number(manifest.sizeBytes) < 1) {
    throw Object.assign(new Error(`The ${app.label} release manifest is invalid.`), { status: 502 });
  }
  const value = {
    version: manifest.version, versionCode, sha256: manifest.sha256.toLowerCase(), sizeBytes: Number(manifest.sizeBytes),
    releaseNotes: String(manifest.releaseNotes || release.name || `${app.label} update`), publishedAt: release.published_at || null,
    tagName: release.tag_name, assetApiUrl: apk.url,
  };
  sideCache[key] = { value, at: Date.now() };
  return value;
}

for (const key of Object.keys(SIDE_APPS)) {
  const app = SIDE_APPS[key];
  router.get(`/${key}/latest`, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const r = await latestSideRelease(key);
      const current = Number.parseInt(String(req.query.currentVersionCode || "0"), 10) || 0;
      const origin = `${req.protocol}://${req.get("host")}`;
      return res.json({ appId: app.pkg, version: r.version, versionCode: r.versionCode, sha256: r.sha256, sizeBytes: r.sizeBytes, releaseNotes: r.releaseNotes,
        publishedAt: r.publishedAt, tagName: r.tagName, updateAvailable: current < r.versionCode && (NO_ROLLOUT.has(key) || await rollout.offered(key, r.versionCode, req)), downloadUrl: `${origin}/api/mobile-updates/${key}/download` });
    } catch (error) {
      return res.status(error.status || 502).json({ error: `${app.label} update information is temporarily unavailable.`, detail: process.env.NODE_ENV === "production" ? undefined : error.message });
    }
  });

  router.get(`/${key}/download`, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    let direct = "";
    try {
      const r = await latestSideRelease(key);
      // The release is public: GitHub's own download link needs no API call, so it is the fallback whenever the proxy path cannot be used.
      direct = r.directUrl || `https://github.com/${GITHUB_REPOSITORY}/releases/download/${encodeURIComponent(r.tagName)}/${app.apk}`;
      if (!r.assetApiUrl) return res.redirect(302, direct);
      const response = await fetchWithHeaderTimeout(r.assetApiUrl, { headers: ghHeaders("application/octet-stream") }, 30_000);
      if (!response.ok || !response.body) throw Object.assign(new Error(`GitHub asset download returned HTTP ${response.status}`), { status: 502 });
      res.status(200);
      res.set("Content-Type", "application/vnd.android.package-archive");
      res.set("Content-Disposition", `attachment; filename="${app.file}-${r.version}-build-${r.versionCode}.apk"`);
      res.set("X-Content-Type-Options", "nosniff");
      if (r.sizeBytes > 0) res.set("Content-Length", String(r.sizeBytes));
      return pipeUpstream(response, res);
    } catch (error) {
      if (res.headersSent) return res.destroy(error);
      if (direct && error.status !== 404) return res.redirect(302, direct);
      return res.status(error.status || 502).json({ error: `The ${app.label} APK is not available yet.`, detail: process.env.NODE_ENV === "production" ? undefined : error.message });
    }
  });
}

// For the rollout page: the newest release of each app, as the update check sees it.
router._latest = { main: (...a) => latestRelease(...a), side: (...a) => latestSideRelease(...a) };
router._resetCache = () => { rollout.forget("android"); rollout.forget("where"); rollout.forget("hub"); rollout.forget("tv"); cachedRelease = null; cachedAt = 0; sideList = null; sideListAt = 0; for (const k of Object.keys(sideCache)) delete sideCache[k]; };
module.exports = router;
