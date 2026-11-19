import SessionsPanel from "../../Components/Sessions/SessionsPanel";
import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import QRCode from "qrcode";
import Field from "../../Components/Field/Field";
import StrengthMeter from "../../Components/StrengthMeter/StrengthMeter";
import ThemeToggle from "../../Components/ThemeToggle/ThemeToggle";
import ImportModal from "../../Components/Item/ImportModal";
import { ShieldCheck, LockLine, User, Globe, Download, Upload, Trash, Copy, Check, Logout, Arrow, Alert, KeyLine } from "../../Components/Icons/Icons";
import * as api from "../../api/client";
import { exportBackup } from "../../lib/crypto";
import { toCSV } from "../../lib/items";
import { estimate } from "../../lib/strength";
import { useVault } from "../../state/vault";
import "./Settings.css";

import MascotBanner from "../../Components/Robot/MascotBanner";
import { accountMood } from "../../lib/pageMoods";
import { useDialogs } from "../../Components/UI/Dialogs";
import MpinSettings from "./MpinSettings";
import { PageHeader, Badge } from "../../Components/UI/ui";
import { isUserActive } from "../../lib/activity";
const download = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const stamp = () => new Date().toISOString().slice(0, 10);
const ADMIN_EMAIL = "tanushchawla16@gmail.com";

const SECTIONS = [
  ["account", "A1", "Account"],
  ["security", "S2", "Security"],
  ["devices", "D3", "Devices & activity"],
  ["appearance", "V4", "Appearance"],
  ["integrations", "I5", "Integrations"],
  ["data", "B6", "Your data"],
  ["danger", "X7", "Danger zone"],
];
const SECTION_IDS = SECTIONS.map(([id]) => id);

/* Control-center section: an airport-signage label (gate code + title), then its panels. */
function Section({ id, code, title, lede, danger, children }) {
  return (
    <section id={id} tabIndex={-1} className={`csec ${danger ? "csec--danger" : ""}`} aria-labelledby={`${id}-title`}>
      <header className="csec__sign">
        <h2 id={`${id}-title`} className="csec__title">{title}</h2>
        {lede ? <p className="csec__lede">{lede}</p> : null}
      </header>
      <div className="csec__body">{children}</div>
    </section>
  );
}

/* A panel of rows split by dividers, with an optional small heading. */
function Group({ title, children, danger }) {
  return (
    <div className={`sgroup ${danger ? "sgroup--danger" : ""}`}>
      {title ? <h3 className={`sgroup__title ${danger ? "is-danger" : ""}`}>{title}</h3> : null}
      <div className={`sgroup__card ${danger ? "sgroup__card--danger" : ""}`}>{children}</div>
    </div>
  );
}

/* One row: label (+ hint) on the left, control on the right. `block` puts the control underneath. */
function Row({ icon, label, hint, children, block }) {
  return (
    <div className={`srow ${block ? "srow--block" : ""}`}>
      <div className="srow__text">
        <span className="srow__label">{icon ? <span className="srow__icon" aria-hidden="true">{icon}</span> : null}{label}</span>
        {hint ? <span className="srow__hint">{hint}</span> : null}
      </div>
      {children ? <div className="srow__control">{children}</div> : null}
    </div>
  );
}

/* Tracks which section is in view so the menu can highlight it. */
function useScrollSpy(ids) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const seen = new Set();
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id)));
      const first = ids.find((id) => seen.has(id));
      if (first) setActive(first);
    }, { rootMargin: "-25% 0px -65% 0px" });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [ids]);
  return [active, setActive];
}

