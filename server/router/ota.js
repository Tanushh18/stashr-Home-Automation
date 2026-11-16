const crypto = require("node:crypto");
const express = require("express");
const { fetchWithHeaderTimeout, pipeUpstream } = require("../utils/upstreamStream");

// Self-hosted Expo Updates endpoint. The GitHub Actions release workflow publishes
// ota-manifest.json plus the content-addressed bundle/asset files next to the APK.
// This router speaks the Expo Updates protocol (version 1) and streams those files.
const router = express.Router();
const GITHUB_REPOSITORY = process.env.STASHR_UPDATE_REPOSITORY || "Tanushh18/password-manager";
const MANIFEST_ASSET = "ota-manifest.json";
const ASSET_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
// GitHub allows only 60 API calls an hour to a server without a token; a 5 minute cache keeps this server well below that.
const CACHE_MS = 5 * 60_000;
let cachedRelease = null;
let cachedAt = 0;

function githubHeaders(accept) {
  return {
    Accept: accept,
    "User-Agent": "Stashr-Android-Updater",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(process.env.STASHR_UPDATE_GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.STASHR_UPDATE_GITHUB_TOKEN}` } : {}),
  };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function latestRelease() {
  if (cachedRelease && Date.now() - cachedAt < CACHE_MS) return cachedRelease;
  try { return await loadLatestRelease(); }
  catch (error) {
    // GitHub is rate limiting this server or is down: keep serving the last good release instead of failing every phone's update check.
    if (cachedRelease && error.status !== 404) return cachedRelease;
    throw error;
  }
}

async function loadLatestRelease() {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`, {
    headers: githubHeaders("application/vnd.github+json"),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw httpError(response.status === 404 ? 404 : 502, `Release service returned HTTP ${response.status}`);
  const release = await response.json();
  if (release.draft || release.prerelease) throw httpError(404, "No stable Stashr release is published yet.");

  const assets = release.assets || [];
  const manifestAsset = assets.find((asset) => asset.name === MANIFEST_ASSET);
  if (!manifestAsset) throw httpError(404, "The latest release has no OTA manifest.");

  const manifestResponse = await fetch(manifestAsset.url, {
    headers: githubHeaders("application/octet-stream"),
    signal: AbortSignal.timeout(10_000),
  });
  if (!manifestResponse.ok) throw httpError(502, "Could not read the OTA manifest.");
  const manifest = await manifestResponse.json();
  if (!manifest.id || !manifest.runtimeVersion || !manifest.launchAsset) {
    throw httpError(502, "The OTA manifest is invalid.");
  }

  cachedRelease = { assets, manifest };
  cachedAt = Date.now();
  return cachedRelease;
}

// Expo clients send the native runtime they were built for; the bundle is only valid for that runtime.
function publicAsset(asset, origin) {
  const { fileName, ...rest } = asset;
  return { ...rest, url: `${origin}/api/ota/asset/${encodeURIComponent(fileName)}` };
}

function multipartBody(boundary, manifest) {
  const part = (name, contentType, body) =>
    `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\ncontent-type: ${contentType}\r\n\r\n${body}\r\n`;
  return (
    part("manifest", "application/expo+json", JSON.stringify(manifest)) +
    part("extensions", "application/json", JSON.stringify({ assetRequestHeaders: {} })) +
    `--${boundary}--\r\n`
  );
}

router.get("/manifest", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    if (req.get("expo-protocol-version") !== "1") return res.status(400).json({ error: "Unsupported Expo Updates protocol version." });
    if (req.get("expo-platform") !== "android") return res.status(400).json({ error: "Only android updates are published." });
    const runtimeVersion = req.get("expo-runtime-version");
    if (!runtimeVersion) return res.status(400).json({ error: "expo-runtime-version header is required." });

    const { manifest } = await latestRelease();
    if (manifest.runtimeVersion !== runtimeVersion) return res.status(204).end();

    const origin = `${req.protocol}://${req.get("host")}`;
    const body = {
      id: manifest.id,
      createdAt: manifest.createdAt,
      runtimeVersion: manifest.runtimeVersion,
      launchAsset: publicAsset(manifest.launchAsset, origin),
      assets: (manifest.assets || []).map((asset) => publicAsset(asset, origin)),
      metadata: manifest.metadata || {},
      extra: {},
    };
    const boundary = `stashr-${crypto.randomUUID()}`;
    res.set("expo-protocol-version", "1");
    res.set("expo-sfv-version", "0");
    res.set("cache-control", "private, max-age=0");
    res.set("content-type", `multipart/mixed; boundary=${boundary}`);
    return res.status(200).send(multipartBody(boundary, body));
  } catch (error) {
    return res.status(error.status || 502).json({
      error: "OTA updates are temporarily unavailable.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

router.get("/asset/:name", async (req, res) => {
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  try {
    const name = req.params.name;
    if (!ASSET_NAME_PATTERN.test(name)) return res.status(400).json({ error: "Invalid asset name." });
    const { assets } = await latestRelease();
    const asset = assets.find((item) => item.name === name);
    if (!asset) return res.status(404).json({ error: "Asset not found." });

    // Public release file: GitHub serves it directly, so the bundle does not use this server's bandwidth.
    if (asset.browser_download_url) return res.redirect(302, asset.browser_download_url);
    const response = await fetchWithHeaderTimeout(asset.url, { headers: githubHeaders("application/octet-stream") }, 30_000);
    if (!response.ok || !response.body) throw httpError(502, `GitHub asset download returned HTTP ${response.status}`);
    res.status(200);
    res.set("Content-Type", "application/octet-stream");
    res.set("X-Content-Type-Options", "nosniff");
    if (asset.size > 0) res.set("Content-Length", String(asset.size));
    return pipeUpstream(response, res);
  } catch (error) {
    if (res.headersSent) return res.destroy(error);
    return res.status(error.status || 502).json({
      error: "The requested update asset is not available.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

module.exports = router;
