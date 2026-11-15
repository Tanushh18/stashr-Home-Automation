import { Platform } from "react-native";
import { loadSavedToken, refreshServers } from "./api";
import { home } from "./homeApi";
import { money } from "./moneyApi";
import { healthItems } from "./smartHome";
import { widgetSnapshot, scenesOf, moneyLines, netLines } from "./widgetText";
import { setSnapshot, widgetCount, widgetCounts, actionKey, setShortcuts, requestPin, widgetSupported } from "../../modules/stashr-widget";

/*
 * The Stashr home-screen widgets (Home, Scenes, TV remote, Quick actions, Money, Network) and the long-press shortcuts.
 * The widgets only show display text and scene ids taken from GET /home/dashboard, GET /home/devices and GET /expenses.
 * Money and the network are only loaded while such a widget is placed. Everything refreshes when Smart home loads and about
 * every 15 minutes in the background, and only while a widget is placed.
 */
export const HOME_WIDGET_TASK = "stashr-home-widget";
export { widgetSupported, widgetCount, widgetCounts, actionKey, requestPin };

/** Long-press shortcuts. Each link is a route in this app; the lock screen still comes first when the vault is locked. */
export const SHORTCUTS = [
  { id: "home", label: "Stashr Home", long: "Open Stashr Home", url: "stashr://stashr-home", icon: "home" },
  { id: "tv", label: "TV remote", long: "TV and devices", url: "stashr://home?tab=devices", icon: "tv" },
  { id: "camera", label: "Camera", long: "Camera and alerts", url: "stashr://home?tab=security", icon: "camera" },
  { id: "money", label: "Money", long: "Money", url: "stashr://money", icon: "money" },
  { id: "vault", label: "Passwords", long: "Passwords", url: "stashr:///", icon: "key" },
];

/** Paths the shortcuts and the widget open; used by the root layout to resume them after the unlock. */
export const LINK_PATHS = ["/home", "/stashr-home", "/money", "/action", "/"];

export function installShortcuts() {
  return setShortcuts(SHORTCUTS);
}

/** Today in India time, "YYYY-MM-DD" (the same day the server files Money entries under). */
const todayIndia = (now = Date.now()) => new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** Same as Smart home's health check: how many items on the TV, hub and phones are bad or need a look. */
function healthOf(devices) {
  let bad = 0, warn = 0;
  for (const d of devices || []) {
    if (!["tv", "hub", "phone"].includes(d.kind)) continue;
    for (const i of healthItems(d)) { if (i.state === "bad") bad++; else if (i.state === "warn") warn++; }
  }
  return { bad, warn };
}

// Money and network lines from the last full refresh, kept so a quick dashboard push does not wipe them.
let extras = null;

/** Loads only what the placed widgets need: Money with a Money widget, devices with a Network widget. */
async function loadExtras(dash, counts) {
  const out = {};
  if (counts.money > 0) {
    try { out.money = moneyLines(await money.list(), todayIndia()); } catch (e) { out.money = extras ? extras.money : null; }
  }
  if (counts.net > 0) {
    try {
      const { devices } = await home.devices();
      const hub = (devices || []).find((d) => d.kind === "hub" && Array.isArray(d.lan));
      out.net = netLines(dash, hub ? hub.lan : null, healthOf(devices));
    } catch (e) { out.net = extras ? extras.net : null; }
  }
  return out;
}

/** Puts an already-loaded dashboard on the widgets (Smart home calls this, so no extra request). */
export function pushHomeWidget(dashboard) {
  if (!widgetSupported || !dashboard || widgetCount() === 0) return;
  if (extras === null) { refreshHomeWidget().catch(() => {}); return; }
  setSnapshot({ ...widgetSnapshot(dashboard), scenes: scenesOf(dashboard), ...extras });
}

/** Loads the dashboard (and Money / network when those widgets are placed) and updates every widget. */
export async function refreshHomeWidget() {
  if (!widgetSupported || widgetCount() === 0) return false;
  const counts = widgetCounts();
  const dash = await home.dashboard();
  extras = await loadExtras(dash, counts);
  setSnapshot({ ...widgetSnapshot(dash), scenes: scenesOf(dash), ...extras });
  return true;
}

/** After sign-out: the widget forgets the home and says to open Stashr. */
export function clearHomeWidget() {
  extras = null;
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