function SectionNav({ active, onPick }) {
  return (
    <nav className="cnav" aria-label="Settings sections">
      <p className="cnav__head" aria-hidden="true">On this page</p>
      <ul className="cnav__list">
        {SECTIONS.map(([id, , title]) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className={`cnav__link${id === "danger" ? " cnav__link--danger" : ""}${active === id ? " is-active" : ""}`}
              aria-current={active === id ? "location" : undefined}
              onClick={(e) => { e.preventDefault(); onPick(id); }}
            >
              <span className="cnav__text">{title}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* Where users say which of their variables belong to which service (and see what Stashr guessed). */
function ServiceMapCard() {
  return (
    <Group title="Services & usage mapping">
      <Row label="Tell Stashr which variable is which service" hint="Stashr guesses from variable names, values and your code. If it gets one wrong, or can’t tell, set it yourself: usage is then read from your choice, on every device.">
        <Link className="btn btn--ghost btn--sm" to="/services/map">Open mapping →</Link>
      </Row>
    </Group>
  );
}

/* Admin only: services users have that Stashr cannot read usage for yet. Built from what each user's own Services
   page found, so nothing scans anyone's servers; counts only, never identities, values or service names. */
function AdminNeedsPanel() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { setData(await api.getUsageNeeds()); }
    catch (e) { setError(api.errorMessage(e) || "Could not load the list."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const list = data?.services || [];

  return (
    <Group title="Admin · Services that need a usage reader">
      <div className="settings-admin">
        <div className="settings-admin__head">
          <div><strong>Add a reader for these</strong><p className="srow__hint">Only services users actually have, found automatically or mapped by hand, where no usage reader exists yet. Your own account is left out. Variable and package names are what you need to write the reader.</p></div>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void load()}>{busy ? "Loading…" : "↻ Refresh"}</button>
        </div>
        {error && <p className="settings-admin__error" role="alert">{error}</p>}
        {data && !list.length && <p className="settings-admin__empty">Nothing waiting: every service users have already has a usage reader (or nothing to track).</p>}
        {list.map((item) => (
          <article className="settings-admin__service" key={item.key}>
            <div className="settings-admin__service-title">
              <div><strong>{item.label}</strong><small>{item.category} · {item.userCount} user{item.userCount === 1 ? "" : "s"} · last seen {new Date(item.lastSeenAt).toLocaleDateString()}</small></div>
            </div>
            {item.vars?.length > 0 && <div className="settings-admin__vars">{item.vars.map((name) => <code key={name}>{name}</code>)}</div>}
            {item.packages?.length > 0 && <small className="srow__hint">Packages: {item.packages.join(", ")}</small>}
          </article>
        ))}
        <h3>Services that already have a usage reader</h3>
        <div className="settings-admin__providers">{(data?.usageReaders || []).map((provider) => <span className="settings-admin__provider" key={provider.key}><strong>{provider.label}</strong><small>{provider.category}</small></span>)}</div>
      </div>
    </Group>
  );
}

/* Telegram bot: paste the token, press Start in the bot, done. */
function TelegramBot() {
  const { confirm } = useDialogs();
  const [state, setState] = useState(null);
  const [token, setToken] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => { try { setState(await api.getTelegram()); } catch { setState({ connected: false }); } }, []);
  useEffect(() => { void load(); }, [load]);
  // While waiting for "Start" in Telegram, check every few seconds.
  useEffect(() => {
    if (!state?.linkUrl || state.connected) return undefined;
    const t = window.setInterval(() => { if (!document.hidden && isUserActive()) void load(); }, 4000);
    return () => window.clearInterval(t);
  }, [state?.linkUrl, state?.connected, load]);
  const run = async (key, fn, ok) => {
    setBusy(key);
    try { const r = await fn(); if (r && typeof r === "object" && "connected" in r) setState(r); if (ok) toast.success(ok); }
    catch (e) { toast.error(api.errorMessage(e, "That did not work.")); }
    finally { setBusy(""); }
  };
  if (!state) return <Row label="Telegram bot" hint="Loading…" />;
  if (!state.connected && !state.linkUrl) return (
    <Row icon={<Alert size={15} />} label="Connect your Telegram bot" hint="Create a bot with @BotFather, paste its token here. You get server alerts, a status update every 10 minutes and answers to /status, /servers, /projects, /pass." block>
      <form className="settings__inline" onSubmit={(e) => { e.preventDefault(); void run("connect", () => api.connectTelegram(token), "Bot connected — now press Start in Telegram."); }}>
        <input className="input" type="password" autoComplete="off" placeholder="123456789:AA…" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Bot token" />
        <button className="btn btn--primary btn--sm" disabled={!token.trim() || Boolean(busy)}>{busy === "connect" ? "Connecting…" : "Connect"}</button>
      </form>
    </Row>
  );
  if (!state.connected) return (
    <Row icon={<Alert size={15} />} label={"Last step: open @" + state.botUsername + " and press Start"} hint="This links the bot to your Telegram chat. Only that chat will ever be answered." block>
      <div className="settings__inline">
        <a className="btn btn--primary btn--sm" href={state.linkUrl} target="_blank" rel="noopener noreferrer">Open Telegram and press Start</a>
        <span className="srow__hint">Waiting… this page updates by itself.</span>
      </div>
    </Row>
  );
  return (
    <>
      <Row icon={<Alert size={15} />} label={"Connected to @" + state.botUsername} hint={"Chat: " + (state.chatName || "you") + (state.updates === "timer" && state.lastDigestAt ? " · last update " + new Date(state.lastDigestAt).toLocaleTimeString() : "")}>
        <div className="settings__inline">
          <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busy)} onClick={() => void run("test", api.testTelegramBot, "Status sent to Telegram.")}>Send status now</button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busy)} onClick={async () => { if (await confirm({ title: "Disconnect the Telegram bot?", message: "Alerts stop until you connect it again.", confirmLabel: "Disconnect", tone: "danger" })) void run("off", api.disconnectTelegram, "Disconnected."); }}>Disconnect</button>
        </div>
      </Row>
      <Row label="When should the bot message me?" hint="Off by default: it stays quiet unless you ask. You can always ask in Telegram with the menu buttons under the chat box, or /updates." block>
        <div className="settings__modes" role="radiogroup" aria-label="When the bot messages you">
          {[
            ["ask", "🔕 Only when I ask", "No automatic messages at all, not even alerts."],
            ["alerts", "🚨 Alerts only", "A message when something breaks. No timed updates."],
            ["timer", "⏱ Alerts + a timed update", "A short status every few minutes (you choose how often)."]
          ].map(([id, title, text]) => (
            <label key={id} className={"settings__mode" + (state.updates === id ? " is-on" : "")}>
              <input type="radio" name="tg-updates" checked={state.updates === id} disabled={Boolean(busy)} onChange={() => void run("u", () => api.saveTelegram({ updates: id }), id === "ask" ? "The bot only answers when you ask." : id === "alerts" ? "Alerts only." : "Timed updates on.")} />
              <span><strong>{title}</strong><small>{text}</small></span>
            </label>
          ))}
        </div>
        {state.updates === "timer" && (
          <div className="settings__inline settings__modes-more">
            <select className="input settings__select" value={state.digestMinutes} onChange={(e) => void run("d", () => api.saveTelegram({ digestMinutes: Number(e.target.value) }))} aria-label="How often">
              {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>Every {m} min</option>)}
            </select>
            <label className="srow__hint"><input type="checkbox" checked={state.digestQuietWhenOk} onChange={(e) => void run("q", () => api.saveTelegram({ digestQuietWhenOk: e.target.checked }))} /> Only when something is wrong</label>
          </div>
        )}
      </Row>
      <Row label="Passwords over Telegram" hint={state.passwordsAllowed ? "On. In Telegram tap 🔑 Passwords, type a name, then send your PIN. Your PIN message and the reply delete themselves after 60 seconds." : "Off. Pick a 4 to 8 digit PIN and turn it on. Telegram chats are not end-to-end encrypted, so keep the PIN private."} block>
        {state.passwordsAllowed ? (
          <div className="settings__inline">
            <span className="srow__hint">✅ On</span>
            <button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(busy)} onClick={() => void run("p", () => api.saveTelegram({ passwordsAllowed: false }), "Passwords off.")}>Turn off</button>
            <details className="settings__pin">
              <summary>Change PIN</summary>
              <form className="settings__inline" onSubmit={(e) => { e.preventDefault(); void run("pin", () => api.saveTelegram({ pin }), "PIN saved."); setPin(""); }}>
                <input className="input" type="password" inputMode="numeric" pattern="[0-9]{4,8}" placeholder="New PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} aria-label="New PIN" style={{ width: "8rem" }} />
                <button className="btn btn--ghost btn--sm" disabled={pin.length < 4 || Boolean(busy)}>Save PIN</button>
              </form>
            </details>
          </div>
        ) : (
          <form className="settings__inline" onSubmit={(e) => { e.preventDefault(); void run("pin", () => api.saveTelegram(pin ? { pin, passwordsAllowed: true } : { passwordsAllowed: true }), "Passwords on — keep your PIN private."); setPin(""); }}>
            <input className="input" type="password" inputMode="numeric" pattern="[0-9]{4,8}" placeholder={state.pinSet ? "PIN (saved — or set a new one)" : "Choose a PIN"} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} aria-label="PIN" style={{ width: "11rem" }} />
            <button className="btn btn--primary btn--sm" disabled={(pin.length < 4 && !state.pinSet) || (pin.length > 0 && pin.length < 4) || Boolean(busy)}>Turn on</button>
          </form>
        )}
      </Row>
    </>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track"><span className="switch__thumb" /></span>
      {label ? <span className="settings-sr">{label}</span> : null}
    </label>
  );
}

