import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useVault } from "../state/vault";
import { environmentFor } from "./environments";
import { LOADERS } from "./loaders";
import { useWorkspaceMode } from "./immersive";
import useThemeName from "./useThemeName";
import "./three.css";

const SceneHost = lazy(() => import("./SceneHost"));
const HANDOFF_MS = 900;

/*
  One fixed 3D backdrop behind every signed-in page, chosen by route.
  Sets data-env on <html> (always, in both modes) so pages pick up their
  environment accent; renders WebGL only in immersive mode.

  Camera flights between pages: when the route changes environment, the
  outgoing scene stays for a short hand-off and fades out while the new one
  flies in (SceneHost's arrival flight) behind an accent transit streak.

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
  const key = immersive && env?.scene ? `${env.scene}:${env.variant}:${theme}:${env.scene === "devCity" ? count : ""}` : null;

  // Current layer plus the one handing off. Derived during render (React's
  // "store information from previous renders" pattern), cleared by a timer.
  const [layers, setLayers] = useState({ cur: null, old: null, flights: 0 });
  if ((layers.cur?.key ?? null) !== key) {
    const next = key ? { key, scene: env.scene, opts, env: env.env } : null;
    const handoff = layers.cur && next ? layers.cur : null; // only between two environments
    setLayers({ cur: next, old: handoff, flights: layers.flights + (handoff ? 1 : 0) });
  }
  useEffect(() => {
    if (!layers.old) return undefined;
    const t = setTimeout(() => setLayers((s) => ({ ...s, old: null })), HANDOFF_MS);
    return () => clearTimeout(t);
  }, [layers.old]);

  if (!layers.cur && !layers.old) return null;
  return (
    <div className="page-env" aria-hidden="true">
      <Suspense fallback={null}>
        {layers.old && (
          <div key={layers.old.key} className="page-env__layer is-leaving">
            <SceneHost load={LOADERS[layers.old.scene]} opts={layers.old.opts} maxFps={30} intro={false} />
          </div>
        )}
        {layers.cur && (
          <div key={layers.cur.key} className="page-env__layer">
            {/* Each environment builds fresh and frees the last one when it unmounts. */}
            <SceneHost load={LOADERS[layers.cur.scene]} opts={layers.cur.key === key ? opts : layers.cur.opts} maxFps={30} />
          </div>
        )}
      </Suspense>
      {layers.old && <div key={`transit-${layers.flights}`} className="page-env__transit" />}
      <div className="page-env__scrim" />
    </div>
  );
}
