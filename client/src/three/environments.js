/*
  Route → environment map. Pure (no React, no three) so it is unit-tested.
  Each environment names a scene module, a variant and the page accent used
  by CSS (data-env on <html>). Routes not listed get no 3D backdrop.
*/
export const SCENES = ["universe", "vault", "devCity", "soc", "infra", "gallery", "habitat"];

const RULES = [
  // [test, environment]
  [(p) => p === "/dashboard", { scene: "universe", variant: "backdrop", env: "command" }],
  [(p) => p === "/passwords", { scene: "vault", variant: "vault", env: "vault" }],
  [(p) => p === "/generator", { scene: "vault", variant: "lab", env: "lab" }],
  [(p) => p === "/signin" || p === "/forgot-password", { scene: null, variant: "facility", env: "facility" } /* AuthShell hosts its own 3D facility */],
  [(p) => p === "/projects" || p.startsWith("/projects/"), { scene: "devCity", variant: "dev", env: "dev" }],
  [(p) => p === "/money", { scene: "devCity", variant: "ledger", env: "ledger" }],
  [(p) => ["/security-center", "/security", "/settings"].includes(p), { scene: "soc", variant: "soc", env: "security" }],
  [(p) => p === "/whatsapp" || p === "/sms", { scene: "soc", variant: "comms", env: "comms" }],
  [(p) => ["/servers", "/cron", "/render"].includes(p) || p === "/services" || p.startsWith("/services/"), { scene: "infra", variant: "infra", env: "infra" }],
  [(p) => p === "/media", { scene: "gallery", variant: "gallery", env: "media" }],
  [(p) => p === "/smart-home", { scene: "habitat", variant: "habitat", env: "home" }],
  [(p) => ["/admin", "/ggnhome-admin", "/app-updates"].includes(p), { scene: "universe", variant: "backdrop", env: "admin" }],
  [(p) => ["/apps", "/privacy", "/logout"].includes(p), { scene: "universe", variant: "backdrop", env: "ecosystem" }],
];

/** Environment for a pathname, or null (Home has its own hero; Photos opts out). */
export function environmentFor(pathname = "/") {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/" || p.startsWith("/photos") || p.startsWith("/share/")) return null;
  for (const [test, env] of RULES) if (test(p)) return env;
  return null;
}
