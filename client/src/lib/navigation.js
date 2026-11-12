/* One navigation model for the sidebar, the mobile "More" sheet and the bottom bar.
   Feature flags follow the server's profile.features; a missing flag means "on",
   except Photos and admin entries, which need an explicit grant. */

const on = (features, key) => features?.[key] !== false;

export function navGroups(profile) {
  const f = profile?.features || {};
  const admin = Boolean(profile?.isAdmin);
  const infra = ["servers", "services", "cron"].some((k) => on(f, k));
  const groups = [
    {
      id: "vault",
      label: "Vault",
      items: [
        { to: "/dashboard", label: "Overview", icon: "home" },
        { to: "/passwords", label: "Passwords", icon: "key" },
        { to: "/security-center", label: "Security", icon: "shield" },
      ],
    },
    {
      id: "workspace",
      label: "Workspace",
      items: [
        ...(f.photos !== false ? [{ to: "/photos", label: "Photos", icon: "image" }] : []),
        ...(on(f, "projects") ? [{ to: "/projects", label: "Projects", icon: "folder" }] : []),
        ...(on(f, "smartHome") ? [{ to: "/smart-home", label: "Smart home", icon: "tv" }] : []),
        ...(on(f, "smartHome") ? [{ to: "/whatsapp", label: "WhatsApp sender", icon: "send" }] : []),
        ...(on(f, "money") ? [{ to: "/money", label: "Money", icon: "rupee" }] : []),
      ],
    },
    {
      id: "infra",
      label: "Infrastructure",
      items: infra
        ? [
            ...(on(f, "servers") ? [{ to: "/render", label: "Control Center", icon: "tower" }] : []),
            ...(on(f, "services") ? [{ to: "/services", label: "Usage", icon: "chart", end: true }, { to: "/services/map", label: "Service map", icon: "map" }] : []),
            ...(on(f, "cron") ? [{ to: "/cron", label: "Cron & alerts", icon: "clock" }] : []),
          ]
        : [],
    },
    {
      id: "admin",
      label: "Admin",
      items: admin
        ? [
            ...(f.adminPanel ? [{ to: "/admin", label: "Admin panel", icon: "users" }] : []),
            { to: "/servers", label: "Server URLs", icon: "server" },
            { to: "/media", label: "ShineOne Estate Manager", icon: "image" },
            { to: "/security", label: "Security scans", icon: "scan" },
          ]
        : [],
    },
  ];
  return groups.filter((g) => g.items.length);
}

/* Thumb-reach destinations for the phone bottom bar (the rest live under "More"). */
export function bottomItems(profile) {
  const f = profile?.features || {};
  return [
    { to: "/dashboard", label: "Home", icon: "home" },
    { to: "/passwords", label: "Passwords", icon: "key" },
    ...(on(f, "projects") ? [{ to: "/projects", label: "Projects", icon: "folder" }] : [{ to: "/security-center", label: "Security", icon: "shield" }]),
  ];
}

/* Is `pathname` inside this nav entry? Exact for `end` entries, prefix otherwise. */
export function isActivePath(entry, pathname) {
  if (!entry?.to || !pathname) return false;
  if (pathname === entry.to) return true;
  if (entry.end) return false;
  return pathname.startsWith(entry.to + "/");
}

/* The most specific entry wins, so /services/map lights "Service map", not "Usage". */
export function activeEntry(groups, pathname) {
  let best = null;
  for (const g of groups) for (const it of g.items) {
    if (isActivePath(it, pathname) && (!best || it.to.length > best.to.length)) best = it;
  }
  return best;
}
