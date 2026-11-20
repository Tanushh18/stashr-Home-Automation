import React, { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useVault } from "../../state/vault";
import ServiceStatus from "../../Components/ServiceStatus/ServiceStatus";
import WorldScene from "../../Components/WorldScene/WorldScene";
import { LockLine, ShieldLine, ShieldCheck, KeyLine, Globe, Arrow, Grid, Folder } from "../../Components/Icons/Icons";
import { Immersive, ModeToggle } from "../../three/Immersive";
import { useWorkspaceMode } from "../../three/immersive";
import { LOADERS } from "../../three/loaders";
import useThemeName from "../../three/useThemeName";
import "./Home.css";

/* Destination stations. `to` is used when signed in; signed-out visitors are
   sent to sign in first (these routes all require a vault). `district` ties a
   station to its island in the 3D universe above. */
const DESTINATIONS = [
  {
    code: "VLT",
    district: "vault",
    icon: <LockLine size={20} />,
    title: "Vault",
    tag: "Secure destination",
    body: "Logins, 2FA codes and notes, each sealed with AES-256-GCM using a key unique to your account before it is stored.",
    to: "/passwords",
  },
  {
    code: "GEN",
    district: "generator",
    icon: <KeyLine size={20} />,
    title: "Generator",
    tag: "Secure creation station",
    body: "Create long random passwords or passphrases, with the length and character sets you choose, then copy one into a login.",
    to: "/generator",
  },
  {
    code: "SEC",
    district: "security",
    icon: <ShieldCheck size={20} />,
    title: "Security audit",
    tag: "Security checkpoint",
    body: "Spots weak, reused, old and breached passwords (checked with Have I Been Pwned), plus two-factor and device status, so you know what to fix first.",
    to: "/security-center",
  },
  {
    code: "PRJ",
    district: "projects",
    icon: <Folder size={20} />,
    title: "Projects",
    tag: "Every stack, one terminal",
    body: "Keep hosting, databases and env vars for every project in one tree. Search MONGO_URI and get the value.",
    to: "/projects",
  },
  {
    code: "CTL",
    district: "control",
    icon: <Grid size={20} />,
    title: "Control Center",
    tag: "Your connected city",
    body: "Services, cron jobs and deploys for your infrastructure, watched from one place.",
    to: "/services",
  },
  {
    code: "APP",
    district: "apps",
    icon: <Globe size={20} />,
    title: "Web, Android, Chrome",
    tag: "Connections everywhere",
    body: "Same account everywhere. Android autofill and a Chrome extension fill logins for you.",
    to: "/apps",
    open: true,
  },
];

const STEPS = [
  { title: "Create your account", body: "One email and one password to remember." },
  { title: "Add or import your data", body: "Type logins in, or import a CSV from Chrome, Bitwarden, 1Password or LastPass." },
  { title: "Access your secure ecosystem anywhere", body: "Open it on the web, on your phone, or let autofill do it." },
];

const ANDROID_URL =
  import.meta.env.VITE_ANDROID_URL || import.meta.env.REACT_APP_ANDROID_URL || "/apps";

