import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

/*
 * The "Stashr Home" home-screen widget and the long-press shortcuts on the Stashr icon. Android only; everywhere else
 * (Expo Go, web, iOS) every call is a harmless no-op. The widget only shows display text the app hands it.
 */
const native = Platform.OS === "android" ? requireOptionalNativeModule("StashrWidget") : null;

export const widgetSupported = Boolean(native);

/** Saves the widget's lines ({ coming, people, weather, tv, updatedAt }) and redraws every widget. */
export const setSnapshot = (snapshot) => {
  if (!native) return;
  try { native.setSnapshot(JSON.stringify(snapshot || {})); } catch (e) { /* the widget keeps its last text */ }
};

/** How many Stashr Home widgets are on the home screen. */
export const widgetCount = () => {
  if (!native) return 0;
  try { return Number(native.widgetCount()) || 0; } catch (e) { return 0; }
};

/** Placed widgets per kind: { home, scenes, tv, quick, money, net, search }. */
export const widgetCounts = () => {
  const none = { home: 0, scenes: 0, tv: 0, quick: 0, money: 0, net: 0, search: 0 };
  if (!native) return none;
  try { return { ...none, ...(native.widgetCounts() || {}) }; } catch (e) { return none; }
};

/** The per-install secret on every widget button; "" when the module is missing (then no widget action is accepted). */
export const actionKey = () => {
  if (!native) return "";
  try { return String(native.actionKey() || ""); } catch (e) { return ""; }
};

/** Asks the launcher to add the widget. false when this launcher or Android version cannot. */
export const requestPin = () => {
  if (!native) return false;
  try { return Boolean(native.requestPin()); } catch (e) { return false; }
};

/** Long-press shortcuts: [{ id, label, long?, url: "stashr://…", icon: "home"|"tv"|"camera"|"money"|"key" }]. */
export const setShortcuts = (list) => {
  if (!native) return false;
  try { return Boolean(native.setShortcuts(JSON.stringify(list || []))); } catch (e) { return false; }
};

/** Asks the launcher to put one stashr:// button on the home screen (Android 8+): { id, label, url, icon }. false when it cannot. */
export const pinShortcut = ({ id, label, url, icon }) => {
  if (!native) return false;
  try { return Boolean(native.pinShortcut(String(id), String(label), String(url), String(icon || "home"))); } catch (e) { return false; }
};

/** The 15-second live refresh (only while the screen is on): the read-only widget key and the server list, then start/stop. */
export const setLiveConfig = (key, servers) => {
  if (!native) return false;
  try { native.setLiveConfig(String(key), JSON.stringify(servers || [])); return true; } catch (e) { return false; }
};
export const startLive = () => { if (!native) return false; try { return Boolean(native.startLive()); } catch (e) { return false; } };
export const stopLive = () => { if (native) { try { native.stopLive(); } catch (e) { /* not running */ } } };
export const liveInfo = () => { if (!native) return { hasKey: false, bad: false }; try { return native.liveInfo(); } catch (e) { return { hasKey: false, bad: false }; } };
export const setLiveServers = (servers) => { if (!native) return false; try { native.setLiveServers(JSON.stringify(servers || [])); return true; } catch (e) { return false; } };
