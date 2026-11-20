import React, { useEffect, useRef, useState } from "react";
import { deviceTier, prefersReducedMotion } from "./capabilities";

/*
  SceneHost — mounts one three.js scene in a canvas that fills its parent.
  `load` is a () => import("./scenes/x") whose default export is
  build({ THREE, scene, camera, renderer, tier, opts }) => { update(t, dt, pointer), dispose? }.
  three.js and the scene are code-split; rendering pauses off-screen and in hidden
  tabs, runs one still frame under reduced motion, and frees GPU memory on unmount.
  Only pass non-sensitive data in `opts` (counts, names) — never secrets.
*/
export default function SceneHost({ load, opts, className = "", label, onReady, maxFps = 60 }) {
  const wrap = useRef(null);
  const [ready, setReady] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    (async () => {
      const [THREE, mod] = await Promise.all([import("three"), load()]);
      const el = wrap.current;
      if (cancelled || !el) return;
      const tier = deviceTier();
      const reduce = prefersReducedMotion();
      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: tier === "high", alpha: true, powerPreference: "high-performance" });
      } catch { return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier === "high" ? 1.75 : 1.25));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.className = "scene-host__canvas";
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const api = mod.default({ THREE, scene, camera, renderer, tier, opts: optsRef.current || {} }) || {};

      const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
      const onMove = (e) => {
        const r = el.getBoundingClientRect();
        pointer.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
        pointer.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
      };
      window.addEventListener("pointermove", onMove, { passive: true });

      const resize = () => {
        const w = el.clientWidth || 1, h = el.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        api.resize?.(w, h);
      };
      const ro = new ResizeObserver(() => { resize(); if (!running) frame(performance.now()); });
      ro.observe(el);
      resize();

      let visible = true, running = false, raf = 0, last = performance.now();
      const frame = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        pointer.x += (pointer.tx - pointer.x) * 0.04;
        pointer.y += (pointer.ty - pointer.y) * 0.04;
        api.update?.(now / 1000, dt, pointer, optsRef.current || {});
        renderer.render(scene, camera);
      };
      // Backdrops run at a capped rate; low-tier devices get at most 24 fps.
      const minGap = 1000 / Math.min(maxFps, tier === "low" ? 24 : maxFps) - 2;
      let lastDraw = 0;
      const loop = (now) => {
        if (now - lastDraw >= minGap) { lastDraw = now; frame(now); }
        raf = requestAnimationFrame(loop);
      };
      const sync = () => {
        const want = visible && !document.hidden && !reduce;
        if (want && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
        if (!want && running) { running = false; cancelAnimationFrame(raf); }
      };
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); });
      io.observe(el);
      document.addEventListener("visibilitychange", sync);
      frame(performance.now());
      sync();
      setReady(true);
      onReady?.();

      cleanup = () => {
        cancelAnimationFrame(raf);
        io.disconnect(); ro.disconnect();
        document.removeEventListener("visibilitychange", sync);
        window.removeEventListener("pointermove", onMove);
        api.dispose?.();
        scene.traverse((o) => {
          o.geometry?.dispose?.();
          const m = o.material;
          (Array.isArray(m) ? m : m ? [m] : []).forEach((mat) => { mat.map?.dispose?.(); mat.dispose(); });
        });
        renderer.dispose();
        renderer.forceContextLoss?.();
        renderer.domElement.remove();
      };
    })().catch(() => { /* scene failed: the static fallback stays visible */ });
    return () => { cancelled = true; cleanup(); };
  }, [load, onReady, maxFps]);

  return (
    <div ref={wrap} className={`scene-host ${ready ? "is-ready" : ""} ${className}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
  );
}
