import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  getExpenseSettings, saveExpenseSheet, setExpenseStorage, unlinkExpenseSheet, exportExpenseSheet, setExpenseStart, changeExpenseStart, removeUnmatchedExpenses, uploadStatementAsync, getStatementJob, getSavedStatements, searchStatements, deleteSavedStatement, postExpenseSms, requestExpenseSync, getExpenses, getUncategorized, setExpenseDescription, setExpenseCategory, reviewExpense, uploadStatement
} from "../../api/client";
import { Section, Skeleton, useConfirm } from "../Render/RenderUi";
import { errorMessage } from "../Render/renderUtils";
import { inr, monthLabel, shiftMonth, dayLabel, groupByDay, withShares, startDateChip, STATUS_LABEL, statusTone, storageNote } from "../../lib/money";
import "../Render/RenderDashboard.css";
import "./Money.css";

/** A card that fails to draw shows a short note instead of blanking the page. */
class CardBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error("Money card failed:", error); } // eslint-disable-line no-console
  render() {
    if (!this.state.failed) return this.props.children;
    return <p className="mn-bad" role="alert">One card on this page could not be shown. The rest still works; reloading usually fixes it.</p>;
  }
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const monthNow = () => today().slice(0, 7);

/* ───────── 1. where the entries are kept ───────── */

function StorageCard({ settings, onSaved }) {
  const sheetOnly = settings.storage === "sheet";
  const [url, setUrl] = useState(settings.sheetUrl || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const { ask, dialog } = useConfirm();
  const email = settings.serviceAccountEmail || "";
  const hasSheet = Boolean(settings.sheetId);
  const copyEmail = async () => { try { await navigator.clipboard.writeText(email); toast.success("Email copied."); } catch { toast.error("Could not copy. Select the email and copy it."); } };
  const run = async (what, fn, done) => {
    setBusy(what); setError("");
    try { const r = await fn(); if (done) toast.success(typeof done === "function" ? done(r) : done); return r; }
    catch (err) { setError(errorMessage(err, "That did not work.")); return null; }
    finally { setBusy(""); }
  };
  const saveSheet = async (e) => {
    e.preventDefault();
    const next = await run("save", () => saveExpenseSheet(url.trim()), sheetOnly ? "Sheet connected." : "Copy sheet connected.");
    if (next) { setChanging(false); onSaved(next); }
  };
  const chooseMode = async (mode) => {
    if (mode === settings.storage) return;
    const msg = mode === "sheet"
      ? "From now on new entries go only to your Google Sheet. Entries already in Stashr stay there until they are 4 months old but are no longer shown here."
      : "From now on new entries are kept in Stashr (encrypted). What is in your sheet stays there but is no longer shown here.";
    if (!(await ask({ title: mode === "sheet" ? "Keep entries only in your sheet?" : "Keep entries in Stashr?", message: msg, confirmLabel: "Switch" }))) return;
    const next = await run("mode", () => setExpenseStorage(mode));
    if (next) { toast.info(next.message || "Switched."); onSaved(next); }
  };
  const unlink = async () => {
    if (!(await ask({ title: "Stop copying to the sheet?", message: "Your sheet and its rows stay as they are; Stashr just stops writing to it.", confirmLabel: "Stop copying" }))) return;
    const next = await run("unlink", unlinkExpenseSheet, "Copy stopped.");
    if (next) { setUrl(""); onSaved(next); }
  };
  const exportNow = async () => {
    const r = await run("export", exportExpenseSheet, (x) => `Sent ${x.exported} entries to your sheet.`);
    if (r) onSaved(await getExpenseSettings());
  };
  const sheetForm = (!hasSheet || changing) ? (
    <>
      {!settings.sheetReady ? <p className="mn-bad" role="alert">The server has no Google credentials yet: add <code>GOOGLE_SHEETS_SA_JSON</code> to its environment (a service-account key), then reload.</p> : null}
      <ol className="mn-steps">
        <li>Create a Google Sheet (any name).</li>
        <li>Click <b>Share</b>, add <span className="mn-email"><code>{email || "the service account email"}</code>{email ? <button type="button" className="rd-btn rd-btn--quiet" onClick={copyEmail}>Copy</button> : null}</span> as an <b>Editor</b>.</li>
        <li>Paste the sheet's link below and save.</li>
      </ol>
      <form className="mn-row" onSubmit={saveSheet}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="Google Sheet link" required />
        <button className="rd-btn rd-btn--primary" type="submit" disabled={Boolean(busy) || !settings.sheetReady || !url.trim()}>{busy === "save" ? "Checking…" : "Save"}</button>
        {changing ? <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setChanging(false)}>Cancel</button> : null}
      </form>
    </>
  ) : (
    <div className="mn-row">
      <span className="mn-line">Sheet: <a href={settings.sheetUrl} target="_blank" rel="noreferrer">Open ↗</a> · <button type="button" className="mn-link" onClick={() => setChanging(true)}>Change sheet</button></span>
      {!sheetOnly ? <button type="button" className="rd-btn rd-btn--quiet" onClick={exportNow} disabled={Boolean(busy) || !settings.sheetReady}>{busy === "export" ? "Sending…" : "Send the last 4 months to the sheet now"}</button> : null}
      {!sheetOnly ? <button type="button" className="rd-btn rd-btn--quiet" onClick={unlink} disabled={Boolean(busy)}>Stop copying</button> : null}
    </div>
  );
  return (
    <Section title="Storage" subtitle={storageNote(settings)}>
      <div className="mn-chips" role="radiogroup" aria-label="Where to keep the entries">
        <label className={"mn-chip" + (!sheetOnly ? " is-on" : "")}><input type="radio" name="mn-storage" checked={!sheetOnly} onChange={() => chooseMode("db")} disabled={Boolean(busy)} /> Stashr (encrypted, kept 4 months)</label>
        <label className={"mn-chip" + (sheetOnly ? " is-on" : "")}><input type="radio" name="mn-storage" checked={sheetOnly} onChange={() => chooseMode("sheet")} disabled={Boolean(busy) || !hasSheet} title={hasSheet ? "" : "Add your sheet link first"} /> My Google Sheet only</label>
      </div>
      <h4 className="mn-sub">{sheetOnly ? "Your Google Sheet" : "Also keep a copy in a Google Sheet (optional)"}</h4>
      {sheetForm}
      {settings.copyErrors ? <p className="mn-bad" role="alert">The last {settings.copyErrors} write{settings.copyErrors > 1 ? "s" : ""} to your sheet failed ({settings.lastCopyError || "unknown error"}). Nothing was lost: the entries are safe in Stashr. Use “Send the last 4 months to the sheet now” to catch up.</p> : null}
      {error ? <p className="mn-bad" role="alert">{error}</p> : null}
      {dialog}
    </Section>
  );
}

