import { Platform } from "react-native";
import { loadSavedToken, refreshServers } from "./api";
import { home } from "./homeApi";
import { widgetSnapshot } from "./widgetText";
import { setSnapshot, widgetCount, setShortcuts, requestPin, widgetSupported } from "../../modules/stashr-widget";

/*
 * The "Stashr Home" home-screen widget and the long-press shortcuts on the Stashr icon.
 * The widget only shows display text (who is coming, who is home, weather, TV) taken from GET /home/dashboard.
 * It refreshes when Smart home loads and about every 15 minutes in the background, and only while a widget is placed.
 */
export const HOME_WIDGET_TASK = "stashr-home-widget";
export { widgetSupported, widgetCount, requestPin };

/** Long-press shortcuts. Each link is a route in this app; the lock screen still comes first when the vault is locked. */
export const SHORTCUTS = [
  { id: "home", label: "Stashr Home", long: "Open Stashr Home", url: "stashr://stashr-home", icon: "home" },
  { id: "tv", label: "TV remote", long: "TV and devices", url: "stashr://home?tab=devices", icon: "tv" },
  { id: "camera", label: "Camera", long: "Camera and alerts", url: "stashr://home?tab=security", icon: "camera" },
  { id: "money", label: "Money", long: "Money", url: "stashr://money", icon: "money" },
  { id: "vault", label: "Passwords", long: "Passwords", url: "stashr:///", icon: "key" },
];

/** Paths the shortcuts and the widget open; used by the root layout to resume them after the unlock. */
export const LINK_PATHS = ["/home", "/stashr-home", "/money", "/"];

export function installShortcuts() {
  return setShortcuts(SHORTCUTS);
}

/** Puts an already-loaded dashboard on the widget (Smart home calls this, so no extra request). */
export function pushHomeWidget(dashboard) {
  if (!widgetSupported || !dashboard || widgetCount() === 0) return;
  setSnapshot(widgetSnapshot(dashboard));
}

/** Loads the dashboard and updates the widget. Does nothing when no widget is placed. */
export async function refreshHomeWidget() {
  if (!widgetSupported || widgetCount() === 0) return false;
  setSnapshot(widgetSnapshot(await home.dashboard()));
  return true;
}

/** After sign-out: the widget forgets the home and says to open Stashr. */
export function clearHomeWidget() {
  if (widgetSupported) setSnapshot({});
}

if (Platform.OS === "android") {
  const TaskManager = require("expo-task-manager");
  const BackgroundTask = require("expo-background-task");
  TaskManager.defineTask(HOME_WIDGET_TASK, async () => {
    try {
      if (widgetCount() === 0) return BackgroundTask.BackgroundTaskResult.Success;
      if (!(await loadSavedToken())) { clearHomeWidget(); return BackgroundTask.BackgroundTaskResult.Success; }
      await refreshServers().catch(() => {});
      await refreshHomeWidget();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (e) {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Registers the 15-minute refresh while a widget is placed, and removes it when none is. */
export async function syncHomeWidgetTask() {
  if (Platform.OS !== "android") return;
  try {
    const TaskManager = require("expo-task-manager");
    const BackgroundTask = require("expo-background-task");
    const on = widgetCount() > 0;
    const registered = await TaskManager.isTaskRegisteredAsync(HOME_WIDGET_TASK);
    if (on && !registered) await BackgroundTask.registerTaskAsync(HOME_WIDGET_TASK, { minimumInterval: 15 });
    if (!on && registered) await BackgroundTask.unregisterTaskAsync(HOME_WIDGET_TASK);
  } catch (e) { /* the scheduler may be unavailable; the widget still updates when Smart home opens */ }
}