function scrollToSecurity(e) {
  const el = document.getElementById("hm-destinations");
  if (!el) return;
  e.preventDefault();
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

/* CSS-built emblem per station; purely decorative. */
function Emblem({ code }) {
  const k = code.toLowerCase();
  return (
    <span className={`hm-emblem hm-emblem--${k}`} aria-hidden="true">
      {k === "vlt" && (<><i className="e-door" /><i className="e-ring" /><i className="e-wheel" /></>)}
      {k === "gen" && (<><i className="e-crystal" /><i className="e-crystal e-crystal--b" /><i className="e-crystal e-crystal--c" /></>)}
      {k === "sec" && (<><i className="e-radar" /><i className="e-sweep" /><i className="e-blip" /></>)}
      {k === "prj" && (<>{[46, 72, 34, 58, 26].map((h, i) => <i key={i} className="e-tower" style={{ "--h": `${h}%`, "--i": i }} />)}</>)}
      {k === "ctl" && (<>{Array.from({ length: 9 }, (_, i) => <i key={i} className="e-node" style={{ "--i": i, "--c": i % 3, "--r": Math.floor(i / 3) }} />)}</>)}
      {k === "app" && (<><i className="e-device e-device--web" /><i className="e-device e-device--phone" /><i className="e-device e-device--ext" /></>)}
    </span>
  );
}

/* Android product showcase — an illustration of the app, with no real data. */
function PhoneMockup() {
  return (
    <div className="hm-phone" aria-hidden="true">
      <div className="hm-phone__body">
        <div className="hm-phone__screen">
          <div className="hm-phone__bar"><span>9:41</span><span className="hm-phone__dots" /></div>
          <div className="hm-phone__head"><ShieldLine size={13} /> Stashr</div>
          <div className="hm-phone__unlock">
            <span className="hm-phone__finger"><i /><i /><i /><i /></span>
            <small>Touch to unlock</small>
          </div>
          <div className="hm-phone__health"><span>Vault health</span><b><i /></b></div>
          <ul className="hm-phone__list">
            <li><span className="hm-phone__ico">E</span><span><b>Email</b><small>••••••••••</small></span><em>Copy</em></li>
            <li className="is-copied"><span className="hm-phone__ico">C</span><span><b>Code hosting</b><small>••••••••••</small></span><em>Copied</em></li>
            <li><span className="hm-phone__ico">B</span><span><b>Bank</b><small>••••••••••</small></span><em>Copy</em></li>
          </ul>
          <div className="hm-phone__autofill"><KeyLine size={12} /> Autofill with Stashr</div>
        </div>
      </div>
      <span className="hm-phone__glow" />
    </div>
  );
}

function Home() {
  const { status, profile, items } = useVault();
  const signedIn = status === "ready" || status === "locked";
  const firstName = (profile?.name || "").split(" ")[0];
  const count = status === "ready" ? items.length : 0;
  const theme = useThemeName();
  const { immersive } = useWorkspaceMode();

  // District markers: real links whose position follows the 3D scene.
  const [focus, setFocus] = useState(null);
  const [deckFocus, setDeckFocus] = useState(null);
  const markerEls = useRef(new Map());
  const anchors = useCallback(() => markerEls.current, []);
  const markerRef = (id) => (el) => { if (el) markerEls.current.set(id, el); else markerEls.current.delete(id); };

  return (
    <div className="hm">
      <section className="hm-hero" aria-labelledby="hm-hero-title">
        <Immersive
          className="hm-hero__scene"
          load={LOADERS.universe}
          opts={{ theme, variant: "hero", focus, anchors }}
          fallback={<WorldScene variant="hero" className="hm-hero__fallback" />}
        />
        <div className="hm-hero__scrim" aria-hidden="true" />

        {immersive && (
          <nav className="hm-markers" aria-label="Stashr districts">
            {DESTINATIONS.map((d) => (
              <Link
                key={d.code}
                ref={markerRef(d.district)}
                to={signedIn || d.open ? d.to : "/signin"}
                className={`hm-marker hm-marker--${d.code.toLowerCase()}`}
                data-visible="0"
                onPointerEnter={() => setFocus(d.district)}
                onPointerLeave={() => setFocus(null)}
                onFocus={() => setFocus(d.district)}
                onBlur={() => setFocus(null)}
              >
                <span className="hm-marker__pin" aria-hidden="true" />
                <span className="hm-marker__label"><b>{d.code}</b>{d.title}</span>
              </Link>
            ))}
          </nav>
        )}

        <div className="hm-hero__inner shell">
          <div className="hm-hero__copy">
            <p className="hm-hero__eyebrow">
              {signedIn ? `Welcome back${firstName ? `, ${firstName}` : ""}` : "Stashr"}
            </p>
            <h1 className="hm-hero__title" id="hm-hero-title">
              <span>Your Digital World.</span>
              <span className="hm-hero__title-2">One Secure Destination.</span>
            </h1>
            <p className="hm-hero__sub">
              Every password, every account, every connection — protected in one beautifully designed vault.
            </p>
            {signedIn && (
              <p className="hm-hero__state">
                {status === "locked"
                  ? "Your vault is locked on this device. Sign in again to open it."
                  : count > 0
                    ? `${count} item${count === 1 ? "" : "s"} in your vault.`
                    : "Your vault is empty. Add your first login to get started."}
              </p>
            )}
            <div className="hm-hero__actions">
              <Link to={signedIn ? "/passwords" : "/signin"} className="btn btn--primary btn--lg hm-cta">
                Open Your Vault <Arrow size={16} />
              </Link>
              <a href="#hm-destinations" onClick={scrollToSecurity} className="btn btn--ghost btn--lg hm-cta hm-cta--ghost">
                Explore Security
              </a>
            </div>
            <p className="hm-hero__links">
              {signedIn ? (
                <Link to="/projects">Go to Projects</Link>
              ) : (
                <>Already have an account? <Link to="/signin">Sign in</Link></>
              )}
            </p>
            <div className="hm-hero__meta">
              <ServiceStatus />
              <span>Free · No ads</span>
              <ModeToggle />
            </div>
            <ul className="hm-hero__specs" aria-label="Security features">
              <li>AES-256-GCM</li><li>TOTP 2FA</li><li>HIBP k-anonymity</li>
            </ul>
            <p className="hm-hero__trust">
              <ShieldLine size={14} /> Your privacy. Your control. Your secure world.
            </p>
          </div>
        </div>
      </section>

      <section className="hm-command shell" aria-labelledby="hm-command-title">
        <div className="hm-command__intro">
          <p className="hm-board-head__label">Vault command deck</p>
          <h2 id="hm-command-title">Your whole digital life. One protected orbit.</h2>
          <p>Move from personal logins to developer projects and security checks without losing your place. The scene is decorative; every station below opens a real Stashr feature.</p>
          <div className="hm-command__stats" aria-label="Vault overview">
            <div><strong>{status === "ready" ? count : "—"}</strong><span>Vault items</span></div>
            <div><strong>{status === "locked" ? "Locked" : signedIn ? "Ready" : "Private"}</strong><span>{signedIn ? "Account state" : "Sign in to view"}</span></div>
          </div>
          <Link to={signedIn ? "/security-center" : "/signin"} className="btn btn--primary hm-command__cta">
            {signedIn ? "Open security center" : "Sign in to your vault"} <Arrow size={15} />
          </Link>
        </div>
        <div className="hm-command__universe" aria-hidden="true">
          <Immersive
            className="hm-command__scene"
            load={LOADERS.vaultCore}
            opts={{ theme, focus: deckFocus }}
            fallback={
              <div className="hm-command__fallback">
                <div className="hm-orbit hm-orbit--outer"><span /><span /><span /></div>
                <div className="hm-orbit hm-orbit--inner"><span /><span /></div>
                <div className="hm-core"><ShieldCheck size={44} /><small>STASHR</small></div>
                <span className="hm-universe__spark hm-universe__spark--one" />
                <span className="hm-universe__spark hm-universe__spark--two" />
                <span className="hm-universe__spark hm-universe__spark--three" />
              </div>
            }
          />
        </div>
        <nav className="hm-command__stations" aria-label="Vault stations" onPointerLeave={() => setDeckFocus(null)} onBlur={() => setDeckFocus(null)}>
          <Link to={signedIn ? "/passwords" : "/signin"} className="hm-station hm-station--vault" onPointerEnter={() => setDeckFocus("vault")} onFocus={() => setDeckFocus("vault")}>
            <span className="hm-station__symbol"><LockLine size={19} /></span><span><strong>Password vault</strong><small>Logins, notes &amp; codes</small></span><Arrow size={15} />
          </Link>
          <Link to={signedIn ? "/projects" : "/signin"} className="hm-station hm-station--dev" onPointerEnter={() => setDeckFocus("dev")} onFocus={() => setDeckFocus("dev")}>
            <span className="hm-station__symbol"><Folder size={19} /></span><span><strong>Developer vault</strong><small>Projects &amp; configuration</small></span><Arrow size={15} />
          </Link>
          <Link to={signedIn ? "/security-center" : "/signin"} className="hm-station hm-station--security" onPointerEnter={() => setDeckFocus("security")} onFocus={() => setDeckFocus("security")}>
            <span className="hm-station__symbol"><ShieldCheck size={19} /></span><span><strong>Security center</strong><small>Health, breaches &amp; sessions</small></span><Arrow size={15} />
          </Link>
          <Link to={signedIn ? "/generator" : "/signin"} className="hm-station hm-station--tools" onPointerEnter={() => setDeckFocus("tools")} onFocus={() => setDeckFocus("tools")}>
            <span className="hm-station__symbol"><KeyLine size={19} /></span><span><strong>Creation lab</strong><small>Generate strong credentials</small></span><Arrow size={15} />
          </Link>
        </nav>
      </section>

      <section className="hm-section shell" id="hm-destinations" tabIndex={-1} aria-labelledby="hm-dest-title">
        <header className="hm-board-head">
          <span className="hm-board-head__label">Destinations</span>
          <h2 className="hm-section__title" id="hm-dest-title">Everything you protect, one terminal away</h2>
          <p className="hm-section__lede">
            Vault items are encrypted on our server with AES-256-GCM, using a per-account key that is itself wrapped by a server key.
          </p>
        </header>
        <ul className="hm-dests">
          {DESTINATIONS.map((d) => (
            <li key={d.code}>
              <Link className={`hm-dest hm-dest--${d.code.toLowerCase()}`} to={signedIn || d.open ? d.to : "/signin"}>
                <span className="hm-dest__stage">
                  <Emblem code={d.code} />
                  <span className="hm-dest__plinth" aria-hidden="true" />
                </span>
                <span className="hm-dest__top">
                  <span className="hm-dest__code" aria-hidden="true">{d.code}</span>
                  <span className="hm-dest__icon" aria-hidden="true">{d.icon}</span>
                </span>
                <span className="hm-dest__title">{d.title}</span>
                <span className="hm-dest__tag">{d.tag}</span>
                <span className="hm-dest__body">{d.body}</span>
                <span className="hm-dest__go">
                  {signedIn || d.open ? "Go" : "Sign in"} <Arrow size={14} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="hm-section shell" aria-labelledby="hm-steps-title">
        <header className="hm-board-head">
          <span className="hm-board-head__label">Route</span>
          <h2 className="hm-section__title" id="hm-steps-title">How it works</h2>
        </header>
        <ol className="hm-steps hm-journey">
          {STEPS.map((s, i) => (
            <li className="hm-step" key={s.title}>
              <span className="hm-step__gate" aria-hidden="true" />
              <span className="hm-step__n">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="hm-section shell">
        <div className="hm-android">
          <WorldScene variant="strip" className="hm-android__scene" parallax={false} />
          <div className="hm-android__inner">
            <div className="hm-android__copy">
              <span className="hm-board-head__label">Android</span>
              <h2 className="hm-section__title hm-android__title">Stashr for Android</h2>
              <p className="hm-android__body">Fingerprint unlock, one-tap copy and autofill in other apps. Same account as the website.</p>
              <ul className="hm-android__feats">
                <li>Fingerprint unlock</li><li>One-tap copy</li><li>Autofill in other apps</li><li>Mobile dashboard</li>
              </ul>
              <a className="btn btn--primary hm-cta" href={ANDROID_URL}>
                Get the app <Arrow size={15} />
              </a>
            </div>
            <PhoneMockup />
          </div>
        </div>
      </section>

      <footer className="hm-foot shell">
        <span className="hm-foot__mark"><ShieldLine size={15} /> Stashr</span>
        <span className="hm-foot__sys" aria-hidden="true">VAULT · PROJECTS · SECURITY · CONTROL</span>
        <span>
          <Link to="/privacy">Privacy</Link> · Web, Android &amp; Chrome
        </span>
      </footer>
    </div>
  );
}

export default Home;