/* ───────── 2. the one-time start date ───────── */

function StartDateCard({ onDone }) {
  const [date, setDate] = useState(startDateChip("3m"));
  const [busy, setBusy] = useState(false);
  const chips = [["This month", "month"], ["3 months ago", "3m"], ["6 months ago", "6m"], ["1 year ago", "1y"]];
  const go = async () => {
    setBusy(true);
    try { const r = await setExpenseStart(date); toast.success("Done. Reading messages from " + (r.startDate || date) + "."); onDone(); }
    catch (err) { toast.error(errorMessage(err, "Could not save the date.")); }
    finally { setBusy(false); }
  };
  return (
    <Section title="How far back should I read your bank SMS?" subtitle="Nothing before this date is ever read. You can change the date later on this page.">
      <div className="mn-chips" role="group" aria-label="Quick dates">
        {chips.map(([label, kind]) => <button key={kind} type="button" className={"mn-chip" + (date === startDateChip(kind) ? " is-on" : "")} onClick={() => setDate(startDateChip(kind))}>{label}</button>)}
      </div>
      <div className="mn-row">
        <label className="mn-field">Pick a date <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></label>
        <button className="rd-btn rd-btn--primary" onClick={go} disabled={busy || !date}>{busy ? "Saving…" : "Confirm"}</button>
      </div>
      <p className="mn-dim">After this, new messages are read automatically and sorted month by month; this question never comes back. The active list keeps the last 4 months; after that Stashr deletes an entry (in “My Google Sheet only” mode older entries move to the sheet's Archive tab instead).</p>
    </Section>
  );
}

/** "Reading messages from <date>" with a way to move that date (website only). */
function StartDateLine({ settings, onChanged }) {
  const { ask, dialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(settings.startDate || today());
  const [busy, setBusy] = useState(false);
  const chips = [["This month", "month"], ["3 months ago", "3m"], ["6 months ago", "6m"], ["1 year ago", "1y"]];
  const earlier = date < settings.startDate;
  const save = async () => {
    if (!date || date === settings.startDate) { setOpen(false); return; }
    const keepsFourMonths = settings.storage !== "sheet" && earlier;
    const message = earlier
      ? `Your phone will read the bank messages from ${date} again, once, and add what is missing.${keepsFourMonths ? " Stashr keeps only the last 4 months, so anything older than that is not kept." : ""}`
      : `Messages before ${date} will no longer be read. Entries already saved stay as they are.`;
    if (!(await ask({ title: `Read messages from ${date}?`, message, confirmLabel: "Change date" }))) return;
    setBusy(true);
    try { const r = await changeExpenseStart(date); toast.success(r.message || "Start date changed."); setOpen(false); await onChanged(r); }
    catch (err) { toast.error(errorMessage(err, "Could not change the date.")); }
    finally { setBusy(false); }
  };
  return (
    <div className="mn-startline">
      <p className="mn-dim">Reading messages from {settings.startDate || "the start date"}{settings.lastSyncAt ? ` · last message handled ${new Date(settings.lastSyncAt).toLocaleString()}` : ""}. <button type="button" className="mn-link" onClick={() => setOpen(!open)}>{open ? "Cancel" : "Change date"}</button></p>
      {open ? (
        <div className="mn-editor">
          <div className="mn-chips" role="group" aria-label="Quick dates">
            {chips.map(([label, kind]) => <button key={kind} type="button" className={"mn-chip" + (date === startDateChip(kind) ? " is-on" : "")} onClick={() => setDate(startDateChip(kind))}>{label}</button>)}
          </div>
          <div className="mn-row">
            <label className="mn-field">Read messages from <input type="date" value={date} min="2015-01-01" max={today()} onChange={(e) => setDate(e.target.value)} /></label>
            <button className="rd-btn rd-btn--primary" onClick={save} disabled={busy || !date || date === settings.startDate}>{busy ? "Saving…" : "Save date"}</button>
          </div>
          <p className="mn-dim">Using Stashr on two phones? Their messages are merged and repeats are skipped.</p>
          <p className="mn-dim">{date && date < settings.startDate ? "Earlier than now: the phone will read the older messages again the next time it syncs." : "Later than now: older messages stop being read; saved entries stay."}</p>
        </div>
      ) : null}
      {dialog}
    </div>
  );
}

/* ───────── 3. month, totals, categories ───────── */

/** What the phone is doing about Refresh, in plain words. */
function PhoneStatus({ phone, settings }) {
  const at = Number(settings && settings.syncAckAt) || 0;
  const tone = { done: "mn-ok", problem: "mn-bad", late: "mn-warn" }[phone.phase] || "mn-dim";
  return (
    <div className="mn-phone" aria-live="polite">
      {phone.text ? <p className={tone}>{phone.phase === "asking" || phone.phase === "waiting" ? "⏳ " : phone.phase === "done" ? "✓ " : "⚠ "}{phone.text}</p> : null}
      <p className="mn-dim">{at ? `Phone last checked for payments ${new Date(at).toLocaleString()}.` : "The phone has not checked for payments yet."}</p>
    </div>
  );
}

function MonthBar({ month, months, onChange, onRefresh, busy }) {
  const list = months && months.length ? months : [month];
  return (
    <div className="mn-monthbar">
      <button type="button" className="rd-btn rd-btn--quiet" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
      <select value={month} onChange={(e) => onChange(e.target.value)} aria-label="Month">
        {(list.includes(month) ? list : [month, ...list]).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
      </select>
      <button type="button" className="rd-btn rd-btn--quiet" onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month" disabled={month >= monthNow()}>›</button>
      <button type="button" className="rd-btn rd-btn--quiet" onClick={onRefresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
    </div>
  );
}

function Tiles({ totals, flagged }) {
  const t = totals || {};
  const tile = (label, value, tone) => <div className={"mn-tile" + (tone ? " is-" + tone : "")}><span>{label}</span><b>{value}</b></div>;
  return (
    <div className="mn-tiles">
      {tile("Spent", inr(t.debit || 0))}
      {tile("Received", inr(t.credit || 0), "ok")}
      {tile("Net", inr(t.net || 0, { sign: true }), (t.net || 0) < 0 ? "bad" : "ok")}
      {tile("Needs checking", String(flagged), flagged ? "bad" : "")}
    </div>
  );
}

function CategoryBars({ totals, selected, onSelect }) {
  const [table, setTable] = useState(false);
  const cats = useMemo(() => withShares((totals && totals.byCategory) || []), [totals]);
  if (!cats.length) return <Section title="Where the money went"><p className="mn-dim">Nothing spent this month yet.</p></Section>;
  const max = Math.max(...cats.map((c) => c.amount), 1);
  return (
    <Section title="Where the money went" subtitle="Tap a category to see only its payments." actions={<button type="button" className="rd-btn rd-btn--quiet" onClick={() => setTable(!table)}>{table ? "Show bars" : "Show as a table"}</button>}>
      {table ? (
        <table className="mn-table"><thead><tr><th>Category</th><th>Payments</th><th>Share</th><th className="r">Amount</th></tr></thead>
          <tbody>{cats.map((c) => <tr key={c.category}><td>{c.category}</td><td>{c.count}</td><td>{c.share}%</td><td className="r">{inr(c.amount)}</td></tr>)}</tbody></table>
      ) : (
        <ul className="mn-bars">{cats.map((c) => (
          <li key={c.category}>
            <button type="button" className={"mn-bar" + (selected === c.category ? " is-on" : "")} onClick={() => onSelect(selected === c.category ? "" : c.category)} aria-pressed={selected === c.category}>
              <span className="mn-bar__name">{c.category}</span>
              <span className="mn-bar__track" aria-hidden="true"><i style={{ width: Math.max(2, (c.amount / max) * 100) + "%" }} /></span>
              <span className="mn-bar__val"><b>{inr(c.amount)}</b> <em>{c.share}% · {c.count}</em></span>
            </button>
          </li>
        ))}</ul>
      )}
    </Section>
  );
}

/* ───────── 4. doubtful entries ───────── */

/** Why an entry is in the "Needs checking" list. */
const reasonsOf = (r) => (r.status === "Not in statement" ? ["The bank statement you uploaded does not have this one. It may be a duplicate or a fake message."]
  : r.status === "Mismatch" ? [r.note || "The amount or type differs from your bank statement."]
  : r.flags && r.flags.length ? r.flags : ["Something about this message looked wrong"]);

function FlaggedCard({ rows, onChanged }) {
  const { ask, dialog } = useConfirm();
  const [busy, setBusy] = useState(null);
  if (!rows.length) return null;
  const act = async (r, action) => {
    if (action === "delete" && !(await ask({ title: "Delete this entry?", message: `${inr(r.amount)} to ${r.merchant || "unknown"} on ${r.date} will be removed.`, confirmLabel: "Delete (fake)", danger: true }))) return;
    setBusy(r.index);
    try { await reviewExpense(r.index, action); toast.success(action === "delete" ? "Removed." : "Marked as genuine."); onChanged(); }
    catch (err) { toast.error(errorMessage(err, "Could not do that.")); }
    finally { setBusy(null); }
  };
  const unmatched = rows.filter((r) => r.status === "Not in statement");
  const removeUnmatched = async () => {
    if (!(await ask({ title: `Delete ${unmatched.length} entries?`, message: "Your bank statement does not have them, so they are most likely duplicates or fake messages. They will be removed.", confirmLabel: "Delete them all", danger: true }))) return;
    try { const r = await removeUnmatchedExpenses(); toast.success(`Removed ${r.removed}.`); onChanged(); } catch (err) { toast.error(errorMessage(err, "Could not remove them.")); }
  };
  return (
    <Section title={`Needs checking (${rows.length})`} subtitle="These look doubtful, or your bank statement did not confirm them, so they are not counted in your totals. Upload your bank statement to check them automatically, or decide yourself.">
      {dialog}
      {unmatched.length > 1 ? <div className="mn-row"><button className="rd-btn rd-btn--danger-quiet" onClick={removeUnmatched}>Delete all {unmatched.length} that the statement does not have</button></div> : null}
      <ul className="mn-flag">{rows.map((r) => (
        <li key={r.index}>
          <div className="mn-flag__top"><b>{inr(r.amount)}</b> <span>{r.type === "Credit" ? "from" : "to"} {r.merchant || "unknown"}</span> <em>{dayLabel(r.date)}{r.time ? " · " + r.time : ""}</em></div>
          <ul className="mn-reasons">{reasonsOf(r).map((f, i) => <li key={i}>{f}</li>)}</ul>
          <div className="mn-row">
            <button className="rd-btn rd-btn--quiet" disabled={busy === r.index} onClick={() => act(r, "genuine")}>This is genuine</button>
            <button className="rd-btn rd-btn--danger-quiet" disabled={busy === r.index} onClick={() => act(r, "delete")}>Delete (fake)</button>
          </div>
        </li>
      ))}</ul>
    </Section>
  );
}

/* ───────── 5. the month's payments ───────── */

function CategoryEditor({ tx, categories, onClose, onSaved }) {
  const [value, setValue] = useState(tx.category);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => [...new Set([...(categories || []), tx.category])].filter(Boolean), [categories, tx.category]);
  const choose = (v) => {
    if (v !== "__new") { setValue(v); return; }
    const name = (window.prompt("Name of the new category") || "").trim().slice(0, 30);
    if (name) setValue(name);
  };
  const save = async () => {
    setBusy(true);
    try { await setExpenseCategory(tx.index, value, remember); toast.success("Category saved."); onSaved(); }
    catch (err) { toast.error(errorMessage(err, "Could not save.")); setBusy(false); }
  };
  return (
    <div className="mn-edit">
      <select value={options.includes(value) ? value : "__new"} onChange={(e) => choose(e.target.value)} aria-label="Category">
        {options.map((c) => <option key={c} value={c}>{c}</option>)}
        {!options.includes(value) ? <option value="__new">{value}</option> : null}
        <option value="__new">New category…</option>
      </select>
      <label className="mn-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember for {tx.merchant || "this merchant"}</label>
      <button className="rd-btn rd-btn--primary" onClick={save} disabled={busy || value === tx.category && !remember}>Save</button>
      <button className="rd-btn rd-btn--quiet" onClick={onClose}>Cancel</button>
    </div>
  );
}

/** The owner's own words for a payment ("birthday gift for Mom"). */
function DescriptionEditor({ tx, onClose, onSaved }) {
  const [text, setText] = useState(tx.description || "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await setExpenseDescription(tx.index, text); toast.success("Description saved."); onSaved(); }
    catch (err) { toast.error(errorMessage(err, "Could not save the description.")); setBusy(false); }
  };
  return (
    <div className="mn-edit">
      <input type="text" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="What was this for?" aria-label="Description" autoFocus />
      <button className="rd-btn rd-btn--primary" onClick={save} disabled={busy || text.trim() === (tx.description || "")}>Save</button>
      <button className="rd-btn rd-btn--quiet" onClick={onClose}>Cancel</button>
    </div>
  );
}

function TxRow({ tx, categories, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [open, setOpen] = useState(false);
  const uncategorized = tx.category === "Uncategorized";
  return (
    <li className={"mn-tx" + (uncategorized ? " is-uncat" : "") + (tx.status === "Flagged" ? " is-flagged" : "")}>
      <div className="mn-tx__main">
        <button type="button" className="mn-tx__name" onClick={() => setOpen(!open)} aria-expanded={open}>
          <b>{tx.merchant || "Unknown"}</b>
          <span>{tx.time || ""}{tx.method ? <i className="mn-method">{tx.method}</i> : null}</span>
        </button>
        <button type="button" className="mn-desc" onClick={() => setDescribing(!describing)} aria-label={tx.description ? "Edit description" : "Add description"}>{tx.description ? "✎ " + tx.description : "+ description"}</button>
        <button type="button" className={"mn-cat" + (uncategorized ? " is-uncat" : "")} onClick={() => setEditing(!editing)} aria-label={`Category ${tx.category}. Change`}>{tx.category}</button>
        <span className={"mn-amt " + (tx.type === "Credit" ? "is-credit" : "")}>{tx.type === "Credit" ? "+" : ""}{inr(tx.amount)}</span>
        <span className={"mn-badge is-" + statusTone(tx.status)}>{STATUS_LABEL[tx.status] || tx.status || "Unverified"}</span>
      </div>
      {describing ? <DescriptionEditor tx={tx} onClose={() => setDescribing(false)} onSaved={() => { setDescribing(false); onChanged(); }} /> : null}
      {editing ? <CategoryEditor tx={tx} categories={categories} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} /> : null}
      {open ? (
        <dl className="mn-detail">
          <div><dt>Reference</dt><dd>{tx.ref || "—"}</dd></div>
          <div><dt>Account</dt><dd>{tx.account || "—"}</dd></div>
          <div><dt>Balance after</dt><dd>{tx.balance == null ? "—" : inr(tx.balance)}</dd></div>
          <div><dt>Source</dt><dd>{tx.source || "—"}</dd></div>
          {tx.note ? <div><dt>Note</dt><dd>{tx.note}</dd></div> : null}
        </dl>
      ) : null}
    </li>
  );
}

/** Unsorted payments in groups: one tap sorts every payment to or from the same UPI id/name, past and future. */
function QuickSortCard({ categories, onChanged, refreshKey, month }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  useEffect(() => { let live = true; getUncategorized(month).then((d) => { if (live) setData(d); }).catch(() => {}); return () => { live = false; }; }, [refreshKey, month]);
  if (!data || !data.groups.length) return null;
  const sort = async (g, category) => {
    setBusy(g.key);
    try { const r = await setExpenseCategory(g.index, category, g.remembers); toast.success(r.updated > 1 ? `${r.updated} payments sorted as ${category}.` : "Sorted."); await onChanged(); }
    catch (e) { toast.error("Could not save the category."); }
    finally { setBusy(""); }
  };
  const options = (categories || []).filter((c) => c && c !== "Uncategorized");
  return (
    <Section title={`Sort quickly: ${month ? monthLabel(month) : "all months"} (${data.total} unsorted)`} subtitle="Pick a category once. Every payment to or from the same UPI id or name, old and new, follows it automatically.">
      <ul className="mn-quick">
        {data.groups.slice(0, 12).map((g) => (
          <li key={g.key}>
            <span><b>{g.label}</b> <em>{g.count} {g.count === 1 ? "payment" : "payments"}{g.debit ? " · spent " + inr(g.debit) : ""}{g.credit ? " · received " + inr(g.credit) : ""}</em></span>
            <select defaultValue="" disabled={busy === g.key} aria-label={`Category for ${g.label}`} onChange={(e) => e.target.value && sort(g, e.target.value)}>
              <option value="">Choose…</option>
              {options.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function TxList({ rows, categories, filter, onClear, onChanged, uncategorized }) {
  const shown = filter ? rows.filter((r) => r.category === filter) : rows;
  const days = useMemo(() => groupByDay(shown), [shown]);
  return (
    <Section title={filter ? `${filter} payments` : "Payments"} subtitle={`${shown.length} ${shown.length === 1 ? "entry" : "entries"}`}
      actions={filter ? <button type="button" className="rd-btn rd-btn--quiet" onClick={onClear}>Show all</button> : null}>
      {uncategorized > 0 ? <p className="mn-banner">{uncategorized} {uncategorized === 1 ? "payment is" : "payments are"} not sorted yet. Tap its category to choose one; Stashr remembers it for that merchant.</p> : null}
      {!days.length ? <p className="mn-dim">No payments here.</p> : days.map((d) => (
        <div key={d.date} className="mn-day">
          <h4><span>{dayLabel(d.date)}</span><em>{d.debit ? "Spent " + inr(d.debit) : ""}{d.debit && d.credit ? " · " : ""}{d.credit ? "Received " + inr(d.credit) : ""}</em></h4>
          <ul>{d.rows.map((r) => <TxRow key={r.index} tx={r} categories={categories} onChanged={onChanged} />)}</ul>
        </div>
      ))}
    </Section>
  );
}

/* ───────── 6b. search the saved statements ───────── */

function StatementSearch({ refreshKey }) {
  const { ask, dialog } = useConfirm();
  const [saved, setSaved] = useState(null);              // { statements, months }
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");
  const [found, setFound] = useState(null);              // { total, results, searched }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seq = useRef(0);

  const loadSaved = useCallback(async () => { try { setSaved(await getSavedStatements()); } catch (e) { setError(errorMessage(e, "Could not load your saved statements.")); } }, []);
  useEffect(() => { loadSaved(); }, [loadSaved, refreshKey]);
  useEffect(() => {                                       // search a moment after the last key
    const text = q.trim();
    if (!text) { setFound(null); setError(""); return undefined; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try { const r = await searchStatements(text, month); if (mine === seq.current) { setFound(r); setError(""); } }
      catch (e) { if (mine === seq.current) setError(errorMessage(e, "Could not search.")); }
      finally { if (mine === seq.current) setBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, month, refreshKey]);

  const remove = async (s) => {
    if (!(await ask({ title: `Delete the saved statement "${s.filename || "statement"}"?`, message: `Its ${s.lines} saved line${s.lines === 1 ? "" : "s"} can no longer be searched. Your Money entries are not changed.`, confirmLabel: "Delete", danger: true }))) return;
    try { await deleteSavedStatement(s.id); toast.success("Deleted."); await loadSaved(); setFound(null); setQ((x) => x); } catch (e) { toast.error(errorMessage(e, "Could not delete it.")); }
  };
  const has = saved && saved.statements.length > 0;
  return (
    <Section title="Search your saved statements" subtitle="Every statement you check is kept (encrypted) so you can look something up months later: type a name, an amount, or part of a reference number. Small spelling slips are fine.">
      {dialog}
      {saved && !has ? <p className="mn-dim">Nothing saved yet. Upload a statement above and its lines are kept here for searching.</p> : null}
      {has ? (
        <>
          <div className="mn-row">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. ramesh · 1200 · 500-2000 · >5000 · 6131123" aria-label="Search the saved statements" />
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Only this month">
              <option value="">All saved months</option>
              {saved.months.map((m) => <option key={m.month} value={m.month}>{monthLabel(m.month)} ({m.lines})</option>)}
            </select>
          </div>
          <p className="mn-dim">Amounts: <code>1200</code> exact, <code>500-2000</code> a range, <code>&gt;5000</code> or <code>&lt;300</code>. Mix them with a name: <code>ramesh 350</code>.</p>
          {error ? <p className="mn-bad" role="alert">{error}</p> : null}
          {busy && !found ? <p className="mn-dim">Searching…</p> : null}
          {found ? (
            found.total === 0 ? <p className="mn-dim">Nothing found in {found.searched} saved line{found.searched === 1 ? "" : "s"}. Try fewer letters of the name.</p> : (
              <>
                <p className="mn-dim">{found.total} found{found.total > found.results.length ? ` (showing the best ${found.results.length})` : ""}</p>
                <div className="mn-scroll">
                  <table className="mn-table">
                    <thead><tr><th>Date</th><th>Details</th><th className="r">Amount</th><th className="r">Balance</th><th>Statement</th></tr></thead>
                    <tbody>
                      {found.results.map((x) => (
                        <tr key={x.id}>
                          <td>{dayLabel(x.date)}</td>
                          <td className="mn-wrap">{x.desc}{x.ref ? <small className="mn-dim"> · {x.ref}</small> : null}</td>
                          <td className={"r " + (x.type === "Credit" ? "mn-ok" : "")}>{x.type === "Credit" ? "+" : "−"}{inr(x.amount)}</td>
                          <td className="r">{x.balance == null ? "" : inr(x.balance)}</td>
                          <td className="mn-dim">{x.file}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          ) : null}
          <details className="mn-saved">
            <summary>Saved statements ({saved.statements.length})</summary>
            <ul className="mn-savedlist">
              {saved.statements.map((s) => (
                <li key={s.id}>
                  <span><b>{s.filename || "statement"}</b> · {s.from} to {s.to} · {s.lines} line{s.lines === 1 ? "" : "s"}{s.month ? ` · matched ${monthLabel(s.month)}` : ""}</span>
                  <button type="button" className="rd-btn rd-btn--quiet" onClick={() => remove(s)}>Delete</button>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
    </Section>
  );
}

/* ───────── 6. bank statement ───────── */

function StatementCard({ settings, onDone }) {
  const { ask, dialog } = useConfirm();
  const [sending, setSending] = useState(null);          // 0..100 while the file goes up
  const [job, setJob] = useState(null);                  // the check running (or just finished) on the server
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const input = useRef(null);
  const timer = useRef(null);
  const [month, setMonth] = useState("");                // "" = the whole statement; else YYYY-MM to match
  const [locked, setLocked] = useState(null);            // { file, wrong } while a locked statement waits for its password
  const [password, setPassword] = useState("");
  const doneRef = useRef(onDone);
  doneRef.current = onDone;                              // the page reloads itself with whatever onDone is now, without restarting the polling
  const last = settings.lastStatement;
  const running = Boolean(job && (job.status === "queued" || job.status === "running"));
  const busy = sending !== null || running;
  useEffect(() => () => clearTimeout(timer.current), []);

  // follow a check on the server until it ends; the page can be left or reloaded meanwhile (the newest check is picked up again below)
  const follow = useCallback((first) => {
    clearTimeout(timer.current);
    let current = first;
    const tick = async () => {
      try {
        const { job: j } = await getStatementJob(current.id);
        if (!j) { setJob(null); setError("The server was restarted while it was checking. Upload the statement again; nothing is added twice."); return; }
        current = j; setJob(j);
        if (j.status === "done") { setReport(j.report); toast.success("Statement checked."); doneRef.current(); return; }
        if (j.status === "failed") { setError(j.error || "Could not check that statement."); return; }
      } catch (e) { /* a missed look: try again */ }
      timer.current = setTimeout(tick, 1200);
    };
    timer.current = setTimeout(tick, 600);
  }, []);
  useEffect(() => {                                       // a check already running when this page opens
    let live = true;
    getStatementJob().then(({ job: j }) => { if (live && j && (j.status === "queued" || j.status === "running")) { setJob(j); follow(j); } }).catch(() => {});
    return () => { live = false; };
  }, [follow]);

  const send = async (file, pass) => {
    setSending(0); setError(""); setReport(null); setJob(null);
    try {
      const { job: j } = await uploadStatementAsync(file, (ev) => { if (ev.total) setSending(Math.round((100 * ev.loaded) / ev.total)); }, { password: pass, month });
      setSending(null); setLocked(null); setPassword(""); setJob(j); follow(j);
    } catch (err) {
      setSending(null);
      const data = err && err.response && err.response.data;
      if (data && (data.code === "password_required" || data.code === "wrong_password")) {
        // a locked Excel file: ask for its password (the file stays here in the page; it is sent again with the password)
        setLocked({ file, wrong: data.code === "wrong_password" }); setPassword("");
        return;
      }
      if (data && data.job) { setLocked(null); setJob(data.job); follow(data.job); setError("A statement is already being checked; showing that one."); }
      else { setLocked(null); setError(errorMessage(err, "Could not read that statement.")); }
    }
  };
  const pick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError("That file is bigger than 8 MB."); return; }
    setLocked(null);
    await send(file, "");
  };
  const unlock = async (e) => { e.preventDefault(); if (locked && password) await send(locked.file, password); };
  const monthChoices = useMemo(() => { const now = new Date(); const out = []; for (let i = 0; i < 7; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); } return out; }, []);
  const r = report || last;
  const removeUnmatched = async () => {
    if (!(await ask({ title: `Delete ${r.notInStatement} entries?`, message: "Your bank statement does not have them, so they are most likely duplicates or fake messages. They will be removed.", confirmLabel: "Delete them all", danger: true }))) return;
    try { const x = await removeUnmatchedExpenses(); toast.success(`Removed ${x.removed}.`); setReport({ ...r, notInStatement: 0 }); onDone(); } catch (err) { toast.error(errorMessage(err, "Could not remove them.")); }
  };
  return (
    <Section title="Check against a bank statement" subtitle="Download your Federal Bank statement from net banking (PDF, Excel or CSV, locked or not) and upload it. The statement is treated as the truth: what it confirms takes its date, amount and name, what is missing is added, and what it does not have is set aside.">
      {dialog}
      <div className="mn-row">
        <label className="mn-field">Month to match
          <select value={month} onChange={(e) => setMonth(e.target.value)} disabled={busy || Boolean(locked)} aria-label="Which month of the statement to match">
            <option value="">Whole statement (every month in it)</option>
            {monthChoices.map((m) => <option key={m} value={m}>{monthLabel(m)} only</option>)}
          </select>
        </label>
      </div>
      <div className="mn-row">
        <input ref={input} type="file" accept=".pdf,.csv,.xlsx,.xls,text/csv,application/pdf" onChange={pick} hidden />
        <button className="rd-btn rd-btn--primary" onClick={() => input.current && input.current.click()} disabled={busy}>{sending !== null ? `Uploading… ${sending}%` : running ? "Checking…" : "Choose a statement (.pdf, .xlsx or .csv)"}</button>
      </div>
      {sending !== null || running ? (
        <div className="mn-progress" role="status" aria-live="polite">
          <div className="mn-progress__bar"><span style={{ width: `${sending !== null ? Math.min(sending, 100) * 0.03 : job.pct}%` }} /></div>
          <p className="mn-dim">{sending !== null ? "Sending the file…" : job.text}</p>
          {running ? <p className="mn-dim">The file is safely received. The server is reading and matching it in the background; you can use the rest of Stashr or leave this page.</p> : null}
        </div>
      ) : null}
      {locked ? (
        <form className="mn-unlock" onSubmit={unlock} aria-label="Unlock the statement">
          <p><b>🔒 {locked.file.name} is locked.</b> {locked.wrong ? <span className="mn-bad" role="alert">That password did not open it. Check it and try again.</span> : "Enter the password the bank gave you for this file (for a PDF, usually the one printed in the e-mail). It is used once to open the file and is not saved."}</p>
          <div className="mn-row">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Statement password" autoComplete="off" autoFocus aria-label="Statement password" />
            <button className="rd-btn rd-btn--primary" type="submit" disabled={!password || busy}>Unlock and check</button>
            <button className="rd-btn rd-btn--quiet" type="button" onClick={() => { setLocked(null); setPassword(""); }} disabled={busy}>Cancel</button>
          </div>
        </form>
      ) : null}
      {error ? <p className="mn-bad" role="alert">{error}</p> : null}
      {r ? (
        <div className="mn-report">
          <p className="mn-dim">{report ? "Result" : "Last check"}{r.from ? `: ${r.from} to ${r.to}` : ""} · {r.lines} lines</p>
          {report && report.saved ? <p className="mn-dim">{report.saved} line{report.saved === 1 ? "" : "s"} saved, so you can search this statement later (see “Search your saved statements” below).</p> : null}
          <div className="mn-tiles">
            <div className="mn-tile is-ok"><span>Verified</span><b>{r.verified}</b></div>
            <div className={"mn-tile" + (r.mismatched ? " is-warn" : "")}><span>Amount corrected</span><b>{r.mismatched}</b></div>
            <div className="mn-tile"><span>Added from statement</span><b>{r.added}</b></div>
            {r.renamed != null ? <div className="mn-tile"><span>Names fixed</span><b>{r.renamed}</b></div> : null}
            <div className={"mn-tile" + (r.notInStatement ? " is-warn" : "")}><span>Not in statement</span><b>{r.notInStatement}</b></div>
          </div>
          {r.skipped && (r.skipped.beforeStart || r.skipped.tooOld) ? (
            <p className="mn-dim">
              {r.skipped.beforeStart ? `${r.skipped.beforeStart} older line${r.skipped.beforeStart === 1 ? "" : "s"} in the statement ${r.skipped.beforeStart === 1 ? "was" : "were"} skipped: before your start date (${r.skipped.startDate}). ` : ""}
              {r.skipped.tooOld ? `${r.skipped.tooOld} line${r.skipped.tooOld === 1 ? "" : "s"} older than 4 months ${r.skipped.tooOld === 1 ? "was" : "were"} skipped (Stashr keeps 4 months).` : ""}
            </p>
          ) : null}
          {r.months && r.months.length ? (
            <div className="mn-months">
              <b>{r.allMonthsMatch ? "✓ Every month now adds up to your statement" : "⚠ Some months do not add up to your statement"}</b>
              <ul>{r.months.map((m) => (
                <li key={m.month} className={m.match ? "mn-ok" : "mn-bad"}>
                  <span>{monthLabel(m.month)}</span>
                  <span>Statement: spent {inr(m.statementDebit)}, received {inr(m.statementCredit)}</span>
                  <span>Stashr: spent {inr(m.stashrDebit)}, received {inr(m.stashrCredit)}</span>
                  <span>{m.match ? "✓" : "differs"}</span>
                  {m.setAside ? <span className="mn-dim">{m.setAside} earlier-verified {m.setAside === 1 ? "entry" : "entries"} ({inr(m.setAsideDebit)} spent, {inr(m.setAsideCredit)} received) not in this statement: set aside under "Needs checking", not counted.</span> : null}
                </li>
              ))}</ul>
              {!r.allMonthsMatch ? <p className="mn-dim">A month differs when an entry this statement does not have is still counted, you confirmed an entry by hand that the statement does not have, or an entry is still under "Needs checking".</p> : null}
            </div>
          ) : null}
          {r.notInStatement > 0 ? <div className="mn-row"><button className="rd-btn rd-btn--danger-quiet" onClick={removeUnmatched}>Delete the {r.notInStatement} entries the statement does not have</button></div> : null}
          {(r.balanceBreakCount || 0) > 0 ? (
            <div className="mn-warn"><b>{r.balanceBreakCount} balance {r.balanceBreakCount === 1 ? "break" : "breaks"}</b> in the statement itself: the running balance does not follow the amounts.
              {r.balanceBreaks && r.balanceBreaks.length ? <ul>{r.balanceBreaks.slice(0, 5).map((b, i) => <li key={i}>{b.date} · {b.desc} · expected {inr(b.expected)}, got {inr(b.got)}</li>)}</ul> : null}
            </div>
          ) : report ? <p className="mn-ok">The statement's balances add up.</p> : null}
        </div>
      ) : null}
    </Section>
  );
}

/* ───────── 7. add one message by hand ───────── */

function PasteCard({ onDone }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const send = async () => {
    setBusy(true); setResult("");
    try {
      const r = await postExpenseSms([{ address: "MANUAL", body: text, date: Date.now() }]);
      if (r.needsStartDate) setResult("Choose the start date first.");
      else if (r.flagged) setResult("Added, but marked “Needs checking”: a message pasted by hand cannot be proven to come from the bank. Upload your statement to confirm it.");
      else if (r.added) setResult("Added.");
      else if (r.duplicates) setResult("That payment is already in your list.");
      else setResult("I did not understand that message" + (r.unparsed && r.unparsed.length ? ": it does not look like a Federal Bank debit or credit SMS." : "."));
      if (r.added || r.flagged) { setText(""); onDone(); }
    } catch (err) { setResult(errorMessage(err, "Could not add it.")); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Paste an SMS" subtitle="Add a single bank message by hand, for example one the phone could not read.">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Debited Rs 100.00 from a/c X9229 on 21Oct26 19:42 via UPI to … Ref …" aria-label="Bank SMS text" />
      <div className="mn-row"><button className="rd-btn rd-btn--primary" onClick={send} disabled={busy || text.trim().length < 20}>{busy ? "Adding…" : "Add"}</button></div>
      {result ? <p className="mn-line" role="status">{result}</p> : null}
    </Section>
  );
}

/* ───────── the page ───────── */

export default function Money() {
  const [settings, setSettings] = useState(null);
  const [month, setMonth] = useState(monthNow());
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const loadSettings = useCallback(async () => {
    try { setSettings(await getExpenseSettings()); setError(""); }
    catch (e) { setError(errorMessage(e, "Could not load Money.")); }
  }, []);
  const loadData = useCallback(async (m) => {
    setBusy(true);
    try { setData(await getExpenses(m)); setError(""); }
    catch (e) { setError(errorMessage(e, "Could not read your entries.")); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);
  const ready = Boolean(settings && settings.configured && !settings.needsStartDate);
  useEffect(() => { if (ready) loadData(month); }, [ready, month, loadData]);
  // Come back to the tab: look again (nothing polls on its own).
  useEffect(() => {
    if (!ready) return undefined;
    const onVisible = () => { if (!document.hidden) loadData(month); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ready, month, loadData]);

  const reload = useCallback(() => { loadSettings(); if (ready) loadData(month); }, [ready, month, loadData, loadSettings]);

  // Refresh: show what Stashr has, and ask the phone (it alone reads the bank SMS) to look for new payments right now.
  const [statementsAt, setStatementsAt] = useState(0);        // bumped when a statement check ends, so the saved-statement search reloads
  const [phone, setPhone] = useState({ phase: "idle", text: "" });
  const pollTimer = useRef(null);
  useEffect(() => () => clearTimeout(pollTimer.current), []);
  const refreshWithPhone = useCallback(async () => {
    clearTimeout(pollTimer.current);
    setPhone({ phase: "asking", text: "Asking your phone to check for new payments…" });
    loadSettings(); if (ready) loadData(month);
    let req;
    try { req = await requestExpenseSync(); }
    catch (e) { setPhone({ phase: "problem", text: errorMessage(e, "Could not ask your phone.") }); return; }
    setPhone({ phase: "waiting", text: req.phoneOnline ? "Your phone is open, waiting for its answer…" : "Waiting for your phone. It is not open right now, so it answers when it is online (about every 15 minutes, or at once when you open Stashr)." });
    const until = Date.now() + 75000;
    const poll = async () => {
      try {
        const s = await getExpenseSettings();
        setSettings(s);
        if (Number(s.syncAckAt) >= Number(req.requestedAt)) {
          const r = s.phoneResult || {};
          await loadData(month);
          if (r.skipped) setPhone({ phase: "problem", text: `The phone answered, but: ${r.skipped}` });
          else if (r.error) setPhone({ phase: "problem", text: `The phone could not finish: ${r.error}` });
          else setPhone({ phase: "done", text: r.added ? `Phone synced: ${r.added} new payment${r.added > 1 ? "s" : ""}${r.flagged ? `, ${r.flagged} need checking` : ""}.` : "Phone synced: no new payments." });
          return;
        }
      } catch (e) { /* ask again in a moment */ }
      if (Date.now() < until) pollTimer.current = setTimeout(poll, 3000);
      else setPhone({ phase: "late", text: `No answer from the phone yet, so this is what Stashr already has. ${req.phoneOnline ? "" : "Open Stashr on the phone to sync right away."}`.trim() });
    };
    pollTimer.current = setTimeout(poll, 2500);
  }, [ready, month, loadData, loadSettings]);
  const asking = phone.phase === "asking" || phone.phase === "waiting";
  const categories = (settings && settings.categories) || (data && data.totals && data.totals.byCategory.map((c) => c.category)) || [];

  return (
    <main className="mn-page">
      <header className="mn-head">
        <div><h1>Money</h1><p className="mn-dim">Your UPI and bank payments, sorted by category and checked against your bank statement.</p></div>
      </header>
      {error ? <p className="mn-bad" role="alert">{error}</p> : null}
      {!settings ? <Skeleton lines={4} /> : (
        <>
          <CardBoundary><StorageCard settings={settings} onSaved={(s) => { setSettings(s); }} /></CardBoundary>
          {settings.configured && settings.needsStartDate ? <CardBoundary><StartDateCard onDone={loadSettings} /></CardBoundary> : null}
          {settings.configured && !settings.needsStartDate ? (
            <>
              <StartDateLine settings={settings} onChanged={async () => { await loadSettings(); refreshWithPhone(); }} />
              <MonthBar month={month} months={data && data.months} onChange={(m) => { setMonth(m); setFilter(""); }} onRefresh={refreshWithPhone} busy={busy || asking} />
              <PhoneStatus phone={phone} settings={settings} />
              {!data ? <Skeleton lines={5} /> : (
                <>
                  <CardBoundary><Tiles totals={data.totals} flagged={(data.flagged || []).length} /></CardBoundary>
                  <CardBoundary><FlaggedCard rows={data.flagged || []} onChanged={reload} /></CardBoundary>
                  <CardBoundary><QuickSortCard month={month} categories={categories} onChanged={reload} refreshKey={data.rows} /></CardBoundary>
                  <CardBoundary><CategoryBars totals={data.totals} selected={filter} onSelect={setFilter} /></CardBoundary>
                  <CardBoundary><TxList rows={data.rows || []} categories={categories} filter={filter} onClear={() => setFilter("")} onChanged={reload} uncategorized={data.uncategorized || 0} /></CardBoundary>
                </>
              )}
              <CardBoundary><StatementCard settings={settings} onDone={() => { setStatementsAt(Date.now()); reload(); }} /></CardBoundary>
              <CardBoundary><StatementSearch refreshKey={statementsAt} /></CardBoundary>
              <CardBoundary><PasteCard onDone={reload} /></CardBoundary>
            </>
          ) : null}
          <p className="mn-dim mn-note">Messages are read by the Stashr Android app (Settings → Money) and sent here. {settings.storage === "sheet" ? "They are written only to your Google Sheet; Stashr's database keeps none." : `Stored encrypted in Stashr for 4 months${settings.sheetCopy ? "; also copied to your sheet" : "; optionally copied to your sheet"}.`}</p>
        </>
      )}
    </main>
  );
}
