import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  getWaLink, connectWaLink, disconnectWaLink, getWaOrigins, importWaOrigin,
  getWaOverview, saveWaSettings, resetWaSheet, sendWaReportNow, createWaSheet, saveWaSheet, deleteWaSheet, addWaPeople, retryWaSheet, sendWaTest, getWaSend, getWaPictures, getWaPicture
} from "../../api/client";
import { Section, Skeleton } from "../Render/RenderUi";
import { errorMessage } from "../Render/renderUtils";
import { ago } from "../../lib/smartHome";
import { contactsFromCsv, peopleFromLines } from "../../lib/waContacts";
import { STARTER_QUOTES, textsToBox, boxToTexts } from "../../lib/waStarter";
import "../Render/RenderDashboard.css";
import "./WhatsAppSender.css";

const MAX_IMAGE = 2 * 1024 * 1024;

function readFile(file, as) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Could not read that file."));
    as === "text" ? r.readAsText(file) : r.readAsDataURL(file);
  });
}

function Count({ label, n, tone }) {
  return <div className={"wa-count" + (tone ? " is-" + tone : "")}><b>{n}</b><span>{label}</span></div>;
}

const clock = (at) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dayWord = (at) => { const d = new Date(at), n = new Date(); return d.toDateString() === n.toDateString() ? "" : d.toDateString() === new Date(n.getTime() + 864e5).toDateString() ? " tomorrow" : " on " + d.toLocaleDateString([], { day: "numeric", month: "short" }); };
const inWhen = (at) => { const m = Math.round((new Date(at).getTime() - Date.now()) / 60000); return m <= 0 ? "any moment now" : m < 60 ? `in about ${m} min` : ""; };

/** When the next message goes out (or why it will not): for the whole sender and for each sheet. */
function NextLine({ plan, label = "Next message" }) {
  if (!plan) return null;
  if (plan.state === "blocked" && !plan.at) return <p className="wa-next is-blocked"><b>{label}:</b> none. {plan.reason}.</p>;
  const when = plan.at ? `${clock(plan.at)}${dayWord(plan.at)}${inWhen(plan.at) ? " (" + inWhen(plan.at) + ")" : ""}` : "";
  if (plan.state === "blocked") return <p className="wa-next is-blocked"><b>{label}:</b> {plan.reason}. {when && <>It will go at {when} once that is fixed.</>}</p>;
  if (plan.state === "later") return <p className="wa-next"><b>{label}:</b> after {plan.after} other sheet{plan.after === 1 ? "" : "s"} have had their turn, about {when}.{plan.reason ? " " + plan.reason + "." : ""}</p>;
  return <p className="wa-next is-next"><b>{label}:</b> {when}.{plan.reason ? " " + plan.reason + "." : ""}</p>;
}

const WHO = { server: "The server", tablet: "The tablet", whatsapp: "WhatsApp" };
const MARK = { ok: "✓", failed: "✗", skipped: "–" };

