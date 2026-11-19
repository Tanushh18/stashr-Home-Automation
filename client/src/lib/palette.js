/* Command palette: builds the list of jump targets and ranks them against a query. */

export function buildEntries({ items = [], projects = [], profile = null, signedIn = true }) {
  if (!signedIn) return [];
  const pages = [
    { label: "Overview", to: "/dashboard" },
    { label: "Passwords", to: "/passwords" },
    { label: "Password generator", to: "/generator" },
    { label: "Security center", to: "/security-center" },
    { label: "Projects", to: "/projects" },
    { label: "Services", to: "/services" },
    { label: "Service map", to: "/services/map" },
    { label: "Control Center", to: "/render" },
    { label: "Cron", to: "/cron" },
    { label: "Settings", to: "/settings" },
    { label: "Apps and extension", to: "/apps" },
    ...(profile?.isAdmin ? [{ label: "Servers", to: "/servers" }, { label: "ShineOne Estate Manager", to: "/media" }, { label: "Security", to: "/security" }] : []),
  ].map((p) => ({ ...p, kind: "Page", hint: p.to }));
  // Actions: only things the app can already do from a URL.
  const actions = [
    { label: "Add a password", to: "/passwords?new=1", hint: "Opens the editor" },
    { label: "Import passwords", to: "/passwords?import=1", hint: "CSV from a browser or manager" },
    { label: "New project", to: "/projects/new", hint: "Create a project" },
    { label: "Generate a password", to: "/generator", hint: "Random password or passphrase" },
  ].map((a) => ({ ...a, kind: "Action" }));
  const vault = items.map((i) => ({
    kind: "Item", label: i.name || "Untitled", hint: i.username || i.url || "",
    to: "/passwords?q=" + encodeURIComponent(i.name || i.username || ""),
    haystack: [i.name, i.username, i.url, i.folder].filter(Boolean).join(" ").toLowerCase(),
  }));
  const projs = projects.map((p) => ({ kind: "Project", label: p.name || "Untitled", hint: "Project", to: "/projects/" + p.id }));
  return [...actions, ...pages, ...projs, ...vault];
}

/* Prefix matches rank above substring matches; every query word must appear somewhere. */
export function rank(entries, query, limit = 12) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries.filter((e) => e.kind === "Page" || e.kind === "Action").slice(0, limit);
  const scored = [];
  for (const e of entries) {
    const text = (e.haystack || (e.label + " " + (e.hint || ""))).toLowerCase();
    if (!words.every((w) => text.includes(w))) continue;
    const label = e.label.toLowerCase();
    const score = words.reduce((s, w) => s + (label.startsWith(w) ? 3 : label.includes(w) ? 2 : 1), 0);
    scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.e.label.localeCompare(b.e.label)).slice(0, limit).map((x) => x.e);
}
