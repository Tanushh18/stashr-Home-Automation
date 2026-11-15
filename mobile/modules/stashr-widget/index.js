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

/** Placed widgets per kind: { home, scenes, tv, quick, money, net }. */
export const widgetCounts = () => {
  const none = { home: 0, scenes: 0, tv: 0, quick: 0, money: 0, net: 0 };
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