/** Every step of one message, in order; a failed one says which side stopped it (server, tablet or WhatsApp). */
function StepList({ steps, failedWhere, status }) {
  if (!steps || steps.length === 0) return <p className="wa-muted">No step details were recorded for this message (it was sent before steps were tracked).</p>;
  return (
    <ol className="wa-steps">
      {steps.map((x, i) => (
        <li key={i} className={"is-" + x.state}>
          <span className="wa-step-mark">{MARK[x.state] || "•"}</span>
          <span className="wa-step-body"><b>{x.label}</b>{x.note ? <small>{x.note}</small> : null}</span>
          <time>{x.at && x.state !== "skipped" ? new Date(x.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}</time>
        </li>
      ))}
      {status === "queued" && <li className="is-wait"><span className="wa-step-mark">…</span><span className="wa-step-body"><b>Waiting for the tablet's answer</b></span><time /></li>}
      {failedWhere && <li className="wa-step-where">Stopped by: <b>{WHO[failedWhere] || failedWhere}</b></li>}
    </ol>
  );
}

/** Pictures other sheets already hold: pick one to use on this sheet too (no need to upload it again). */
function PicturePicker({ sheetId, onPick, onClose, disabled }) {
  const [list, setList] = useState(null);
  const [thumbs, setThumbs] = useState({});
  useEffect(() => {
    let alive = true;
    getWaPictures().then((r) => {
      if (!alive) return;
      const others = (r.pictures || []).filter((p) => p.sheet !== sheetId);
      setList(others);
      others.forEach((p) => getWaPicture(p.sheet, p.index).then((x) => { if (alive) setThumbs((t) => ({ ...t, [p.sheet + ":" + p.index]: x.image })); }).catch(() => {}));
    }).catch((e) => { if (alive) { toast.error(errorMessage(e)); setList([]); } });
    return () => { alive = false; };
  }, [sheetId]);
  return (
    <div className="wa-picker">
      {list === null && <p className="wa-muted">Loading pictures…</p>}
      {list && list.length === 0 && <p className="wa-muted">No other sheet has a picture yet.</p>}
      <div className="wa-picker-grid">
        {(list || []).map((p) => {
          const key = p.sheet + ":" + p.index, src = thumbs[key];
          return (
            <button key={key} type="button" className="wa-picker-item" disabled={disabled || !src} onClick={() => onPick(p)} title={"From " + p.sheetName}>
              {src ? <img src={src} alt={"Picture from " + p.sheetName} /> : <span className="wa-muted">…</span>}
              <small>{p.sheetName}</small>
            </button>
          );
        })}
      </div>
      <button className="rd-btn is-quiet" onClick={onClose}>Close</button>
    </div>
  );
}

/** One sheet: its on/off, limit, messages, picture, people and counts. */
function SheetCard({ sheet, onChanged }) {
  const [texts, setTexts] = useState(textsToBox(sheet.texts));
  const [limit, setLimit] = useState(String(sheet.dailyLimit || 0));
  const [people, setPeople] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const [picking, setPicking] = useState(false);
  const c = sheet.counts || {};
  const total = (c.pending || 0) + (c.queued || 0) + (c.sent || 0) + (c.failed || 0) + (c.skipped || 0);

  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast.success(typeof ok === "function" ? ok(r) : ok); await onChanged(); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const saveTexts = () => run(() => saveWaSheet(sheet._id, { texts: boxToTexts(texts) }), "Messages saved.");
  const useStarter = () => {
    if (texts.trim() && !window.confirm("Replace the messages in the box with the 25 We Three quotes? Nothing is saved until you press Save messages.")) return;
    setTexts(textsToBox(STARTER_QUOTES));
  };
  const saveLimit = () => run(() => saveWaSheet(sheet._id, { dailyLimit: Number(limit) || 0 }), "Limit saved.");
  const pickImage = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast.error("Choose a PNG, JPEG or WebP picture.");
    if (f.size > MAX_IMAGE) return toast.error("That picture is over 2 MB.");
    run(async () => saveWaSheet(sheet._id, { addImage: await readFile(f, "url") }), "Picture added.");
  };
  const addPeople = () => {
    const list = peopleFromLines(people);
    if (!list.length) return toast.error("Add lines like: Ravi, 98100 12345");
    run(() => addWaPeople(sheet._id, list), (r) => `Added ${r.added}. ${r.duplicates} already there, ${r.invalid} not valid.`).then(() => setPeople(""));
  };

  return (
    <Section
      title={sheet.name}
      subtitle={`${sheet.source === "contacts" ? "Group from Google contacts" : sheet.source === "leads" ? "Lead sheet" : "Sheet"} · ${total} people · ${sheet.sentToday || 0} sent today`}
      actions={<label className="wa-switch"><input type="checkbox" checked={sheet.enabled} disabled={busy} onChange={(e) => run(() => saveWaSheet(sheet._id, { enabled: e.target.checked }))} /><span>{sheet.enabled ? "On" : "Off"}</span></label>}
    >
      <div className="wa-counts">
        <Count label="to send" n={c.pending || 0} /><Count label="on the tablet" n={c.queued || 0} />
        <Count label="sent" n={c.sent || 0} tone="ok" /><Count label="failed" n={c.failed || 0} tone="bad" /><Count label="skipped" n={c.skipped || 0} />
      </div>
      <NextLine plan={sheet.plan} label="Next message from this sheet" />
      <div className="wa-grid">
        <div>
          <label className="wa-label" htmlFor={"t" + sheet._id}>Messages. Put a line with only --- between two messages (a message can have many lines). One is picked at random for each person. Use {"{name}"} for the first name.</label>
          <textarea id={"t" + sheet._id} className="wa-input" rows={5} value={texts} onChange={(e) => setTexts(e.target.value)} placeholder={"Happy Diwali {name}!\nWishing you and your family a bright Diwali.\n---\nDiwali greetings from ..."} />
          <div className="wa-row"><button className="rd-btn" disabled={busy} onClick={saveTexts}>Save messages</button><button className="rd-btn is-quiet" disabled={busy} onClick={useStarter}>Use the 25 We Three quotes</button><span className="wa-muted">{boxToTexts(texts).length} messages</span></div>
        </div>
        <div>
          <span className="wa-label">Pictures (PNG, JPEG or WebP, up to 2 MB each, up to 5). One is picked at random for each message.</span>
          <div className="wa-picture">
            {sheet.imageCount > 0 ? <span className="wa-pill">{sheet.imageCount} picture{sheet.imageCount === 1 ? "" : "s"} saved</span> : <span className="wa-pill is-warn">No picture yet</span>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pickImage} />
            <button className="rd-btn" disabled={busy || sheet.imageCount >= 5} onClick={() => fileRef.current && fileRef.current.click()}>Add a picture</button>
            <button className="rd-btn" disabled={busy || sheet.imageCount >= 5} onClick={() => setPicking((v) => !v)}>Use a saved picture</button>
            {sheet.imageCount > 0 && <button className="rd-btn is-quiet" disabled={busy} onClick={() => { if (window.confirm("Remove all pictures from this sheet?")) run(() => saveWaSheet(sheet._id, { image: "" }), "Pictures removed."); }}>Remove all</button>}
          </div>
          {picking && <PicturePicker sheetId={sheet._id} disabled={busy} onClose={() => setPicking(false)}
            onPick={(p) => run(() => saveWaSheet(sheet._id, { copyImage: { sheet: p.sheet, index: p.index } }), "Picture added from " + p.sheetName + ".")} />}
          <label className="wa-label" htmlFor={"l" + sheet._id}>Limit for this sheet per day (0 = only the main limit)</label>
          <div className="wa-row"><input id={"l" + sheet._id} className="wa-input is-short" type="number" min="0" max="60" value={limit} onChange={(e) => setLimit(e.target.value)} /><button className="rd-btn" disabled={busy} onClick={saveLimit}>Save limit</button></div>
        </div>
      </div>
      <label className="wa-label" htmlFor={"p" + sheet._id}>Add people, one per line: Name, 98100 12345</label>
      <textarea id={"p" + sheet._id} className="wa-input" rows={3} value={people} onChange={(e) => setPeople(e.target.value)} />
      <div className="wa-row">
        <button className="rd-btn" disabled={busy || !people.trim()} onClick={addPeople}>Add people</button>
        {c.failed > 0 && <button className="rd-btn" disabled={busy} onClick={() => run(() => retryWaSheet(sheet._id), (r) => `${r.requeued} back in line.`)}>Retry the {c.failed} failed</button>}
        <button className="rd-btn is-quiet" disabled={busy} title="For testing: everyone on this sheet goes back in line, so the same test number can be messaged again" onClick={() => { if (window.confirm(`Put everyone on "${sheet.name}" back in line? Use this only for a test sheet.`)) run(() => resetWaSheet(sheet._id), (r) => `${r.reset} people back in line.`); }}>Reset for testing</button>
        <button className="rd-btn is-danger" disabled={busy} onClick={() => { if (window.confirm(`Delete "${sheet.name}" and its ${total} people? Messages already sent stay in the log.`)) run(() => deleteWaSheet(sheet._id), "Sheet deleted."); }}>Delete sheet</button>
      </div>
    </Section>
  );
}

/** The We Three account: type the mobile number and MPIN once, then bring any We Three sheet in as a Stashr sheet. */
function ThreeLink({ onChanged }) {
  const [link, setLink] = useState(null);
  const [mobile, setMobile] = useState("");
  const [mpin, setMpin] = useState("");
  const [origins, setOrigins] = useState(null);
  const [busy, setBusy] = useState("");

  const loadLink = useCallback(async () => { try { setLink(await getWaLink()); } catch (e) { setLink({ connected: false }); } }, []);
  useEffect(() => { loadLink(); }, [loadLink]);
  const loadOrigins = useCallback(async () => {
    setBusy("origins");
    try { setOrigins((await getWaOrigins()).origins); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  }, []);
  useEffect(() => { if (link && link.connected) loadOrigins(); }, [link, loadOrigins]);

  const connect = async () => {
    setBusy("connect");
    try { const r = await connectWaLink(mobile, mpin); setMpin(""); toast.success(`Connected as ${r.name || r.mobile}.`); await loadLink(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };
  const importOne = async (name) => {
    setBusy("import:" + name);
    try {
      const r = await importWaOrigin(name);
      toast.success(`"${name}": ${r.added} people added. ${r.alreadySent} already messaged, ${r.invalid} without a valid number.`);
      await onChanged(); await loadOrigins();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(""); }
  };

  if (!link) return <Section title="We Three sheets"><Skeleton /></Section>;
  return (
    <Section title="We Three sheets" subtitle="Bring the lead sheets from the We Three app (Calling data, OLF Data and so on) in as sheets here. Each message that goes out is marked on the lead in We Three too.">
      {!link.connected ? (
        <div className="wa-row">
          <input className="wa-input is-short" inputMode="numeric" placeholder="We Three mobile" value={mobile} maxLength={14} onChange={(e) => setMobile(e.target.value)} aria-label="We Three mobile number" />
          <input className="wa-input is-short" type="password" inputMode="numeric" autoComplete="off" placeholder="MPIN" value={mpin} maxLength={6} onChange={(e) => setMpin(e.target.value)} aria-label="We Three MPIN" />
          <button className="rd-btn is-primary" disabled={busy === "connect" || mobile.replace(/\D/g, "").length < 10 || mpin.length < 4} onClick={connect}>Connect We Three</button>
          <span className="wa-muted">Stashr keeps only a sealed sign-in, never the MPIN.</span>
        </div>
      ) : (
        <>
          <div className="wa-row"><span className="wa-pill">Connected as {link.name || link.mobile}</span><button className="rd-btn is-quiet" disabled={busy !== ""} onClick={loadOrigins}>Refresh</button><button className="rd-btn is-quiet" onClick={async () => { if (window.confirm("Disconnect We Three? Sheets already imported stay.")) { await disconnectWaLink(); setOrigins(null); await loadLink(); } }}>Disconnect</button></div>
          {!origins ? <Skeleton /> : (
            <table className="wa-table"><thead><tr><th>Sheet</th><th>Leads</th><th>Messaged</th><th /></tr></thead><tbody>
              {origins.map((o) => (
                <tr key={o.name}><td>{o.name}</td><td>{o.count}</td><td>{o.sent}</td><td><button className="rd-btn" disabled={busy !== ""} onClick={() => importOne(o.name)}>{busy === "import:" + o.name ? "Importing..." : "Import unsent leads"}</button></td></tr>
              ))}
            </tbody></table>
          )}
        </>
      )}
    </Section>
  );
}

/** Google Contacts export (CSV) in, the people to keep ticked, a new group out. */
function ContactsGroup({ onChanged }) {
  const [name, setName] = useState("");
  const [rows, setRows] = useState([]);
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const list = contactsFromCsv(await readFile(f, "text"));
      if (!list.length) return toast.error("No phone numbers found. Export from Google Contacts as Google CSV.");
      setRows(list);
      setPicked(Object.fromEntries(list.map((r) => [r.phone, true])));
      if (!name) setName(f.name.replace(/\.csv$/i, "").slice(0, 60));
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const chosen = rows.filter((r) => picked[r.phone]);
  const create = async () => {
    if (!name.trim()) return toast.error("Give the group a name.");
    if (!chosen.length) return toast.error("Tick at least one person.");
    setBusy(true);
    try {
      const made = await createWaSheet({ name: name.trim(), source: "contacts" });
      const r = await addWaPeople(made.id, chosen);
      toast.success(`Group created with ${r.added} people. Now add its messages and picture.`);
      setRows([]); setPicked({}); setName("");
      await onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <Section title="Group from Google contacts" subtitle="Export your contacts from Google Contacts as CSV, pick the people, and they become their own sheet.">
      <div className="wa-row">
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={load} />
        <button className="rd-btn" onClick={() => fileRef.current && fileRef.current.click()}>Choose the contacts file</button>
        {rows.length > 0 && <>
          <button className="rd-btn is-quiet" onClick={() => setPicked(Object.fromEntries(rows.map((r) => [r.phone, true])))}>Tick all</button>
          <button className="rd-btn is-quiet" onClick={() => setPicked({})}>Untick all</button>
          <span className="wa-muted">{chosen.length} of {rows.length} ticked</span>
        </>}
      </div>
      {rows.length > 0 && <>
        <div className="wa-contacts" role="group" aria-label="Contacts">
          {rows.map((r) => (
            <label key={r.phone} className="wa-contact"><input type="checkbox" checked={Boolean(picked[r.phone])} onChange={(e) => setPicked({ ...picked, [r.phone]: e.target.checked })} /><span>{r.name || "No name"}</span><em>+{r.phone}</em></label>
          ))}
        </div>
        <div className="wa-row">
          <input className="wa-input is-short" placeholder="Group name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <button className="rd-btn is-primary" disabled={busy} onClick={create}>Create group with {chosen.length} people</button>
        </div>
      </>}
    </Section>
  );
}

export default function WhatsAppSender() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(null);
  const [newName, setNewName] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testSheet, setTestSheet] = useState("");
  const [reportNums, setReportNums] = useState(null);
  const [testNote, setTestNote] = useState("");
  const [openRow, setOpenRow] = useState("");
  const editing = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await getWaOverview();
      setData(d); setError("");
      if (!editing.current) setSettings((cur) => cur || { dailyLimit: d.settings.dailyLimit, from: d.settings.from, to: d.settings.to, gapMin: d.settings.gapMin, gapMax: d.settings.gapMax });
    } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const set = async (body, ok) => {
    try { await saveWaSettings(body); if (ok) toast.success(ok); await load(); } catch (e) { toast.error(errorMessage(e)); }
  };

  const watchTest = async (id) => {
    setTestNote("Sent to the tablet. Waiting for WhatsApp...");
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const s = await getWaSend(id);
        if (s.status === "sent") { setTestNote(`Sent to +${s.phone}.`); load(); return; }
        if (s.status === "failed") { setTestNote(`Failed: ${s.result || "no reason given"}`); load(); return; }
      } catch (e) { /* keep waiting */ }
    }
    setTestNote("Still waiting for the tablet. Check the log below.");
  };
  const test = async (body) => {
    try { const r = await sendWaTest(body); watchTest(r.id); load(); } catch (e) { toast.error(errorMessage(e)); setTestNote(""); }
  };

  if (error && !data) return <div className="rd-page"><Section title="WhatsApp sender"><p className="wa-error">{error}</p></Section></div>;
  if (!data || !settings) return <div className="rd-page"><Skeleton /></div>;
  const s = data.settings;
  const dirty = ["dailyLimit", "from", "to", "gapMin", "gapMax"].some((k) => String(settings[k]) !== String(s[k]));
  const savedNums = (s.reportNumbers || ["918130483894", "919310994032"]).map((n) => "+" + n).join(", ");
  const nums = reportNums === null ? savedNums : reportNums;

  return (
    <div className="rd-page wa-page">
      <header className="rd-pagehead"><h1>WhatsApp sender</h1><p>This page is the only place that starts or stops sending. Turn sending on, switch on the sheets you want, and messages go out from the tablet through WhatsApp Business, one at a time, inside the limits below.</p></header>

      <Section
        title={s.enabled ? "Sending is on" : "Sending is off"}
        subtitle={s.status || (s.enabled ? "Waiting for the next turn" : "Nothing will be sent")}
        actions={<label className="wa-switch is-big"><input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked }, e.target.checked ? "Sending is on." : "Sending is off.")} /><span>{s.enabled ? "On" : "Off"}</span></label>}
      >
        <div className="wa-counts">
          <Count label={`sent today of ${s.dailyLimit}`} n={data.sentToday} tone="ok" />
          <Count label="tablet" n={data.tablet ? "online" : "offline"} tone={data.tablet ? "ok" : "bad"} />
        </div>
        {!data.tablet && <p className="wa-error">The tablet is offline, so nothing can be sent. Check that Stashr Hub is open, on charge and on Wi-Fi.</p>}
        <NextLine plan={data.next} label={data.next && data.next.sheet ? "Next message (from " + ((data.sheets.find((x) => x._id === data.next.sheet) || {}).name || "a sheet") + ")" : "Next message"} />
        {s.testMode && <p className="wa-warn">Test mode is on: the time window, the gap and the daily limit are ignored. Turn it off before real sending.</p>}
      </Section>

      <Section title="Limits" subtitle="The daily limit is spread over the sending window with a random gap each time.">
        <div className="wa-form">
          <label>Messages a day<input className="wa-input" type="number" min="0" max="60" value={settings.dailyLimit} onFocus={() => { editing.current = true; }} onChange={(e) => setSettings({ ...settings, dailyLimit: e.target.value })} /></label>
          <label>From<input className="wa-input" type="time" value={settings.from} onChange={(e) => setSettings({ ...settings, from: e.target.value })} /></label>
          <label>To<input className="wa-input" type="time" value={settings.to} onChange={(e) => setSettings({ ...settings, to: e.target.value })} /></label>
          <label>Shortest gap (min)<input className="wa-input" type="number" min="1" max="120" value={settings.gapMin} onChange={(e) => setSettings({ ...settings, gapMin: e.target.value })} /></label>
          <label>Longest gap (min)<input className="wa-input" type="number" min="1" max="240" value={settings.gapMax} onChange={(e) => setSettings({ ...settings, gapMax: e.target.value })} /></label>
        </div>
        <div className="wa-row">
          <button className="rd-btn is-primary" disabled={!dirty} onClick={async () => { await set({ dailyLimit: Number(settings.dailyLimit), from: settings.from, to: settings.to, gapMin: Number(settings.gapMin), gapMax: Number(settings.gapMax) }, "Limits saved."); editing.current = false; }}>Save limits</button>
          <label className="wa-switch"><input type="checkbox" checked={s.testMode} onChange={(e) => set({ testMode: e.target.checked })} /><span>Test mode (ignores the limits)</span></label>
        </div>
      </Section>

      <Section title="Nightly report" subtitle="When the day's sending is done (the daily limit is reached, nobody is left, or the window has ended), these numbers get a WhatsApp report: how many were sent, how many were not, and why.">
        <div className="wa-row">
          <label className="wa-switch"><input type="checkbox" checked={s.reportEnabled !== false} onChange={(e) => set({ reportEnabled: e.target.checked }, e.target.checked ? "Nightly report is on." : "Nightly report is off.")} /><span>{s.reportEnabled !== false ? "On" : "Off"}</span></label>
          <input className="wa-input" aria-label="Numbers for the report" value={nums} onChange={(e) => setReportNums(e.target.value)} placeholder="Numbers, separated by commas" />
          <button className="rd-btn is-primary" disabled={reportNums === null || reportNums === savedNums} onClick={async () => { await set({ reportNumbers: reportNums }, "Report numbers saved."); setReportNums(null); }}>Save numbers</button>
          <button className="rd-btn" disabled={!data.tablet} title="Sends today's report to every number now" onClick={async () => { try { await sendWaReportNow(); toast.success("The report goes out within a minute."); } catch (e) { toast.error(errorMessage(e)); } }}>Send the report now</button>
        </div>
      </Section>

      <Section title="Test the full flow" subtitle="Sends through the same path as a real message: the server queues it, the tablet sends it, the answer comes back here.">
        <div className="wa-row">
          <input className="wa-input" placeholder="Number, e.g. 98100 12345" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
          <button className="rd-btn is-primary" disabled={!testPhone.trim() || !data.tablet} onClick={() => test({ phone: testPhone, ...(testSheet ? { sheetId: testSheet } : {}) })}>Send a test to this number</button>
          <select className="wa-input is-short" value={testSheet} onChange={(e) => setTestSheet(e.target.value)} aria-label="Use this sheet's messages and pictures">
            <option value="">Plain test text</option>
            {data.sheets.map((sh) => <option key={sh._id} value={sh._id}>Use "{sh.name}" messages and pictures</option>)}
          </select>
          <button className="rd-btn" disabled={!data.tablet} onClick={() => { if (window.confirm("This sends one real message to the next person on your sheets, now. Continue?")) test({}); }}>Send to the next person now</button>
        </div>
        {testNote && <p className="wa-note" role="status">{testNote}</p>}
      </Section>

      {data.sheets.length === 0 && <Section title="No sheets yet"><p className="wa-muted">Make a sheet below, add its messages, a picture and the people to message.</p></Section>}
      {data.sheets.map((sh) => <SheetCard key={sh._id} sheet={sh} onChanged={load} />)}

      <Section title="New sheet">
        <div className="wa-row">
          <input className="wa-input" placeholder="Sheet name" value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
          <button className="rd-btn is-primary" disabled={!newName.trim()} onClick={async () => { try { await createWaSheet({ name: newName.trim() }); setNewName(""); toast.success("Sheet created."); await load(); } catch (e) { toast.error(errorMessage(e)); } }}>Create sheet</button>
        </div>
      </Section>

      <ThreeLink onChanged={load} />
      <ContactsGroup onChanged={load} />

      <Section title="Latest messages" subtitle="Every message the server handed to the tablet, and what the tablet answered.">
        {data.recent.length === 0 ? <p className="wa-muted">Nothing yet.</p> : (
          <table className="wa-table"><thead><tr><th>When</th><th>To</th><th>Result</th><th /></tr></thead><tbody>
            {data.recent.map((r) => (
              <React.Fragment key={r.id}>
                <tr><td>{ago(r.at)}</td><td>{r.name || "+" + r.phone}{r.kind === "test" ? " (test)" : r.kind === "report" ? " (report)" : ""}</td>
                  <td className={"wa-status is-" + r.status}>{r.status === "sent" ? "Sent" : r.status === "failed" ? "Failed" + (r.failedWhere ? " at " + (WHO[r.failedWhere] || r.failedWhere).toLowerCase() : "") + ": " + (r.result || "") : "On the tablet..."}</td>
                  <td><button className="rd-btn is-quiet" onClick={() => setOpenRow(openRow === r.id ? "" : r.id)}>{openRow === r.id ? "Hide steps" : "Steps"}</button></td></tr>
                {openRow === r.id && <tr className="wa-steps-row"><td colSpan={4}><StepList steps={r.steps} failedWhere={r.failedWhere} status={r.status} /></td></tr>}
              </React.Fragment>
            ))}
          </tbody></table>
        )}
      </Section>
    </div>
  );
}