function RecoveryCodes({ codes, onDone }) {
  const text = codes.join("\n");
  return (
    <div className="recovery">
      <p className="notice notice--ok">
        <Check size={15} /> Save these one-time recovery codes somewhere safe. Each one gets you in once if you lose your phone.
      </p>
      <div className="recovery__grid">
        {codes.map((c) => <code key={c}>{c}</code>)}
      </div>
      <div className="settings__row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigator.clipboard.writeText(text).then(() => toast.info("Codes copied"))}>
          <Copy size={14} /> Copy
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => download(`aurelia-recovery-codes-${stamp()}.txt`, `Stashr recovery codes\n\n${text}\n`, "text/plain")}>
          <Download size={14} /> Download
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={onDone}>I've saved them</button>
      </div>
    </div>
  );
}

function TwoFactor() {
  const { profile, refreshProfile } = useVault();
  const enabled = profile?.twoFactorEnabled;
  const [step, setStep] = useState("idle"); // idle | password | scan | codes | disable | regen
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState("");
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (setup?.otpauthUrl) {
      QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 220, color: { dark: "#1e1b4b", light: "#ffffff" } }).then(setQr);
    }
  }, [setup]);

  const reset = () => {
    setStep("idle");
    setPassword("");
    setCode("");
    setSetup(null);
    setQr("");
  };

  const run = async (fn) => {
    try {
      setBusy(true);
      await fn();
    } catch (err) {
      toast.error(api.errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (step === "codes") {
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          setCodes([]);
          reset();
          refreshProfile();
        }}
      />
    );
  }

  if (enabled) {
    return (
      <div>
        <p className="settings__status settings__status--on">
          <ShieldCheck size={16} /> Two-factor login is on · {profile.recoveryCodesLeft} recovery code{profile.recoveryCodesLeft === 1 ? "" : "s"} left
        </p>
        {step === "disable" || step === "regen" ? (
          <form
            className="settings__form"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (step === "disable") {
                  await api.twoFactorDisable({ password, code });
                  toast.success("Two-factor login turned off.");
                  reset();
                  refreshProfile();
                } else {
                  const res = await api.twoFactorRecoveryCodes({ password, code });
                  setCodes(res.data.recoveryCodes);
                  setStep("codes");
                }
              });
            }}
          >
            <Field id="tf-pass" label="Master password" secret value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            <Field id="tf-code" label="Authenticator or recovery code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
            <div className="settings__row">
              <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Cancel</button>
              <button type="submit" className={`btn btn--sm ${step === "disable" ? "btn--danger" : "btn--primary"}`} disabled={busy || !password || !code}>
                {busy ? <span className="spinner" /> : null} {step === "disable" ? "Turn off 2FA" : "New recovery codes"}
              </button>
            </div>
          </form>
        ) : (
          <div className="settings__row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setStep("regen")}>New recovery codes</button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setStep("disable")}>Turn off</button>
          </div>
        )}
      </div>
    );
  }

  if (step === "idle") {
    return (
      <div>
        <p className="settings__status">Add a second step to sign-in with Google Authenticator, Aegis, Authy or 1Password.</p>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setStep("password")}>
          <ShieldCheck size={14} /> Turn on two-factor login
        </button>
      </div>
    );
  }

  if (step === "password") {
    return (
      <form
        className="settings__form"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const res = await api.twoFactorSetup(password);
            setSetup(res.data);
            setStep("scan");
          });
        }}
      >
        <Field id="tf-setup-pass" label="Confirm your master password" secret value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        <div className="settings__row">
          <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Cancel</button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !password}>
            {busy ? <span className="spinner" /> : null} Continue
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="settings__form twofa"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const res = await api.twoFactorEnable(code);
          setCodes(res.data.recoveryCodes);
          setStep("codes");
          toast.success("Two-factor login is on 🔐");
        });
      }}
    >
      <div className="twofa__scan">
        {qr ? <img src={qr} alt="QR code for your authenticator app" width="180" height="180" /> : <span className="spinner spinner--accent" />}
        <div>
          <p>1. Scan this with your authenticator app, or enter the key:</p>
          <code className="twofa__secret">{setup?.secret?.match(/.{1,4}/g)?.join(" ")}</code>
          <p>2. Enter the 6-digit code it shows.</p>
        </div>
      </div>
      <Field id="tf-enable-code" label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus />
      <div className="settings__row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={reset}>Cancel</button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy || code.replace(/\s/g, "").length !== 6}>
          {busy ? <span className="spinner" /> : null} Verify and turn on
        </button>
      </div>
    </form>
  );
}

