import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useVault } from "../../state/vault";
import { ShieldLine, Menu, Close, Arrow } from "../Icons/Icons";
import AlertBell from "../AlertBell/AlertBell";
import ThemeToggle from "../ThemeToggle/ThemeToggle";
import VersionBadge from "../WhatsNew/WhatsNew";
import NavIcon from "../AppShell/NavIcon";
import { openPalette } from "../CommandPalette/CommandPalette";
import useMediaQuery, { PHONE } from "../../hooks/useMediaQuery";
import "./Navbar.css";

/* Signed-in phones: brand, search and alerts. Destinations live in the bottom bar. */
function MobileTopBar({ status }) {
  return (
    <header className="nav nav--app is-scrolled">
      <div className="nav__inner">
        <div className="nav__brandwrap">
          <Link to="/dashboard" className="nav__brand" aria-label="Stashr overview">
            <span className="nav__mark"><ShieldLine size={17} strokeWidth={1.9} /></span>
            <span className="nav__wordmark"><span className="nav__name">Stashr</span></span>
          </Link>
          <VersionBadge autoOpen={status === "ready"} />
        </div>
        <div className="nav__actions">
          <button type="button" className="nav__iconbtn" onClick={openPalette} aria-label="Search or jump to"><NavIcon name="search" size={19} /></button>
          <AlertBell enabled={status === "ready"} />
        </div>
      </div>
    </header>
  );
}

function Navbar() {
  const { status, profile } = useVault();
  const isAuthenticated = status === "ready" || status === "locked";
  const name = profile?.name;
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const location = useLocation();
  const phone = useMediaQuery(PHONE);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { setOpen(false); setMoreOpen(false); }, [location.pathname]);

  // The "More" menu closes on an outside click or Escape.
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDown = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setMoreOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [moreOpen]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  /* Main places stay in the bar; the rest live under "More" so the bar never overflows. */
  const links = isAuthenticated
    ? [
        { to: "/passwords", label: "Passwords" },
        ...(profile?.features?.projects !== false ? [{ to: "/projects", label: "Projects" }] : []),
        ...(["servers", "services", "cron"].some((k) => profile?.features?.[k] !== false) ? [{ to: "/render", label: "Control Center", also: ["/services", "/cron"] }] : []),
      ]
    : [
        { to: "/", label: "Home" },
        { to: "/signin", label: "Sign in" },
      ];
  const more = isAuthenticated
    ? [
        ...(profile?.isAdmin ? [{ to: "/admin", label: "Admin panel" }, { to: "/servers", label: "Server URLs" }, { to: "/media", label: "ShineOne Estate Manager" }, { to: "/security", label: "Security scans" }] : []),
        { to: "/settings", label: "Settings" },
        { to: "/logout", label: "Sign out" },
      ]
    : [];
  const allLinks = [...links, ...more];

  const cta = isAuthenticated
    ? { to: "/passwords", label: "My vault" }
    : { to: "/signin", label: "Sign in" };

  // Signed in: the sidebar (tablet/desktop) or the bottom bar (phone) is the navigation.
  if (isAuthenticated) return phone ? <MobileTopBar status={status} /> : null;

  return (
    <>
      <header className={`nav ${scrolled ? "is-scrolled" : ""}`}>
        <div className="nav__inner">
          <div className="nav__brandwrap">
            <Link to="/" className="nav__brand" aria-label="Stashr home">
              <span className="nav__mark"><ShieldLine size={19} strokeWidth={1.8} /></span>
              <span className="nav__wordmark"><span className="nav__name">Stashr</span></span>
            </Link>
            <VersionBadge autoOpen={isAuthenticated} />
          </div>
          <nav className="nav__links" aria-label="Primary">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} className={({ isActive }) => `nav__link ${isActive || (link.also || []).some((p) => location.pathname.startsWith(p)) ? "is-active" : ""}`} end>
                {link.label}
              </NavLink>
            ))}
            {more.length > 0 && (
              <div className="nav__more" ref={moreRef}>
                <button type="button" className={`nav__link nav__morebtn ${more.some((l) => location.pathname.startsWith(l.to)) ? "is-active" : ""}`} aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                  More <span aria-hidden="true">▾</span>
                </button>
                {moreOpen && (
                  <div className="nav__menu" role="menu">
                    {more.map((link) => (
                      <NavLink key={link.to} to={link.to} role="menuitem" className={({ isActive }) => `nav__menuitem ${isActive ? "is-active" : ""}`} end>{link.label}</NavLink>
                    ))}
                  </div>
                )}
              </div>
            )}
          </nav>
          <div className="nav__actions">
            <AlertBell enabled={status === "ready"} />
            <ThemeToggle />
            {isAuthenticated && name && <span className="nav__greeting">Hello, <em>{name.split(" ")[0]}</em></span>}
            <Link to={cta.to} className="btn btn--primary btn--sm nav__cta">
              <span className="btn__sheen" />{cta.label}<Arrow size={14} />
            </Link>
            <button className="nav__burger" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}>
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>
      <div className={`drawer ${open ? "is-open" : ""}`} role="dialog" aria-hidden={!open}>
        <div className="drawer__top">
          <span className="drawer__brand"><ShieldLine size={18} />Stashr</span>
          <button className="drawer__close" onClick={() => setOpen(false)} aria-label="Close menu"><Close size={18} /></button>
        </div>
        <nav className="drawer__links">
          {allLinks.map((link, i) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => `drawer__link ${isActive ? "is-active" : ""}`} end style={{ transitionDelay: `${0.06 + i * 0.06}s` }}>
              {link.label}
            </NavLink>
          ))}
          <NavLink to={cta.to} className="drawer__link drawer__link--cta" style={{ transitionDelay: `${0.06 + allLinks.length * 0.06}s` }}>
            {cta.label}<Arrow size={15} />
          </NavLink>
        </nav>
        <p className="drawer__note"><span className="script">Passwords, projects, everything — kept safe.</span></p>
      </div>
      <div className={`drawer__scrim ${open ? "is-open" : ""}`} onClick={() => setOpen(false)} />
    </>
  );
}

export default Navbar;
