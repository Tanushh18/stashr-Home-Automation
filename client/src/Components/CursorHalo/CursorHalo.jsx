import React, { useEffect, useRef } from "react";
import { useWorkspaceMode } from "../../three/immersive";
import "./CursorHalo.css";

const INTERACTIVE = "a, button, [role='button'], [role='tab'], [role='option'], summary, label, select, input[type='checkbox'], input[type='radio'], input[type='range']";
const TEXT = "input:not([type='checkbox']):not([type='radio']):not([type='range']), textarea, [contenteditable='true']";

/*
  Desktop cursor halo for the immersive workspace. The system cursor is never hidden or
  replaced: a soft ring trails it, grows over clickable things, narrows over text fields
  and dips on press. Fine pointers only; off for touch, reduced motion and Standard 2D.
  The animation loop sleeps whenever the ring has caught up with the pointer.
*/
export default function CursorHalo() {
  const { immersive } = useWorkspaceMode();
  const ref = useRef(null);

  useEffect(() => {
    if (!immersive) return undefined;
    const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const el = ref.current;
    if (!fine || reduce || !el) return undefined;

    let x = -100, y = -100, tx = -100, ty = -100, raf = 0;
    const step = () => {
      x += (tx - x) * 0.22;
      y += (ty - y) * 0.22;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(step) : 0;
    };
    const wake = () => { if (!raf) raf = requestAnimationFrame(step); };
    const onMove = (e) => {
      tx = e.clientX; ty = e.clientY;
      el.dataset.on = "1";
      const t = e.target instanceof Element ? e.target : null;
      el.dataset.mode = t?.closest(TEXT) ? "text" : t?.closest(INTERACTIVE) ? "link" : "";
      wake();
    };
    const onDown = () => { el.dataset.down = "1"; };
    const onUp = () => { delete el.dataset.down; };
    const onLeave = () => { el.dataset.on = "0"; };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [immersive]);

  if (!immersive) return null;
  return <div ref={ref} className="cursor-halo" aria-hidden="true" data-on="0" />;
}
