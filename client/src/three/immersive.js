import { useCallback, useSyncExternalStore } from "react";
import { webglSupported } from "./capabilities";

/* Standard (2D) or immersive (3D) workspace. A per-viewer convenience kept in
   localStorage; nothing secret is stored. Defaults to immersive when WebGL works. */
const KEY = "stashr.workspaceMode";
const EVT = "stashr:workspace-mode";

function read() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "standard" || v === "immersive") return v;
  } catch { /* storage blocked */ }
  return "immersive";
}

function subscribe(cb) {
  const on = () => cb();
  window.addEventListener(EVT, on);
  window.addEventListener("storage", on);
  return () => { window.removeEventListener(EVT, on); window.removeEventListener("storage", on); };
}

export function setWorkspaceMode(mode) {
  try { localStorage.setItem(KEY, mode); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVT));
}

export function useWorkspaceMode() {
  const mode = useSyncExternalStore(subscribe, read, () => "standard");
  const toggle = useCallback(() => setWorkspaceMode(mode === "immersive" ? "standard" : "immersive"), [mode]);
  const can3d = typeof window !== "undefined" && webglSupported();
  return { mode, immersive: mode === "immersive" && can3d, can3d, toggle, setMode: setWorkspaceMode };
}
