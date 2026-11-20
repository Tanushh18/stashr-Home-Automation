/* Device capability checks for the optional 3D layer. Pure and safe to call during render. */
let webglCache;

export function webglSupported() {
  if (webglCache !== undefined) return webglCache;
  try {
    if (typeof document === "undefined") return (webglCache = false);
    const c = document.createElement("canvas");
    webglCache = !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    webglCache = false;
  }
  return webglCache;
}

export function prefersReducedMotion() {
  try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/** Rough tier: "low" for small screens, few cores, low memory or data saver; else "high". */
export function deviceTier() {
  try {
    const nav = window.navigator || {};
    if (nav.connection?.saveData) return "low";
    if ((nav.deviceMemory || 8) <= 2 || (nav.hardwareConcurrency || 8) <= 2) return "low";
    if (window.innerWidth < 720) return "low";
  } catch { /* fall through */ }
  return "high";
}
