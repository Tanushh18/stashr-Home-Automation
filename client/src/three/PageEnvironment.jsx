import React, { Suspense, lazy, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useVault } from "../state/vault";
import { environmentFor } from "./environments";
import { LOADERS } from "./loaders";
import { useWorkspaceMode } from "./immersive";
import useThemeName from "./useThemeName";
import "./three.css";

const SceneHost = lazy(() => import("./SceneHost"));

/*
  One fixed 3D backdrop behind every signed-in page, chosen by route.
  Sets data-env on <html> (always, in both modes) so pages pick up their
  environment accent; renders WebGL only in immersive mode.
  Data passed to scenes: the number of projects. Nothing else.
*/
export default function PageEnvironment() {
  const { pathname } = useLocation();
  const env = environmentFor(pathname);
  const { immersive } = useWorkspaceMode();
  const theme = useThemeName();
  const { projects } = useVault();
  const count = Array.isArray(projects) ? projects.length : 0;

  useEffect(() => {
    const root = document.documentElement;
    if (env) root.dataset.env = env.env; else delete root.dataset.env;
    root.dataset.workspace = immersive ? "immersive" : "standard";
  }, [env, immersive]);

  const opts = useMemo(() => ({ theme, variant: env?.variant, count }), [theme, env?.variant, count]);
  if (!env || !env.scene || !immersive) return null;
  return (
    <div className="page-env" aria-hidden="true">
      <Suspense fallback={null}>
        {/* Remount on scene/variant/theme change so each environment builds fresh and frees the last one. */}
        <SceneHost key={`${env.scene}:${env.variant}:${theme}:${env.scene === "devCity" ? count : ""}`} load={LOADERS[env.scene]} opts={opts} maxFps={30} />
      </Suspense>
      <div className="page-env__scrim" />
    </div>
  );
}