function ChangeMasterPassword() {
  const { changePassword, profile } = useVault();
  const [form, setForm] = useState({ current: "", next: "", confirm: "", code: "" });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const strength = estimate(form.next);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.next.length < 8) return toast.error("Use at least 8 characters.");
    if (strength.score < 2) return toast.error("Choose a stronger password.");
    if (form.next !== form.confirm) return toast.error("The new passwords don't match.");
    try {
      setBusy(true);
      await changePassword({ current: form.current, next: form.next, code: form.code });
      toast.success("Password changed. Other devices were signed out.");
      setForm({ current: "", next: "", confirm: "", code: "" });
      setOpen(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(true)}>
        <KeyLine size={14} /> Change password
      </button>
    );
  }

  return (
    <form className="settings__form settings__form--full" onSubmit={submit}>
      <Field id="mp-current" label="Current password" secret value={form.current} onChange={set("current")} autoComplete="current-password" />
      <Field id="mp-next" label="New password" secret value={form.next} onChange={set("next")} autoComplete="new-password" />
      {form.next ? <StrengthMeter strength={strength} /> : null}
      <Field id="mp-confirm" label="Confirm new password" secret value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
      {profile?.twoFactorEnabled ? <Field id="mp-code" label="Authenticator code" value={form.code} onChange={set("code")} autoComplete="one-time-code" /> : null}
      <div className="settings__row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !form.current || !form.next}>
          {busy ? <span className="spinner" /> : null} {busy ? "Saving…" : "Change password"}
        </button>
      </div>
    </form>
  );
}

