import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  getWaLink, connectWaLink, disconnectWaLink, getWaOrigins, importWaOrigin,
  getWaOverview, saveWaSettings, shuffleWaRestDays, resetWaSheet, sendWaReportNow, createWaSheet, saveWaSheet, deleteWaSheet, addWaPeople, addWaPeopleInBatches, getWaPeople, editWaPerson, sendWaSheetToWeThree, retryWaSheet, sendWaTest, getWaSend, getWaPictures, getWaPicture
} from "../../api/client";
import { Section, Skeleton } from "../Render/RenderUi";
import { errorMessage } from "../Render/renderUtils";
import { ago } from "../../lib/smartHome";
import { contactsFromFile, filterContacts, peopleFromLines, peopleFromRows, planSheets } from "../../lib/waContacts";
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

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The rest days: this week and next week with the days off marked, today's own plan, and how many rest days a week. */
function RestDays({ rhythm, testMode, onChanged }) {
  const [busy, setBusy] = useState(false);
  if (!rhythm) return null;
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await onChanged(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const t = rhythm.today;
  const todayText = rhythm.rest ? `rest day, nothing goes out. Sending again ${rhythm.nextSendLabel}.`
    : t.limit > 0 ? `${plural(t.target, "message")} (a random number, the limit is ${t.limit}), starting at ${t.start} and stopping by ${t.end}.`
    : "the daily limit is 0, so nothing goes out.";
  return (
    <Section
      title="Rest days"
      subtitle={rhythm.perWeek > 0
        ? `Each week ${plural(rhythm.perWeek, "day")} ${rhythm.perWeek === 1 ? "is" : "are"} picked at random when nothing goes out. They change every week and never fall on the same weekdays as the week before, so there is no pattern.`
        : "Off: messages go out every day."}
    >
      {rhythm.weeks.map((w, i) => (
        <div key={w.week} className="wa-week">
          <span className="wa-week__name">{i === 0 ? "This week" : "Next week"}</span>
          <ol className="wa-days" aria-label={i === 0 ? "This week" : "Next week"}>
            {w.days.map((d) => {
              const [name, num] = d.label.split(" ");
              return (
                <li key={d.date} className={"wa-day" + (d.rest ? " is-rest" : "") + (d.today ? " is-today" : "") + (d.past ? " is-past" : "")}
                  title={`${d.label}${d.today ? " (today)" : ""}: ${d.rest ? "rest day, nothing goes out" : "messages go out"}`}>
                  <span>{name}</span><b>{num}</b><small>{d.rest ? "Off" : "Sends"}</small>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      <p className={"wa-next" + (rhythm.rest ? " is-blocked" : "")}><b>Today:</b> {todayText}</p>
      {testMode && <p className="wa-warn">Test mode is on, so the rest days are ignored.</p>}
      <div className="wa-row">
        <label className="wa-inline">Rest days a week
          <select className="wa-input is-short" value={rhythm.perWeek} disabled={busy} onChange={(e) => run(() => saveWaSettings({ restDaysPerWeek: Number(e.target.value) }), "Rest days saved.")}>
            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n === 0 ? "None" : n}</option>)}
          </select>
        </label>
        <button className="rd-btn" disabled={busy || rhythm.perWeek === 0} title="New random rest days for the rest of this week and for next week (days that are over stay as they were)" onClick={() => run(shuffleWaRestDays, "New rest days picked.")}>Pick other days</button>
      </div>
    </Section>
  );
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
/** The people found in a contacts file: a search box, tick all / untick all for what the search shows, and one tick per person. */
function ContactsList({ rows, picked, setPicked }) {
  const [q, setQ] = useState("");
  const shown = filterContacts(rows, q);
  const ticked = rows.filter((r) => picked[r.phone]).length;
  return (
    <>
      <div className="wa-row">
        <input className="wa-input" type="search" placeholder="Search name or number" aria-label="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="rd-btn is-quiet" onClick={() => setPicked({ ...picked, ...Object.fromEntries(shown.map((r) => [r.phone, true])) })}>Tick {q.trim() ? "these" : "all"}</button>
        <button className="rd-btn is-quiet" onClick={() => setPicked(q.trim() ? { ...picked, ...Object.fromEntries(shown.map((r) => [r.phone, false])) } : {})}>Untick {q.trim() ? "these" : "all"}</button>
        <span className="wa-muted">{ticked} of {rows.length} ticked{q.trim() ? ` · ${shown.length} shown` : ""}</span>
      </div>
      <div className="wa-contacts" role="group" aria-label="Contacts">
        {shown.length === 0 ? <p className="wa-muted" style={{ padding: "8px 10px" }}>Nobody matches “{q}”.</p> : null}
        {shown.map((r) => (
          <label key={r.phone} className="wa-contact"><input type="checkbox" checked={Boolean(picked[r.phone])} onChange={(e) => setPicked({ ...picked, [r.phone]: e.target.checked })} /><span>{r.name || "No name"}</span><em>+{r.phone}</em></label>
        ))}
      </div>
    </>
  );
}

const STAGE_LABEL = { none: "No stage yet" };
const dateShort = (v) => (v ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const SEND_LABEL = { pending: "Not sent", queued: "Sending", sent: "Sent", failed: "Failed", skipped: "Skipped" };

/** The people of one sheet: the stage each has in We Three (as in the Tasks app), a search, one stage at a time, paging, and editing of the name and number. */
function PeopleView({ sheet, onChanged }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState(null);                     // { id, name, phone }
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bump, setBump] = useState(0);                        // changes to reload
  const fresh = useRef(false);                                // Refresh: read the stages from We Three again, not from the one-minute cache

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try { const d = await getWaPeople(sheet._id, { q: q.trim() || undefined, stage: stage || undefined, page, limit: 50, refresh: fresh.current ? 1 : undefined }); fresh.current = false; if (live) setData(d); }
      catch (e) { if (live) toast.error(errorMessage(e)); }
      finally { if (live) setLoading(false); }
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [sheet._id, q, stage, page, bump]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const save = async () => {
    setBusy(true);
    try {
      const r = await editWaPerson(sheet._id, edit.id, { name: edit.name, phone: edit.phone });
      toast.success(r.changed ? (r.weThree === false ? "Saved here. We Three could not be reached, so the lead there still has the old details." : r.weThree ? "Saved here and in We Three." : "Saved.") : "Nothing changed.");
      setEdit(null); setBump((n) => n + 1); await onChanged();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="wa-edit" role="group" aria-label={`People in ${sheet.name}`}>
      <div className="wa-row">
        <input className="wa-input" type="search" placeholder="Search name or number" aria-label="Search this sheet" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <button className="rd-btn is-quiet" disabled={loading} title="Read the stages from We Three again" onClick={() => { fresh.current = true; setBump((n) => n + 1); }}>Refresh</button>
        <span className="wa-muted">{data ? `${data.total} of ${data.all} people` : "Loading…"}</span>
      </div>
      {data && data.stageError ? <p className="wa-muted">Could not read the stages from We Three: {data.stageError}</p> : null}
      {data && data.weThree ? (
        <div className="wa-chips" role="group" aria-label="Stage">
          <button className={"wa-chip" + (!stage ? " is-on" : "")} onClick={() => { setStage(""); setPage(1); }}>All <b>{data.all}</b></button>
          {data.stages.map((st) => <button key={st.name} className={"wa-chip" + (stage === st.name ? " is-on" : "")} onClick={() => { setStage(st.name); setPage(1); }}>{st.name} <b>{st.count}</b></button>)}
          {data.noStage > 0 && <button className={"wa-chip" + (stage === "none" ? " is-on" : "")} onClick={() => { setStage("none"); setPage(1); }}>{STAGE_LABEL.none} <b>{data.noStage}</b></button>}
          {data.unlinked > 0 && <button className={"wa-chip" + (stage === "unlinked" ? " is-on" : "")} title="Not matched to a We Three lead yet" onClick={() => { setStage("unlinked"); setPage(1); }}>Not in We Three <b>{data.unlinked}</b></button>}
        </div>
      ) : data ? <p className="wa-muted">This sheet is only in Stashr, so there are no stages. Use “Send to We Three” to see them here.</p> : null}
      <ul className="wa-people">
        {(data ? data.people : []).map((p) => (
          <li key={p.id} className="wa-person">
            {edit && edit.id === p.id ? (
              <div className="wa-row">
                <input className="wa-input" aria-label="Name" placeholder="Name" value={edit.name} maxLength={120} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                <input className="wa-input is-short" aria-label="Number" placeholder="Number" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
                <button className="rd-btn is-primary" disabled={busy} onClick={save}>Save</button>
                <button className="rd-btn is-quiet" disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
              </div>
            ) : (
              <>
                <div className="wa-person__main">
                  <span><b>{p.name || "No name"}</b> <em>+{p.phone}</em></span>
                  <span className="wa-muted">
                    {SEND_LABEL[p.status] || p.status}{p.sentAt ? ` ${dateShort(p.sentAt)}` : ""}{p.error ? ` · ${p.error}` : ""}
                    {p.linked && p.stage !== null ? ` · We Three: ${p.stage || "no stage yet"}${p.updatedBy ? ` (by ${p.updatedBy}${p.stageAt ? ", " + dateShort(p.stageAt) : ""})` : ""}` : ""}
                    {p.weThreeSentAt ? ` · sent there ${dateShort(p.weThreeSentAt)}` : ""}
                  </span>
                  {p.notes ? <span className="wa-muted">Notes: {p.notes}</span> : null}
                </div>
                {p.linked && p.stage !== null ? <span className={"wa-stage" + (p.stage ? "" : " is-none")}>{p.stage || "No stage"}</span> : null}
                <button className="rd-btn is-quiet" disabled={busy || p.status === "queued"} onClick={() => setEdit({ id: p.id, name: p.name || "", phone: p.phone })}>Edit</button>
              </>
            )}
          </li>
        ))}
        {data && data.people.length === 0 ? <li className="wa-muted">Nobody matches.</li> : null}
      </ul>
      {data && pages > 1 ? (
        <div className="wa-row">
          <button className="rd-btn is-quiet" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="wa-muted">Page {page} of {pages}</span>
          <button className="rd-btn is-quiet" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      ) : null}
    </div>
  );
}

function SheetCard({ sheet, onChanged }) {
  const [texts, setTexts] = useState(textsToBox(sheet.texts));
  const [limit, setLimit] = useState(String(sheet.dailyLimit || 0));
  const [people, setPeople] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const contactsRef = useRef(null);
  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState(false);          // "View people": the list with stages, search and editing
  const [editing, setEditing] = useState(false);          // the "Edit sheet" panel: add numbers by typing or from a contacts file
  const [found, setFound] = useState([]);
  const [foundPicked, setFoundPicked] = useState({});
  const c = sheet.counts || {};
  const savedCount = (sheet.texts || []).length;
  const unsaved = JSON.stringify(boxToTexts(texts)) !== JSON.stringify(sheet.texts || []);
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
  const loadContacts = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const list = contactsFromFile(await readFile(f, "text"), f.name);
      if (!list.length) return toast.error("No phone numbers found. Use a Google Contacts CSV or vCard (.vcf) file.");
      setFound(list); setFoundPicked(Object.fromEntries(list.map((r) => [r.phone, true])));
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const addFound = () => {
    const chosen = found.filter((r) => foundPicked[r.phone]);
    if (!chosen.length) return toast.error("Tick at least one person.");
    run(() => addWaPeopleInBatches(sheet._id, chosen), (r) => `Added ${r.added}. ${r.duplicates} already there, ${r.invalid} not valid.`).then(() => { setFound([]); setFoundPicked({}); });
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
          <div className="wa-row"><button className="rd-btn" disabled={busy} onClick={saveTexts}>Save messages</button><button className="rd-btn is-quiet" disabled={busy} onClick={useStarter}>Use the 25 We Three quotes</button><span className="wa-muted">{boxToTexts(texts).length} in the box</span></div>
          {unsaved
            ? <p className="wa-warn">Not saved yet: the box has {boxToTexts(texts).length} message{boxToTexts(texts).length === 1 ? "" : "s"}, but {savedCount} {savedCount === 1 ? "is" : "are"} saved on the server. Press <b>Save messages</b>, or they are lost when you refresh the page.</p>
            : savedCount > 0
              ? <p className="wa-muted">Saved: {savedCount} message{savedCount === 1 ? "" : "s"}. Every new lead from this sheet gets one of them, picked at random.</p>
              : <p className="wa-error">No message is saved for this sheet{sheet.imageCount > 0 ? ", so leads get only the picture" : " and it has no picture, so nothing can be sent"}. Type or add messages above and press Save messages.</p>}
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
      {viewing && <PeopleView sheet={sheet} onChanged={onChanged} />}
      {editing && (
        <div className="wa-edit" role="group" aria-label={`Edit ${sheet.name}`}>
          <label className="wa-label" htmlFor={"p" + sheet._id}>Add new numbers, one per line: Name, 98100 12345</label>
          <textarea id={"p" + sheet._id} className="wa-input" rows={3} value={people} onChange={(e) => setPeople(e.target.value)} />
          <div className="wa-row">
            <button className="rd-btn" disabled={busy || !people.trim()} onClick={addPeople}>Add these numbers</button>
            <input ref={contactsRef} type="file" accept=".csv,.vcf,.vcard,text/csv,text/vcard,text/x-vcard" hidden onChange={loadContacts} />
            <button className="rd-btn is-quiet" disabled={busy} onClick={() => contactsRef.current && contactsRef.current.click()}>Add from a contacts file (CSV or .vcf)</button>
          </div>
          {found.length > 0 && <>
            <ContactsList rows={found} picked={foundPicked} setPicked={setFoundPicked} />
            <div className="wa-row"><button className="rd-btn is-primary" disabled={busy} onClick={addFound}>Add {found.filter((r) => foundPicked[r.phone]).length} people to this sheet</button></div>
          </>}
        </div>
      )}
      <div className="wa-row">
        {sheet.weThree ? <span className="wa-muted" title="People and sent marks are kept the same in We Three">Synced with We Three</span>
          : <button className="rd-btn is-quiet" disabled={busy} title="Makes this sheet a list in We Three and keeps the two the same" onClick={() => run(() => sendWaSheetToWeThree(sheet._id), (r) => `Sent to We Three: ${r.added} new, ${r.existing} already there, ${r.linked} linked.`)}>Send to We Three</button>}
        <button className="rd-btn" aria-expanded={viewing} onClick={() => setViewing((v) => !v)}>{viewing ? "Hide people" : "View people"}</button>
        <button className="rd-btn" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>{editing ? "Close editor" : "Edit sheet"}</button>
        {c.failed > 0 && <button className="rd-btn" disabled={busy} onClick={() => run(() => retryWaSheet(sheet._id), (r) => `${r.requeued} back in line.`)}>Retry the {c.failed} failed</button>}
        <button className="rd-btn is-quiet" disabled={busy} title="For testing: everyone on this sheet goes back in line, so the same test number can be messaged again" onClick={() => { if (window.confirm(`Put everyone on "${sheet.name}" back in line? Use this only for a test sheet.`)) run(() => resetWaSheet(sheet._id), (r) => `${r.reset} people back in line.`); }}>Reset for testing</button>
        <button className="rd-btn is-danger" disabled={busy} onClick={() => { if (window.confirm(`Delete "${sheet.name}" and its ${total} people? Messages already sent stay in the log.`)) run(() => deleteWaSheet(sheet._id), "Sheet deleted."); }}>Delete sheet</button>
        {sheet.weThree ? <button className="rd-btn is-danger" disabled={busy} title="Deletes the sheet here AND its leads in We Three (their stages and notes there are lost)" onClick={() => {
          const typed = window.prompt(`This deletes "${sheet.name}" here and ${total} leads in We Three, with their stages and notes. It cannot be undone.\n\nType the sheet name to confirm:`);
          if (typed === null) return;
          if (typed.trim() !== sheet.name) return toast.error("The name did not match. Nothing was deleted.");
          run(() => deleteWaSheet(sheet._id, { alsoWeThree: true }), (r) => `Sheet deleted. ${r && r.weThree ? r.weThree.queued : 0} leads are being removed from We Three.`);
        }}>Delete here and in We Three</button> : null}
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

/** Google Contacts export (CSV or vCard) in, the people to keep ticked, a new group out. */
function ContactsGroup({ onChanged }) {
  const connected = useWeThreeLink();
  const [alsoThree, setAlsoThree] = useState(true);
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
      const list = contactsFromFile(await readFile(f, "text"), f.name);
      if (!list.length) return toast.error("No phone numbers found. Export from Google Contacts as Google CSV or vCard (.vcf).");
      setRows(list);
      setPicked(Object.fromEntries(list.map((r) => [r.phone, true])));
      if (!name) setName(f.name.replace(/\.(csv|vcf|vcard)$/i, "").slice(0, 60));
    } catch (err) { toast.error(errorMessage(err)); }
  };
  const chosen = rows.filter((r) => picked[r.phone]);
  const create = async () => {
    if (!name.trim()) return toast.error("Give the group a name.");
    if (!chosen.length) return toast.error("Tick at least one person.");
    setBusy(true);
    try {
      const made = await createWaSheet({ name: name.trim(), source: "contacts", weThree: connected && alsoThree });
      let r;
      try { r = await addWaPeopleInBatches(made.id, chosen); }
      catch (err) { try { await deleteWaSheet(made.id); } catch { /* nothing more to do */ } throw err; }    // no empty group is left behind
      toast.success(`Group created with ${r.added} people.${r.weThree ? " Also in We Three." : ""} Now add its messages and picture.`);
      setRows([]); setPicked({}); setName("");
      await onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <Section title="Group from Google contacts" subtitle="Export your contacts from Google Contacts as CSV or vCard (.vcf), pick the people, and they become their own sheet.">
      <div className="wa-row">
        <input ref={fileRef} type="file" accept=".csv,.vcf,.vcard,text/csv,text/vcard,text/x-vcard" hidden onChange={load} />
        <button className="rd-btn" onClick={() => fileRef.current && fileRef.current.click()}>Choose the contacts file</button>
      </div>
      {rows.length > 0 && <>
        <ContactsList rows={rows} picked={picked} setPicked={setPicked} />
        <div className="wa-row">
          <input className="wa-input is-short" placeholder="Group name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <button className="rd-btn is-primary" disabled={busy} onClick={create}>Create group with {chosen.length} people</button>
        </div>
        {connected ? <label className="wa-check"><input type="checkbox" checked={alsoThree} onChange={(e) => setAlsoThree(e.target.checked)} /> Also create it in We Three</label> : null}
      </>}
    </Section>
  );
}

/** "Also keep it in We Three": shown only when We Three is connected. The sheet's name becomes a list there and the two stay the same. */
function useWeThreeLink() {
  const [connected, setConnected] = useState(false);
  useEffect(() => { let live = true; getWaLink().then((l) => { if (live) setConnected(Boolean(l && l.connected)); }).catch(() => {}); return () => { live = false; }; }, []);
  return connected;
}
const weThreeNote = (r) => (r && r.weThree ? ` Also in We Three${r.weThree.notLinked ? ` (${r.weThree.notLinked} numbers were already there under another list)` : ""}.` : r && r.weThreeError ? ` Could not reach We Three: ${r.weThreeError}` : "");

/** A new sheet: by name, or from an Excel file where each tab can become a sheet (or several) with names you choose. */
function NewSheet({ existing, onChanged }) {
  const connected = useWeThreeLink();
  const [name, setName] = useState("");
  const [alsoThree, setAlsoThree] = useState(true);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState("");
  const [progress, setProgress] = useState("");
  const [tabs, setTabs] = useState([]);                       // [{ tab, include, name, parts, people }]
  const fileRef = useRef(null);
  const taken = new Set(existing.map((x) => x.name.toLowerCase()));
  const oldOf = (n) => existing.find((x) => x.name.toLowerCase() === String(n || "").trim().toLowerCase());
  /** Removes an old sheet (after asking) so its name can be used again. Its messages and people are deleted; We Three keeps its leads. */
  const removeOld = async (n) => {
    const old = oldOf(n);
    if (!old) return;
    if (!window.confirm(`Delete the old sheet "${old.name}" and its ${old.total} people? Messages already sent stay in the log. Leads in We Three are not deleted.`)) return;
    setBusy(true);
    try { await deleteWaSheet(old.id); toast.success(`Old sheet "${old.name}" deleted.`); await onChanged(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const plan = planSheets(tabs, taken);
  const clash = plan.some((p) => p.clash);

  const createOne = async () => {
    setBusy(true);
    try { const r = await createWaSheet({ name: name.trim(), weThree: connected && alsoThree }); setName(""); toast.success("Sheet created." + weThreeNote(r)); await onChanged(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const pickExcel = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array" });
      const found = wb.SheetNames.map((tab) => ({ tab, include: true, name: tab.slice(0, 80), parts: 1, people: peopleFromRows(XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: "", raw: false })) }));
      if (!found.some((t) => t.people.length)) return toast.error("No phone numbers found in that file. Each tab needs a column with mobile numbers.");
      setFile(f.name); setTabs(found.map((t) => ({ ...t, include: t.people.length > 0 })));
    } catch (err) { toast.error("We could not read that Excel file."); }
  };
  const setTab = (i, patch) => setTabs((cur) => cur.map((t, k) => (k === i ? { ...t, ...patch } : t)));

  const createFromExcel = async () => {
    setBusy(true);
    let made = 0, people = 0, three = 0;
    try {
      for (const p of plan) {
        const sheet = await createWaSheet({ name: p.name, weThree: connected && alsoThree });
        let r;
        try { r = await addWaPeopleInBatches(sheet.id, p.people, 500, (done, all) => setProgress(`${p.name}: ${done} of ${all}`)); }
        catch (err) { try { await deleteWaSheet(sheet.id); } catch { /* nothing more to do */ } throw err; }   // no empty sheet is left behind
        made++;
        people += r.added;
        if (r.weThree) three++;
      }
      toast.success(`${made} ${made === 1 ? "sheet" : "sheets"} created with ${people} people.${three ? ` Also in We Three.` : ""} Now add their messages and pictures.`);
      setTabs([]); setFile("");
    } catch (err) { toast.error(`${errorMessage(err)} ${made} of ${plan.length} sheets were created before this.`); }
    finally { setBusy(false); setProgress(""); await onChanged(); }
  };

  return (
    <Section title="New sheet" subtitle="Make an empty sheet, or bring in an Excel file and turn its tabs into sheets.">
      <div className="wa-row">
        <input className="wa-input" placeholder="Sheet name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <button className="rd-btn is-primary" disabled={busy || !name.trim() || taken.has(name.trim().toLowerCase())} onClick={createOne}>Create sheet</button>
        {name.trim() && taken.has(name.trim().toLowerCase()) ? <>
          <span className="wa-muted">A sheet with that name already exists.</span>
          <button className="rd-btn is-danger" disabled={busy} onClick={() => removeOld(name)}>Delete the old sheet</button>
        </> : null}
      </div>
      {connected ? <label className="wa-check"><input type="checkbox" checked={alsoThree} onChange={(e) => setAlsoThree(e.target.checked)} /> Also create it in We Three (people and “sent” marks stay the same in both)</label> : null}
      <div className="wa-row">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden onChange={pickExcel} />
        <button className="rd-btn" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>Add an Excel file (.xlsx)</button>
        {file ? <span className="wa-muted">{file} · {tabs.length} {tabs.length === 1 ? "tab" : "tabs"}</span> : null}
      </div>
      {tabs.length > 0 && (
        <div className="wa-edit" role="group" aria-label="Sheets from the Excel file">
          <p className="wa-muted">Tick the tabs to make into sheets. Give each a name, and choose how many sheets to split it into (the people are shared out in order: “Name 1”, “Name 2”…).</p>
          {tabs.map((t, i) => (
            <div key={t.tab} className="wa-tab">
              <label className="wa-check"><input type="checkbox" checked={t.include} disabled={!t.people.length} onChange={(e) => setTab(i, { include: e.target.checked })} /> <b>{t.tab}</b> <span className="wa-muted">· {t.people.length} {t.people.length === 1 ? "number" : "numbers"}</span></label>
              {t.include && t.people.length > 0 && (
                <div className="wa-row">
                  <input className="wa-input" aria-label={`Name for ${t.tab}`} placeholder="Sheet name" value={t.name} maxLength={76} onChange={(e) => setTab(i, { name: e.target.value })} />
                  <label className="wa-muted">Sheets <input className="wa-input is-short" type="number" min="1" max={Math.min(20, t.people.length)} value={t.parts} aria-label={`How many sheets from ${t.tab}`} onChange={(e) => setTab(i, { parts: Math.max(1, Math.min(Number(e.target.value) || 1, Math.min(20, t.people.length))) })} /></label>
                </div>
              )}
            </div>
          ))}
          {plan.length > 0 && (
            <ul className="wa-plan">
              {plan.map((p, i) => <li key={i} className={p.clash ? "is-bad" : ""}>{p.name || "(no name)"} · {p.people.length} people{p.clash ? (p.name ? " · name already used" : " · needs a name") : ""}{p.clash && oldOf(p.name) ? <> <button className="rd-btn is-danger" disabled={busy} onClick={() => removeOld(p.name)}>Delete the old sheet</button></> : null}</li>)}
            </ul>
          )}
          <div className="wa-row">
            <button className="rd-btn is-primary" disabled={busy || !plan.length || clash} onClick={createFromExcel}>Create {plan.length} {plan.length === 1 ? "sheet" : "sheets"}</button>
            {progress ? <span className="wa-muted">Adding people… {progress}</span> : null}
            <button className="rd-btn is-quiet" disabled={busy} onClick={() => { setTabs([]); setFile(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </Section>
  );
}

export default function WhatsAppSender() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(null);
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
          <Count label={data.rhythm && data.rhythm.rest && !s.testMode ? "sent today (rest day)" : `sent today of ${data.rhythm ? data.rhythm.today.target : s.dailyLimit}`} n={data.sentToday} tone="ok" />
          <Count label="tablet" n={data.tablet ? "online" : "offline"} tone={data.tablet ? "ok" : "bad"} />
        </div>
        {!data.tablet && <p className="wa-error">The tablet is offline, so nothing can be sent. Check that Stashr Hub is open, on charge and on Wi-Fi.</p>}
        <NextLine plan={data.next} label={data.next && data.next.sheet ? "Next message (from " + ((data.sheets.find((x) => x._id === data.next.sheet) || {}).name || "a sheet") + ")" : "Next message"} />
        {s.testMode && <p className="wa-warn">Test mode is on: the time window, the gap, the daily limit and the rest days are ignored. Turn it off before real sending.</p>}
      </Section>

      <RestDays rhythm={data.rhythm} testMode={s.testMode} onChanged={load} />

      <Section title="Limits" subtitle="Each day picks its own number of messages (a little under the limit), its own start and stop time inside the window, and a different gap after every message, with a longer break now and then.">
        <div className="wa-form">
          <label>Most messages a day<input className="wa-input" type="number" min="0" max="60" value={settings.dailyLimit} onFocus={() => { editing.current = true; }} onChange={(e) => setSettings({ ...settings, dailyLimit: e.target.value })} /></label>
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
          <button className="rd-btn" disabled={!data.tablet} onClick={() => { if (window.confirm("This sends one real message now, to one of the next people in line on your sheets (picked at random). Continue?")) test({}); }}>Send to the next person now</button>
        </div>
        {testNote && <p className="wa-note" role="status">{testNote}</p>}
      </Section>

      {data.sheets.length === 0 && <Section title="No sheets yet"><p className="wa-muted">Make a sheet below, add its messages, a picture and the people to message.</p></Section>}
      {data.sheets.map((sh) => <SheetCard key={sh._id} sheet={sh} onChanged={load} />)}

      <NewSheet existing={data.sheets.map((sh) => ({ id: sh._id, name: sh.name, total: Object.values(sh.counts || {}).reduce((a, b) => a + b, 0) }))} onChanged={load} />

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
