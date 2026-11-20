import React, { Suspense, lazy } from "react";
import { useWorkspaceMode } from "./immersive";
import "./three.css";

const SceneHost = lazy(() => import("./SceneHost"));

/* Renders `fallback` always (static art / nothing) and layers the 3D scene on
   top only in immersive mode with WebGL. The 3D layer is purely decorative. */
export function Immersive({ load, opts, fallback = null, className = "" }) {
  const { immersive } = useWorkspaceMode();
  return (
    <div className={`immersive ${className}`} aria-hidden="true">
      {fallback}
      {immersive && (
        <Suspense fallback={null}>
          <SceneHost load={load} opts={opts} />
        </Suspense>
      )}
    </div>
  );
}

export function ModeToggle({ className = "", compact = false }) {
  const { mode, can3d, toggle } = useWorkspaceMode();
  if (!can3d) return null;
  const on = mode === "immersive";
  if (compact) {
    return (
      <button type="button" className={`mode-toggle mode-toggle--compact ${on ? "is-on" : ""} ${className}`} onClick={toggle} aria-pressed={on}
        aria-label={on ? "Immersive 3D workspace is on. Switch to standard 2D" : "Switch to the immersive 3D workspace"}
        title={on ? "Standard 2D workspace" : "Immersive 3D workspace"}>
        <span aria-hidden="true">3D</span>
      </button>
    );
  }
  return (
    <button type="button" className={`mode-toggle ${on ? "is-on" : ""} ${className}`} onClick={toggle} aria-pressed={on}
      title={on ? "Switch to the standard 2D workspace" : "Switch to the immersive 3D workspace"}>
      <span className="mode-toggle__dot" aria-hidden="true" />
      {on ? "Immersive 3D" : "Standard 2D"}
    </button>
  );
}
