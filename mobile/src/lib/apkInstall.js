import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import Constants from "expo-constants";

/*
 * Download an APK from the Stashr server and hand it to Android's installer. Used by Settings (the Stashr app) and by Apps (the launcher,
 * Location, Hub, TV, Cast), so every app updates the same way: a progress bar, a check that every byte arrived, the installer pop-up, and an
 * "Install" button that opens the installer again WITHOUT downloading the file a second time.
 */
const MIME = "application/vnd.android.package-archive";
const pkg = () => (Constants.expoConfig && Constants.expoConfig.android && Constants.expoConfig.android.package) || "com.tanush.stashr.com";

/** Where a given APK is kept: one file per app and build, so a finished download is found again. */
export const apkPath = (key, versionCode) => `${FileSystem.cacheDirectory}stashr-${String(key).replace(/[^a-z0-9]/gi, "")}-${Number(versionCode) || 0}.apk`;

/** The file is there and its size is exactly what the server said: it can be installed without downloading again. */
export async function haveApk(key, versionCode, sizeBytes) {
  try {
    const info = await FileSystem.getInfoAsync(apkPath(key, versionCode));
    return info.exists && info.size > 0 && (!sizeBytes || info.size === Number(sizeBytes)) ? info.uri : "";
  } catch (e) { return ""; }
}

/**
 * Downloads (or reuses) the APK. manifest: { versionCode, sizeBytes, downloadUrl }. onProgress({ pct, got, total }) while it downloads.
 * Returns the local file uri. Throws an Error with a plain message when the server answers badly or the file is incomplete.
 */
export async function downloadApk(key, manifest, onProgress = () => {}) {
  const total = Number(manifest.sizeBytes) || 0;
  const reuse = await haveApk(key, manifest.versionCode, total);
  if (reuse) { onProgress({ pct: 100, got: total, total }); return reuse; }
  const destination = apkPath(key, manifest.versionCode);
  try { await FileSystem.deleteAsync(destination, { idempotent: true }); } catch (e) { /* nothing left over */ }
  let lastPct = -1;
  const task = FileSystem.createDownloadResumable(manifest.downloadUrl, destination, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
    const expected = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : total;
    const pct = expected > 0 ? Math.min(99, Math.floor((totalBytesWritten / expected) * 100)) : 0;
    if (pct !== lastPct) { lastPct = pct; onProgress({ pct, got: totalBytesWritten, total: expected }); }
  });
  const done = await task.downloadAsync();
  if (!done || done.status !== 200) throw new Error(`the server answered HTTP ${done ? done.status : "nothing"}`);
  const info = await FileSystem.getInfoAsync(done.uri);
  if (!info.exists || !info.size) throw new Error("the downloaded file is missing");
  if (total && info.size !== total) { try { await FileSystem.deleteAsync(done.uri, { idempotent: true }); } catch (e) { /* ignore */ } throw new Error(`incomplete: ${info.size} of ${total} bytes arrived`); }
  onProgress({ pct: 100, got: info.size, total: info.size });
  return done.uri;
}

/**
 * Opens Android's package installer for the downloaded file (the file type is what makes the pop-up appear). If Android has not yet
 * allowed this app to install apps, it opens that one switch and says so; come back and press Install again.
 * Returns "installer" or "needs-permission".
 */
export async function installApk(uri) {
  if (Platform.OS !== "android") throw new Error("Installing an APK is only possible on Android.");
  const data = await FileSystem.getContentUriAsync(uri);
  try {
    await IntentLauncher.startActivityAsync("android.intent.action.INSTALL_PACKAGE", { data, flags: 1, type: MIME, extra: { "android.intent.extra.NOT_UNKNOWN_SOURCE": true } });
    return "installer";
  } catch (first) {
    try {
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", { data, flags: 1, type: MIME });
      return "installer";
    } catch (second) {
      await IntentLauncher.startActivityAsync("android.settings.MANAGE_UNKNOWN_APP_SOURCES", { data: `package:${pkg()}` });
      return "needs-permission";
    }
  }
}