function ExportData() {
  const { items } = useVault();
  const [mode, setMode] = useState(null); // backup | csv
  const [pass, setPass] = useState({ a: "", b: "" });
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const backup = async (e) => {
    e.preventDefault();
    if (pass.a.length < 8) return toast.error("Use at least 8 characters for the backup password.");
    if (pass.a !== pass.b) return toast.error("Passwords don't match.");
    try {
      setBusy(true);
      const clean = items.map(({ id, createdAt, updatedAt, ...rest }) => rest);
      download(`aurelia-backup-${stamp()}.aurelia`, await exportBackup(clean, pass.a), "application/json");
      toast.success("Encrypted backup downloaded.");
      setMode(null);
      setPass({ a: "", b: "" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="settings__row">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setMode("backup")} disabled={!items.length}>
          <Download size={14} /> Encrypted backup
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMode("csv")} disabled={!items.length}>
          <Download size={14} /> Plain CSV
        </button>
      </div>
      {mode === "backup" ? (
        <form className="settings__form" onSubmit={backup}>
          <p className="field__note">The file is encrypted with a separate password. You'll need it to import the backup.</p>
          <Field id="bk-a" label="Backup password" secret value={pass.a} onChange={(e) => setPass((p) => ({ ...p, a: e.target.value }))} autoComplete="new-password" />
          <Field id="bk-b" label="Confirm backup password" secret value={pass.b} onChange={(e) => setPass((p) => ({ ...p, b: e.target.value }))} autoComplete="new-password" />
          <div className="settings__row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMode(null)}>Cancel</button>
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
              {busy ? <span className="spinner" /> : null} Download backup
            </button>
          </div>
        </form>
      ) : null}
      {mode === "csv" ? (
        <div className="settings__form">
          <label className="consent">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>
              <Alert size={14} /> A CSV is <strong>not encrypted</strong>. Anyone who gets the file can read every password. Delete it once you've used it.
            </span>
          </label>
          <div className="settings__row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMode(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn--danger btn--sm"
              disabled={!ack}
              onClick={() => {
                download(`aurelia-export-${stamp()}.csv`, toCSV(items), "text/csv");
                setMode(null);
                setAck(false);
              }}
            >
              Download CSV
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DeleteAccount() {
  const { profile, logout } = useVault();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ password: "", code: "", confirm: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    try {
      setBusy(true);
      await api.deleteAccount({ password: form.password, code: form.code || undefined });
      await logout();
      toast.success("Your account and vault were deleted.");
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(api.errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn--ghost btn--sm settings__danger-btn" onClick={() => setOpen(true)}>
        <Trash size={14} /> Delete my account
      </button>
    );
  }
  return (
    <form className="settings__form" onSubmit={submit}>
      <p className="notice notice--err">
        <Alert size={15} /> This permanently deletes your account and every item in your vault. It can't be undone.
      </p>
      <Field id="del-pass" label="Master password" secret value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} autoComplete="current-password" />
      {profile?.twoFactorEnabled ? (
        <Field id="del-code" label="Authenticator code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
      ) : null}
      <Field id="del-confirm" label='Type "DELETE" to confirm' value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} />
      <div className="settings__row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn btn--danger btn--sm" disabled={busy || form.confirm !== "DELETE" || !form.password}>
          {busy ? <span className="spinner" /> : <Trash size={14} />} Delete forever
        </button>
      </div>
    </form>
  );
}

export default function Settings() {
  const { profile, prefs, setPrefs, lock, importItems, setProfileName } = useVault();
  const [name, setName] = useState(profile?.name || "");
  const [importing, setImporting] = useState(false);

  const saveName = async (e) => {
    e.preventDefault();
    try {
      await api.updateProfile(name.trim());
      setProfileName(name.trim());
      toast.success("Name updated.");
    } catch (err) {
      toast.error(api.errorMessage(err));
    }
  };


  const [active, setActive] = useScrollSpy(SECTION_IDS);
  const pick = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
    el.focus({ preventScroll: true });
  };
  const twoFa = Boolean(profile?.twoFactorEnabled);
  const sessionCount = Math.max(1, profile?.sessions || 1);
  const initial = (profile?.name || profile?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="settings page">
      <div className="cc">
        <PageHeader
          title="Settings"
          subtitle={
            <span className="cc__sub">
              <span className="cc__avatar" aria-hidden="true">{initial}</span>
              <span><strong>{profile?.name || "Your account"}</strong> · {profile?.email}</span>
            </span>
          }
        >
          <ul className="cc__chips" aria-label="Account status">
            <li><Badge tone={twoFa ? "ok" : "warn"} dot>Two-factor {twoFa ? "on" : "off"}</Badge></li>
            <li><Badge tone="neutral" dot>{sessionCount} signed-in session{sessionCount === 1 ? "" : "s"}</Badge></li>
            {twoFa ? <li><Badge tone={profile.recoveryCodesLeft > 2 ? "neutral" : "warn"} dot>{profile.recoveryCodesLeft} recovery code{profile.recoveryCodesLeft === 1 ? "" : "s"} left</Badge></li> : null}
          </ul>
        </PageHeader>

        <div className="cc__layout">
          <SectionNav active={active} onPick={pick} />

          <div className="cc__main">
            <MascotBanner kind="gear" {...accountMood(profile)} />

            <Section id="account" code="A1" title="Account" lede="Who you are and how you sign in.">
              <Group>
                <Row icon={<User size={15} />} label="Name" hint="How Stashr greets you.">
                  <form className="settings__inline" onSubmit={saveName}>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" maxLength={80} />
                    <button type="submit" className="btn btn--ghost btn--sm" disabled={!name.trim() || name.trim() === profile?.name}>Save</button>
                  </form>
                </Row>
                <Row icon={<LockLine size={15} />} label="Master password" hint="Changing it signs out your other devices and turns off every MPIN." block>
                  <ChangeMasterPassword />
                </Row>
                <Row icon={<KeyLine size={15} />} label="4-digit MPIN" hint="Sign in on this device with just four digits instead of your email and password. Your email and password stay as the way back in." block>
                  <MpinSettings />
                </Row>
              </Group>
            </Section>

            <Section id="security" code="S2" title="Security" lede="Second sign-in step, locking and breach checks.">
              <Group title="Two-factor login">
                <Row icon={<ShieldCheck size={15} />} label="Authenticator app" hint="Protects your account even if your password leaks." block>
                  <TwoFactor />
                </Row>
              </Group>
              <Group title="Protection">
                <Row icon={<LockLine size={15} />} label="Lock now" hint="Sign out of this device now. You stay signed in otherwise, until you lock or sign out yourself.">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={lock}>Lock</button>
                </Row>
                <Row label="Weekly breach check" hint="Checks your passwords against Have I Been Pwned about once a week while you use the vault. Only the first 5 characters of each password's hash are sent.">
                  <Toggle checked={Boolean(prefs.autoBreach)} onChange={(v) => setPrefs({ autoBreach: v })} label="Weekly breach check" />
                </Row>
                <Row label="Show values in project search" hint="When off, matching secret values stay hidden (••••) until you tap the eye.">
                  <Toggle checked={prefs.searchValues} onChange={(v) => setPrefs({ searchValues: v })} label="Show values in project search" />
                </Row>
              </Group>
            </Section>

            <Section id="devices" code="D3" title="Devices & activity" lede="Where you are signed in, and your recent security events.">
              <Group>
                <Row icon={<Logout size={15} />} label="Signed-in devices" hint={`This device and ${Math.max(0, (profile?.sessions || 1) - 1)} other session(s). Sign out any you don't recognise.`} block>
                  <SessionsPanel />
                </Row>
              </Group>
            </Section>

            <Section id="appearance" code="V4" title="Appearance" lede="Theme and the scenery around every page.">
              <Group>
                <Row icon={<Globe size={15} />} label="Theme">
                  <ThemeToggle />
                </Row>
                <Row label="Jungle scene" hint="Grass, vines, animals, birds and fireflies around every page, with the robots mixed in. Day jungle in the light theme, night jungle in the dark theme.">
                  <Toggle checked={prefs.jungle !== false} onChange={(v) => setPrefs({ jungle: v })} label="Jungle scene" />
                </Row>
                <Row label="Fun effects" hint="Robots fly by, planes land when you save, and things blow up when something is deleted for good or goes down. Off automatically if your device asks for reduced motion.">
                  <Toggle checked={prefs.fx !== false} onChange={(v) => setPrefs({ fx: v })} label="Fun effects" />
                </Row>
                <Row label="Website icons" hint="Fetched from DuckDuckGo, which can see which sites you have saved.">
                  <Toggle checked={prefs.icons} onChange={(v) => setPrefs({ icons: v })} label="Website icons" />
                </Row>
              </Group>
            </Section>

            <Section id="integrations" code="I5" title="Integrations" lede="Telegram alerts and how your services are recognised.">
              <Group title="Telegram">
                <TelegramBot />
              </Group>
              <ServiceMapCard />
              {(profile?.isAdmin || String(profile?.email || "").trim().toLowerCase() === ADMIN_EMAIL) && <AdminNeedsPanel />}
            </Section>

            <Section id="data" code="B6" title="Your data" lede="Export, import and privacy.">
              <Group>
                <Row icon={<Download size={15} />} label="Export" hint="Take it anywhere." block>
                  <ExportData />
                </Row>
                <Row icon={<Upload size={15} />} label="Import" hint="From a backup, CSV or another password manager.">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setImporting(true)}>Import</button>
                </Row>
                <Row label="Privacy policy">
                  <Link to="/privacy" className="btn btn--ghost btn--sm">Open</Link>
                </Row>
              </Group>
            </Section>

            <Section id="danger" code="X7" title="Danger zone" lede="Permanent actions. Read each step carefully." danger>
              <Group danger>
                <Row icon={<Trash size={15} />} label="Delete account" hint="Permanently deletes your account and vault." block>
                  <DeleteAccount />
                </Row>
              </Group>
            </Section>
          </div>
        </div>
      </div>
      <ImportModal open={importing} onClose={() => setImporting(false)} onImport={importItems} />
    </div>
  );
}
