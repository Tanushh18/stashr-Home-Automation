import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Link } from "react-router-dom";
import { getSmsOverview, getGgnSmsOverview, saveGgnSmsSettings, saveSmsSettings, saveSmsSheet, saveSmsDevice, getSmsLog, sendSmsTest, getWaOverview } from "../../api/client";
import { Section, Skeleton } from "../Render/RenderUi";
import { usePolling } from "../Render/renderHooks";
import { errorMessage } from "../Render/renderUtils";
import { ago } from "../../lib/smartHome";
import { STARTER_QUOTES, textsToBox, boxToTexts } from "../../lib/waStarter";
import { smsInfo } from "../../lib/smsText";
import "../Render/RenderDashboard.css";
import "../WhatsApp/WhatsAppSender.css";

/*
 * SMS sender: Shine One's text messages to the people of the We Three lead sheets. The phones running the SMS Service app send them;
 * the queue and the limits live on the We Three server, and this page is where they are managed (it replaced the Shine One part of
 * the ggnHome SMS console).
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ROLE_LABEL = { shine: "Shine One", ggnhome: "GGN Home", both: "Both" };
const STATUS_LABEL = { sending: "Sending", sent: "Sent", failed: "Failed", pending: "Waiting" };
const when = (v) => (v ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "");

/** The numbers Stashr suggests when a limit is switched on. Nothing is built into the servers: off = no limit. */
const SUGGESTED = { dailyLimit: 90, hourlyLimit: 30, gapMinSec: 8, gapMaxSec: 14, lunchQuota: 30 };
const CEIL = { dailyLimit: 200, hourlyLimit: 60, gapMinSec: 600, gapMaxSec: 900, lunchQuota: 200 };

/** One limit with its own on/off switch. Off sends null (no limit). */
function LimitField({ k, label, f, set }) {
  const on = f[k] !== null && f[k] !== undefined && f[k] !== "";
  return (
    <div className="wa-label">
      <label className="wa-check"><input type="checkbox" checked={on} onChange={(e) => set(k, e.target.checked ? SUGGESTED[k] : null)} /> {label}</label>
      <input className="wa-input is-short" type="number" min="1" max={CEIL[k]} aria-label={label} value={on ? f[k] : ""} placeholder="no limit" disabled={!on} onChange={(e) => set(k, e.target.value)} />
    </div>
  );
}

/** Limits and sending times for Shine One (We Three). Every limit has its own switch; the servers have none built in. */
function LimitsCard({ settings, onSaved }) {
  const [f, setF] = useState(() => ({ ...settings }));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF({ ...settings }); }, [settings]);
  const set = (k, v) => setF((cur) => ({ ...cur, [k]: v }));
  const eff = settings.effective || {};
  const txt = (v, unit) => (v === null || v === undefined ? "no limit" : `${v}${unit}`);
  const save = async () => {
    setBusy(true);
    try {
      const body = { lunchStart: f.lunchStart, lunchEnd: f.lunchEnd, nightStart: f.nightStart, nightEnd: f.nightEnd, days: f.days };
      for (const k of Object.keys(SUGGESTED)) body[k] = f[k] === null || f[k] === undefined || f[k] === "" ? null : Number(f[k]);
      await saveSmsSettings(body);
      toast.success("Limits saved.");
      await onSaved();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Section title="Limits and sending times" subtitle={`Now: ${txt(eff.dailyLimit, " a day")} per phone, ${txt(eff.hourlyLimit, " an hour")}, gap ${eff.gapMinSec == null && eff.gapMaxSec == null ? "none" : `${eff.gapMinSec ?? 0}–${eff.gapMaxSec ?? eff.gapMinSec} seconds`}. Switch a limit off to remove it. Times are India time.`}>
      <div className="wa-row">
        <LimitField k="dailyLimit" label="Messages a day (per phone)" f={f} set={set} />
        <LimitField k="hourlyLimit" label="Messages an hour" f={f} set={set} />
        <LimitField k="gapMinSec" label="Shortest gap (seconds)" f={f} set={set} />
        <LimitField k="gapMaxSec" label="Longest gap (seconds)" f={f} set={set} />
        <LimitField k="lunchQuota" label="At most at lunch" f={f} set={set} />
      </div>
      <div className="wa-row">
        <label className="wa-label">Lunch from <input className="wa-input is-short" type="time" value={f.lunchStart || ""} onChange={(e) => set("lunchStart", e.target.value)} /></label>
        <label className="wa-label">to <input className="wa-input is-short" type="time" value={f.lunchEnd || ""} onChange={(e) => set("lunchEnd", e.target.value)} /></label>
        <label className="wa-label">Night from <input className="wa-input is-short" type="time" value={f.nightStart || ""} onChange={(e) => set("nightStart", e.target.value)} /></label>
        <label className="wa-label">to <input className="wa-input is-short" type="time" value={f.nightEnd || ""} onChange={(e) => set("nightEnd", e.target.value)} /></label>
      </div>
      <div className="wa-row" role="group" aria-label="Sending days">
        {DAYS.map((d, i) => (
          <label key={d} className="wa-check"><input type="checkbox" checked={(f.days || []).includes(i)} onChange={(e) => set("days", e.target.checked ? [...(f.days || []), i].sort() : (f.days || []).filter((x) => x !== i))} /> {d}</label>
        ))}
      </div>
      <div className="wa-row"><button className="rd-btn is-primary" disabled={busy} onClick={save}>Save limits</button></div>
    </Section>
  );
}

