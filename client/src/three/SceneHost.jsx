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
export default function SceneHost({ load, opts, className = "", label, onReady, maxFps = 60, intro = true }) {
  const wrap = useRef(null);
  const [ready, setReady] = useState(false);
  // Read once: a scene that is handing off must keep running, not rebuild because its props changed.
  const [introAtMount] = useState(intro);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    (async () => {
      const tier = deviceTier();
      const [THREE, mod, roomEnv] = await Promise.all([
        import("three"),
        load(),
        // Image-based lighting so metal and glass reflect something real (skipped on low-tier devices).
        tier === "high" ? import("three/examples/jsm/environments/RoomEnvironment.js").catch(() => null) : null,
      ]);
      const el = wrap.current;
      if (cancelled || !el) return;
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
      let pmrem = null, envMap = null;
      if (roomEnv?.RoomEnvironment) {
        pmrem = new THREE.PMREMGenerator(renderer);
        const room = new roomEnv.RoomEnvironment();
        envMap = pmrem.fromScene(room, 0.04).texture;
        room.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
        scene.environment = envMap;
        scene.environmentIntensity = 0.45;
      }
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
      // Arrival flight: for the first INTRO_MS the camera is drawn back along its view
      // direction, raised and widened, easing into the pose the scene chose. The offset is
      // applied for the draw only and removed afterwards, so scene camera logic is untouched.
      const INTRO_MS = 1500;
      const introStart = performance.now();
      const flying = introAtMount && !reduce;
      const fwd = new THREE.Vector3(), saved = new THREE.Vector3();
      const frame = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        pointer.x += (pointer.tx - pointer.x) * 0.04;
        pointer.y += (pointer.ty - pointer.y) * 0.04;
        api.update?.(now / 1000, dt, pointer, optsRef.current || {});
        const k = flying ? Math.min(1, (now - introStart) / INTRO_MS) : 1;
        if (k < 1) {
          const away = Math.pow(1 - k, 3); // ease-out cubic
          const fov = camera.fov;
          saved.copy(camera.position);
          camera.getWorldDirection(fwd);
          const reach = Math.max(40, camera.position.length() * 0.6);
          camera.position.addScaledVector(fwd, -reach * away);
          camera.position.y += reach * 0.35 * away;
          camera.fov = fov + 16 * away;
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
          camera.position.copy(saved);
          camera.fov = fov;
          camera.updateProjectionMatrix();
        } else {
          renderer.render(scene, camera);
        }
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
        envMap?.dispose();
        pmrem?.dispose();
        renderer.dispose();
        renderer.forceContextLoss?.();
        renderer.domElement.remove();
      };
    })().catch(() => { /* scene failed: the static fallback stays visible */ });
    return () => { cancelled = true; cleanup(); };
  }, [load, onReady, maxFps, introAtMount]);

  return (
    <div ref={wrap} className={`scene-host ${ready ? "is-ready" : ""} ${className}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
  );
}
