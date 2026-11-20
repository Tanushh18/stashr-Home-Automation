import React, { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useVault } from "../../state/vault";
import { navGroups, activeEntry } from "../../lib/navigation";
import useMediaQuery, { PHONE, TABLET } from "../../hooks/useMediaQuery";
import useTheme from "../../hooks/useTheme";
import AlertBell from "../AlertBell/AlertBell";
import VersionBadge from "../WhatsNew/WhatsNew";
import { ShieldLine } from "../Icons/Icons";
import NavIcon from "./NavIcon";
import { openPalette } from "../CommandPalette/CommandPalette";
import { ModeToggle } from "../../three/Immersive";

const COLLAPSE_KEY = "stashr_sidebar_collapsed";
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } };
const initials = (name = "", email = "") => (name.trim() ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("") : email.slice(0, 1)).toUpperCase() || "S";
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

/* Little world at the foot of the sidebar: canopy leaves, a river and a robot on watch. Decorative. */
function SidebarScene() {
  return (
    <svg className="sb__scene" viewBox="0 0 248 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <path className="sb__scene-hill" d="M0 120V78c30-14 56-18 84-10 26 8 46-6 74-8 34-2 58 14 90 6v54z" />
      <path className="sb__scene-river" d="M0 104c40-10 78-12 116-6 40 6 86 4 132-6" />
      <path className="sb__scene-shine" d="M18 102c22-4 40-5 58-4M140 99c20 0 40-2 62-6" />
      <path className="sb__scene-leaf" d="M232 0c-6 24-24 40-48 44 10-20 26-36 48-44zM248 18c-10 18-26 28-44 30 10-14 24-24 44-30z" />
      <path className="sb__scene-leaf" d="M0 6c8 20 24 32 44 34-8-18-22-30-44-34z" />
      <g className="sb__scene-bot" transform="translate(196 74)">
        <rect x="-6" y="-12" width="12" height="9" rx="2.5" /><rect x="-4" y="-3" width="8" height="7" rx="2" />
        <circle cx="-2.4" cy="-7.5" r="1.1" className="sb__scene-eye" /><circle cx="2.4" cy="-7.5" r="1.1" className="sb__scene-eye" />
        <path d="M0 -12v-4" /><circle cx="0" cy="-17" r="1.5" className="sb__scene-beacon" />
      </g>
    </svg>
  );
}

/** Signed-in navigation for tablets and desktops: grouped destinations, search, alerts, theme and account. */
export default function Sidebar() {
  const { status, profile, lock } = useVault();
  const phone = useMediaQuery(PHONE);
  const tablet = useMediaQuery(TABLET);
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const [pinnedCollapsed, setPinnedCollapsed] = useState(readCollapsed);
  const show = (status === "ready" || status === "locked") && !phone;
  const collapsed = tablet || pinnedCollapsed;
  const groups = useMemo(() => navGroups(profile), [profile]);
  const active = activeEntry(groups, pathname);

  useEffect(() => {
    document.body.classList.toggle("has-sidebar", show);
    document.body.classList.toggle("sidebar-collapsed", show && collapsed);
    return () => document.body.classList.remove("has-sidebar", "sidebar-collapsed");
  }, [show, collapsed]);

  if (!show) return null;

  const toggleCollapsed = () => {
    setPinnedCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* private mode */ }
      return !c;
    });
  };
  const light = theme === "light";

  return (
    <aside className={`sb ${collapsed ? "is-collapsed" : ""}`} aria-label="Sidebar">
      <div className="sb__brand">
        <Link to="/dashboard" className="sb__logo" aria-label="Stashr overview">
          <span className="sb__mark"><ShieldLine size={17} strokeWidth={1.9} /></span>
          <span className="sb__name">Stashr</span>
        </Link>
        <VersionBadge autoOpen={status === "ready"} />
        {!tablet ? (
          <button type="button" className="sb__iconbtn sb__collapse" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <NavIcon name={collapsed ? "expand" : "collapse"} size={17} />
          </button>
        ) : null}
      </div>

      <button type="button" className="sb__search" onClick={openPalette} aria-label="Search or jump to" aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"} title="Search or jump to">
        <NavIcon name="search" size={16} />
        <span className="sb__label">Search…</span>
        <kbd className="sb__kbd">{isMac ? "⌘" : "Ctrl"} K</kbd>
      </button>

      <nav className="sb__nav" aria-label="Primary">
        {groups.map((g) => (
          <div className="sb__group" key={g.id} role="group" aria-labelledby={`sb-${g.id}`}>
            <p className="sb__grouplabel" id={`sb-${g.id}`}>{g.label}</p>
            <ul>
              {g.items.map((it) => {
                const on = active?.to === it.to;
                return (
                  <li key={it.to}>
                    <NavLink to={it.to} className={`sb__link ${on ? "is-active" : ""}`} aria-current={on ? "page" : undefined} title={collapsed ? it.label : undefined}>
                      <NavIcon name={it.icon} />
                      <span className="sb__label">{it.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <SidebarScene />
      <div className="sb__foot">
        <div className="sb__tools">
          <NavLink to="/settings" className={`sb__link ${pathname.startsWith("/settings") ? "is-active" : ""}`} aria-current={pathname.startsWith("/settings") ? "page" : undefined} title={collapsed ? "Settings" : undefined}>
            <NavIcon name="gear" />
            <span className="sb__label">Settings</span>
          </NavLink>
          <div className="sb__row">
            <AlertBell enabled={status === "ready"} placement="up" />
            <ModeToggle compact className="sb__iconbtn" />
            <button type="button" className="sb__iconbtn" onClick={toggle} aria-label={light ? "Switch to dark theme" : "Switch to light theme"} title={light ? "Dark theme" : "Light theme"}>
              <NavIcon name={light ? "moon" : "sun"} size={17} />
            </button>
          </div>
        </div>
        <div className="sb__user">
          <span className="sb__avatar" aria-hidden="true">{initials(profile?.name, profile?.email)}</span>
          <span className="sb__who">
            <strong>{profile?.name || "Your account"}</strong>
            <small title={profile?.email || ""}>{profile?.email || ""}</small>
          </span>
          <span className="sb__useracts">
            <button type="button" className="sb__iconbtn" onClick={lock} aria-label="Lock vault" title="Lock vault"><NavIcon name="lock" size={16} /></button>
            <Link to="/logout" className="sb__iconbtn" aria-label="Sign out" title="Sign out"><NavIcon name="logout" size={16} /></Link>
          </span>
        </div>
      </div>
    </aside>
  );
}