/** GGN Home: its login-code SMS limits (the same on/off per limit) and its phones. Managed here, sent by the ggnHome server. */
function GgnhomeCard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const d = await getGgnSmsOverview(); setData(d); setF({ ...(d.ggnhome || {}).settings }); setErr(""); }
    catch (e) { setErr(errorMessage(e, "Could not reach ggnHome.")); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const set = (k, v) => setF((cur) => ({ ...cur, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { showOtpOnAndroid: !!f.showOtpOnAndroid };
      for (const k of ["dailyLimit", "hourlyLimit", "gapMinSec", "gapMaxSec"]) body[k] = f[k] === null || f[k] === undefined || f[k] === "" ? null : Number(f[k]);
      await saveGgnSmsSettings(body);
      toast.success("GGN Home limits saved.");
      await load();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  if (err && !data) return <Section title="GGN Home SMS"><p className="wa-error">{err}</p></Section>;
  if (!data) return <Section title="GGN Home SMS"><Skeleton /></Section>;
  const eff = ((data.ggnhome || {}).settings || {}).effective || {};
  const txt = (v, unit) => (v === null || v === undefined ? "no limit" : `${v}${unit}`);
  return (
    <Section title="GGN Home SMS (login codes)" subtitle={`Now: ${txt(eff.dailyLimit, " a day")} per phone, ${txt(eff.hourlyLimit, " an hour")}, gap ${eff.gapMinSec == null && eff.gapMaxSec == null ? "none" : `${eff.gapMinSec ?? 0}–${eff.gapMaxSec ?? eff.gapMinSec} seconds`}. ${(data.ggnhome || {}).pending || 0} waiting to be sent.`}>
      <div className="wa-row">
        <LimitField k="dailyLimit" label="Messages a day (per phone)" f={f} set={set} />
        <LimitField k="hourlyLimit" label="Messages an hour" f={f} set={set} />
        <LimitField k="gapMinSec" label="Shortest gap (seconds)" f={f} set={set} />
        <LimitField k="gapMaxSec" label="Longest gap (seconds)" f={f} set={set} />
      </div>
      <div className="wa-row">
        <label className="wa-check"><input type="checkbox" checked={!!f.showOtpOnAndroid} onChange={(e) => set("showOtpOnAndroid", e.target.checked)} /> Show login codes in the Android app instead of sending SMS</label>
      </div>
      <div className="wa-row"><button className="rd-btn is-primary" disabled={busy} onClick={save}>Save GGN Home limits</button></div>
    </Section>
  );
}

/** One We Three sheet: its counts, the Auto-send switch and its messages (one picked at random per SMS). */
function SheetCard({ sheet, waSheets, onChanged }) {
  const [box, setBox] = useState(textsToBox(sheet.texts));
  const [onlyNew, setOnlyNew] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBox(textsToBox(sheet.texts)); }, [sheet.texts]);
  const texts = boxToTexts(box);
  const unsaved = JSON.stringify(texts) !== JSON.stringify(sheet.texts || []);
  const tooLong = texts.some((t) => t.length > 600);
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await onChanged(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const copyFrom = (id) => {
    const wa = waSheets.find((s) => s._id === id);
    if (!wa) return;
    if (box.trim() && !window.confirm(`Replace the messages in the box with the ${wa.texts.length} messages of the WhatsApp sheet "${wa.name}"? Nothing is saved until you press Save messages.`)) return;
    setBox(textsToBox(wa.texts));
  };
  const parts = texts.map((t) => smsInfo(t));
  const worst = parts.reduce((m, p) => Math.max(m, p.parts), 0);
  const unicode = parts.some((p) => p.encoding === "Unicode");
  return (
    <Section title={sheet.sheet} subtitle={`${sheet.total} people · ${sheet.remaining} to send${sheet.etaDays ? ` · about ${sheet.etaDays} ${sheet.etaDays === 1 ? "day" : "days"} at the current limits` : ""}${sheet.onlyNewSince ? ` · only leads added since ${when(sheet.onlyNewSince)}` : ""}`}>
      <div className="wa-row">
        <label className="wa-check">
          <input type="checkbox" checked={sheet.auto} disabled={busy} onChange={(e) => run(() => saveSmsSheet({ sheet: sheet.sheet, auto: e.target.checked, onlyNew: e.target.checked && onlyNew }), e.target.checked ? "Auto-send is on for this sheet." : "Auto-send is off for this sheet.")} />
          <b>Auto-send</b> {sheet.auto ? "on" : "off"}
        </label>
        {!sheet.auto ? <label className="wa-check"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> When switching on, only leads added from now on</label> : null}
      </div>
      <div className="wa-stats">
        <span><b>{sheet.remaining}</b> to send</span>
        <span><b>{sheet.sent}</b> sent</span>
        <span><b>{sheet.delivered}</b> delivered</span>
        <span><b>{sheet.failed}</b> failed</span>
        <span><b>{sheet.invalid}</b> bad numbers</span>
      </div>
      <label className="wa-label" htmlFor={"sms-" + sheet.sheet}>Messages. Put a line with only --- between two messages. One is picked at random for each person. Use {"{name}"} for the name.</label>
      <textarea id={"sms-" + sheet.sheet} className="wa-input" rows={6} value={box} onChange={(e) => setBox(e.target.value)} />
      <p className={"wa-muted" + (tooLong ? " wa-error" : "")}>
        {texts.length} {texts.length === 1 ? "message" : "messages"}
        {texts.length ? ` · the longest is ${worst} SMS ${worst === 1 ? "part" : "parts"}${unicode ? " (emoji or ₹ make a message Unicode: 70 characters per SMS)" : ""}` : ""}
        {tooLong ? " · a message is over 600 characters" : ""}
        {unsaved ? " · not saved yet" : ""}
      </p>
      <div className="wa-row">
        <button className="rd-btn is-primary" disabled={busy || !unsaved || tooLong} onClick={() => run(() => saveSmsSheet({ sheet: sheet.sheet, texts }), "Messages saved.")}>Save messages</button>
        <select className="wa-input is-short" aria-label="Copy the messages of a WhatsApp sheet" value="" onChange={(e) => copyFrom(e.target.value)} disabled={!waSheets.length}>
          <option value="">{waSheets.length ? "Copy from a WhatsApp sheet…" : "No WhatsApp sheet has messages"}</option>
          {waSheets.map((s) => <option key={s._id} value={s._id}>{s.name} ({s.texts.length})</option>)}
        </select>
        <button className="rd-btn is-quiet" disabled={busy} onClick={() => { if (!box.trim() || window.confirm("Replace the messages in the box with the 25 We Three quotes?")) setBox(textsToBox(STARTER_QUOTES)); }}>Use the 25 We Three quotes</button>
      </div>
    </Section>
  );
}

/** The phones running the SMS Service app: which service each one sends for, and whether it sends at all. */
function PhonesCard({ devices, onChanged }) {
  const [busy, setBusy] = useState("");
  const change = async (d, body, ok) => {
    setBusy(d.deviceId);
    try { await saveSmsDevice(d.deviceId, body); toast.success(ok); await onChanged(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };
  return (
    <Section title="Phones" subtitle="The phones with the SMS Service app. A phone set to GGN Home only sends GGN Home login codes, not Shine One messages.">
      {devices.length === 0 ? <p className="wa-muted">No phone has checked in yet. Open the SMS Service app on the phone.</p> : (
        <ul className="wa-people">
          {devices.map((d) => (
            <li key={d.deviceId} className="wa-person">
              <div className="wa-person__main">
                <span><b>{d.name || d.deviceId}</b> <em>{d.online ? "online" : `offline · seen ${ago(d.lastSeen)}`}{d.ready === false ? " · not ready" : ""}</em></span>
                <span className="wa-muted">{d.sentToday} today · {d.sentTotal || 0} sent · {d.failedTotal || 0} failed{d.lastSentAt ? ` · last ${when(d.lastSentAt)}` : ""}{d.appVersion ? ` · app ${d.appVersion}` : ""}</span>
                {d.lastError ? <span className="wa-error">{d.lastError}</span> : null}
              </div>
              <select className="wa-input is-short" aria-label={`Service for ${d.name}`} value={d.role || "both"} disabled={busy === d.deviceId} onChange={(e) => change(d, { role: e.target.value }, "Saved.")}>
                {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <label className="wa-check"><input type="checkbox" checked={d.enabled} disabled={busy === d.deviceId} onChange={(e) => change(d, { enabled: e.target.checked }, e.target.checked ? "Phone switched on." : "Phone switched off.")} /> Sends</label>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export default function SmsSender() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [log, setLog] = useState([]);
  const [waSheets, setWaSheets] = useState([]);
  const [testPhone, setTestPhone] = useState("");
  const [testText, setTestText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, l] = await Promise.all([getSmsOverview(), getSmsLog(40).catch(() => ({ rows: [] }))]);
      setData(d); setLog(l.rows || []); setError("");
    } catch (e) { setError(errorMessage(e, "Could not load the SMS sender.")); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { getWaOverview().then((w) => setWaSheets((w.sheets || []).filter((s) => (s.texts || []).length))).catch(() => {}); }, []);
  const needsSetup = Boolean(error && !data && /Connect We Three/i.test(error));
  usePolling(load, 20000, !(error && !data));     // not while there is nothing to show yet: it only repeats the same answer

  if (needsSetup) return (
    <div className="rd-page"><Section title="SMS sender" subtitle="Sends your We Three leads as text messages through the tablet.">
      <p>Set up is not finished: the SMS sender reads its lists from your We Three account.</p>
      <p><Link className="rd-btn" to="/whatsapp">Open WhatsApp sender to connect We Three</Link></p>
      <p className="wa-muted">Come back here after the sheets show up there.</p>
    </Section></div>
  );
  if (error && !data) return <div className="rd-page"><Section title="SMS sender"><p className="wa-error">{error}</p><button type="button" className="rd-btn" onClick={load}>Try again</button></Section></div>;
  if (!data) return <div className="rd-page"><Skeleton /></div>;

  const s = data.settings || {};
  const eff = s.effective || {};
  const devices = data.devices || [];
  const shinePhones = devices.filter((d) => d.enabled && d.role !== "ggnhome");
  const online = shinePhones.filter((d) => d.online).length;
  const sentToday = shinePhones.reduce((n, d) => n + (d.sentToday || 0), 0);
  const sheets = [...(data.sheets || [])].sort((a, b) => (b.auto - a.auto) || a.sheet.localeCompare(b.sheet));
  const shown = showAll ? sheets : sheets.filter((x) => x.auto || x.texts.length || x.sent > 0);
  const toSend = sheets.filter((x) => x.auto).reduce((n, x) => n + x.remaining, 0);

  const togglePause = async () => {
    setBusy(true);
    try { await saveSmsSettings({ paused: !s.paused }); toast.success(s.paused ? "Sending is on." : "Sending is paused."); await load(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { await sendSmsTest(testPhone, testText); toast.success("Test SMS queued. A phone sends it within a minute."); setTestText(""); await load(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="rd-page wa-page">
      <header className="rd-pagehead"><h1>SMS sender</h1><p>Shine One’s text messages to the people of the We Three sheets, sent by the phones with the SMS Service app. Switch a sheet on, give it messages (one is picked at random for each person) and the phones send them inside any limits switched on below, at lunch and at night.</p></header>
      {error ? <p className="wa-error">{error}</p> : null}

      <Section title={s.paused ? "Sending is paused" : "Sending is on"} subtitle={`Lunch ${eff.lunchStart || s.lunchStart}–${eff.lunchEnd || s.lunchEnd} · night ${eff.nightStart || s.nightStart}–${eff.nightEnd || s.nightEnd} · ${(s.days || []).length === 7 ? "every day" : (s.days || []).map((d) => DAYS[d]).join(", ")}`}
        actions={<label className="wa-check"><input type="checkbox" checked={!s.paused} disabled={busy} onChange={togglePause} /> On</label>}>
        <div className="wa-stats">
          <span><b>{sentToday}</b> sent today of {eff.dailyLimit == null ? "no limit" : eff.dailyLimit * Math.max(1, shinePhones.length)}</span>
          <span><b>{online}</b> of {shinePhones.length} {shinePhones.length === 1 ? "phone" : "phones"} online</span>
          <span><b>{toSend}</b> left on the switched-on sheets</span>
        </div>
        {!shinePhones.length ? <p className="wa-muted">No phone sends Shine One messages. Set a phone to Shine One or Both below.</p> : null}
      </Section>

      <LimitsCard settings={s} onSaved={load} />

      <GgnhomeCard />

      <Section title="Test the phone" subtitle="Goes out at once (any time of day), through the same phones and the same log.">
        <div className="wa-row">
          <input className="wa-input is-short" placeholder="Number, e.g. 98100 12345" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
          <input className="wa-input" placeholder="Message (optional)" maxLength={300} value={testText} onChange={(e) => setTestText(e.target.value)} />
          <button className="rd-btn" disabled={busy || !testPhone.trim()} onClick={test}>Send a test SMS</button>
        </div>
      </Section>

      <div className="wa-row">
        <h2 className="wa-h2">We Three sheets</h2>
        <label className="wa-check"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show every sheet ({sheets.length})</label>
      </div>
      {shown.length === 0 ? <Section title="No sheet is set up yet"><p className="wa-muted">Tick “Show every sheet”, give a sheet its messages and switch Auto-send on.</p></Section> : null}
      {shown.map((x) => <SheetCard key={x.sheet} sheet={x} waSheets={waSheets} onChanged={load} />)}

      <PhonesCard devices={devices} onChanged={load} />

      <Section title="Latest messages" subtitle="What the phones were given and what they answered.">
        {log.length === 0 ? <p className="wa-muted">Nothing sent yet.</p> : (
          <div className="wa-table-wrap">
            <table className="wa-table">
              <thead><tr><th>When</th><th>To</th><th>Sheet</th><th>Result</th><th>Phone</th></tr></thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id}>
                    <td>{ago(r.sentAt || r.createdAt)}</td>
                    <td>+{String(r.phone || "").replace(/^\+/, "")}{r.kind === "test" ? " (test)" : ""}</td>
                    <td>{r.sheet || "—"}</td>
                    <td>{STATUS_LABEL[r.status] || r.status}{r.delivery ? ` · ${r.delivery}` : ""}{r.error ? ` · ${r.error}` : ""}</td>
                    <td>{r.deviceName || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
