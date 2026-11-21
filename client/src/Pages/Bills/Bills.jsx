import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { getBills, addBill, saveBill, deleteBill, payBill, unpayBill, readBillText, readBillPdf } from "../../api/client";
import { Section, Skeleton, useConfirm } from "../Render/RenderUi";
import { errorMessage } from "../Render/renderUtils";
import { inr } from "../../lib/money";
import { whenWord, TONE, todayLocal, bannerDays, setBannerDays } from "../../lib/bills";
import "../Render/RenderDashboard.css";
import "./Bills.css";

const changed = () => window.dispatchEvent(new Event("stashr-bills-changed"));
const EMPTY = { name: "", account: "", amount: "", billDate: "", dueDate: "", notes: "", repeat: false };

/** Add or edit one bill. "Fill from a bill" reads pasted text or a bill PDF in Stashr; nothing is fetched from the provider and nothing is saved until you press Save. */
function BillForm({ initial, onDone, onCancel }) {
  const [f, setF] = useState({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paste, setPaste] = useState("");
  const [lockedFile, setLockedFile] = useState(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const fileRef = useRef(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const fill = (r) => {
    if (!r.found) { setError("Could not find an amount, due date or number in that. Fill the form by hand."); return; }
    setF((x) => ({ ...x, amount: r.amount != null ? String(r.amount) : x.amount, dueDate: r.dueDate || x.dueDate, billDate: r.billDate || x.billDate, account: r.account || x.account }));
    setError(""); toast.success("Filled from the bill. Check it, then save.");
  };
  const readPaste = async () => { setBusy(true); setError(""); try { fill(await readBillText(paste)); } catch (e) { setError(errorMessage(e, "Could not read it.")); } finally { setBusy(false); } };
  const readFile = async (file, password) => {
    setBusy(true); setError("");
    try { fill(await readBillPdf(file, password)); setLockedFile(null); setPdfPassword(""); }
    catch (e) { if (e?.response?.data?.code === "password_required" || e?.response?.data?.code === "wrong_password") setLockedFile(file); setError(errorMessage(e, "Could not read that PDF.")); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const body = { name: f.name, account: f.account, amount: f.amount === "" ? null : f.amount, billDate: f.billDate, dueDate: f.dueDate, notes: f.notes, repeat: f.repeat };
      await (initial && initial.id ? saveBill(initial.id, body) : addBill(body));
      changed(); onDone();
    } catch (err) { setError(errorMessage(err, "Could not save the bill.")); } finally { setBusy(false); }
  };
  return (
    <Section title={initial && initial.id ? "Edit bill" : "Add a bill"} subtitle="The consumer / customer number is stored encrypted. Stashr never asks for your login to a provider.">
      <details className="bl-read">
        <summary>Fill from a bill (paste the bill email or SMS, or choose the bill PDF)</summary>
        <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste the bill email or SMS text here" />
        <div className="bl-row">
          <button type="button" className="rd-btn" disabled={busy || !paste.trim()} onClick={readPaste}>Read the text</button>
          <label className="rd-btn">Choose bill PDF<input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => e.target.files[0] && readFile(e.target.files[0], "")} /></label>
        </div>
        {lockedFile && (
          <div className="bl-row">
            <input type="password" autoComplete="off" value={pdfPassword} onChange={(e) => setPdfPassword(e.target.value)} placeholder="PDF password" />
            <button type="button" className="rd-btn" disabled={busy || !pdfPassword} onClick={() => readFile(lockedFile, pdfPassword)}>Open PDF</button>
          </div>
        )}
      </details>
      <form onSubmit={submit} className="bl-form">
        <label>Provider / bill<input value={f.name} onChange={set("name")} maxLength={80} placeholder="Electricity - DHBVN" required /></label>
        <label>Consumer / account no. (K No.)<input value={f.account} onChange={set("account")} maxLength={60} autoComplete="off" /></label>
        <label>Amount (₹, if known)<input type="number" min="0" step="0.01" value={f.amount} onChange={set("amount")} /></label>
        <label>Bill date<input type="date" value={f.billDate} onChange={set("billDate")} /></label>
        <label>Due date<input type="date" value={f.dueDate} onChange={set("dueDate")} required /></label>
        <label className="bl-wide">Notes<input value={f.notes} onChange={set("notes")} maxLength={300} /></label>
        <label className="bl-check"><input type="checkbox" checked={f.repeat} onChange={set("repeat")} /> Repeats every month (paying it adds next month's bill)</label>
        {error && <p className="bl-bad" role="alert">{error}</p>}
        <div className="bl-row bl-wide">
          <button className="rd-btn rd-btn--primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          <button type="button" className="rd-btn" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Section>
  );
}

/** One row with its actions. Also used by the Money tab (compact). */
export function BillRow({ bill, onChanged, onEdit, compact = false }) {
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useConfirm();
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); changed(); onChanged(); } catch (e) { toast.error(errorMessage(e, "That did not work.")); } finally { setBusy(false); } };
  const pay = async () => {
    const res = await ask({ title: "Mark as paid", message: `${bill.name}: the money goes out as an expense in Money. Amount (₹):`, confirmLabel: "Mark paid", input: { defaultValue: bill.amount != null ? String(bill.amount) : "", placeholder: "Amount paid" } });
    if (res === null || res === undefined || res === false) return;
    const amount = typeof res === "string" ? res : bill.amount;
    run(() => payBill(bill.id, { amount, date: todayLocal() }), "Marked paid and added to Money.");
  };
  const remove = async () => { if (await ask({ title: "Delete bill", message: `Delete "${bill.name}"? Its Money entry (if any) stays.`, confirmLabel: "Delete", danger: true })) run(() => deleteBill(bill.id), "Deleted."); };
  const tone = TONE[bill.state] || "";
  return (
    <li className={"bl-item" + (tone ? " is-" + tone : "")}>
      <div className="bl-main">
        <b>{bill.name}</b>
        <span className={"bl-when" + (tone ? " is-" + tone : "")}>{whenWord(bill)}</span>
        <small>Due {bill.dueDate}{bill.billDate ? ` · billed ${bill.billDate}` : ""}{bill.repeat ? " · monthly" : ""}{!compact && bill.account ? ` · No. ${bill.account}` : ""}</small>
        {!compact && bill.notes ? <small>{bill.notes}</small> : null}
      </div>
      <div className="bl-amt">{bill.amount != null ? inr(bill.amount) : "amount ?"}</div>
      <div className="bl-actions">
        {bill.status === "unpaid"
          ? <button className="rd-btn rd-btn--primary" disabled={busy} onClick={pay}>Mark paid</button>
          : <button className="rd-btn" disabled={busy} onClick={() => run(() => unpayBill(bill.id), "Back to unpaid; the Money entry was removed.")}>Undo</button>}
        {!compact && bill.status === "unpaid" && <button className="rd-btn" disabled={busy} onClick={() => onEdit(bill)}>Edit</button>}
        {!compact && <button className="rd-btn rd-btn--danger-quiet" disabled={busy} onClick={remove}>Delete</button>}
      </div>
      {dialog}
    </li>
  );
}

export default function Bills() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);       // null | {} (new) | a bill
  const [days, setDays] = useState(bannerDays());
  const load = useCallback(() => getBills(days).then((d) => { setData(d); setError(""); }).catch((e) => setError(errorMessage(e, "Could not load your bills."))), [days]);
  useEffect(() => { load(); }, [load]);

  const unpaid = (data?.bills || []).filter((b) => b.status === "unpaid");
  const paid = (data?.bills || []).filter((b) => b.status === "paid").sort((a, b) => (b.paidAt || "").localeCompare(a.paidAt || "")).slice(0, 12);
  return (
    <main className="bl-page">
      <header className="bl-head">
        <div><h1>My bills</h1><p className="bl-dim">Due dates in one place. A banner at the top of Stashr (and a Telegram note once a day) warns you before a bill is late. Paying a bill adds it to Money.</p></div>
        {!editing && <button className="rd-btn rd-btn--primary" onClick={() => setEditing({})}>Add a bill</button>}
      </header>
      {error && <p className="bl-bad" role="alert">{error}</p>}
      {editing && <BillForm initial={editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
      {!data ? <Skeleton lines={4} /> : (
        <>
          <Section title={`To pay (${unpaid.length})`} subtitle="Soonest due date first."
            actions={<label className="bl-days">Warn me <select value={days} onChange={(e) => { const n = Number(e.target.value); setBannerDays(n); setDays(n); changed(); }}>{[1, 2, 3, 5, 7, 10].map((n) => <option key={n} value={n}>{n} day{n > 1 ? "s" : ""}</option>)}</select> before</label>}>
            {unpaid.length ? <ul className="bl-list">{unpaid.map((b) => <BillRow key={b.id} bill={b} onChanged={load} onEdit={setEditing} />)}</ul> : <p className="bl-dim">No unpaid bills. Add one with the button above.</p>}
          </Section>
          {paid.length > 0 && <Section title="Paid lately"><ul className="bl-list">{paid.map((b) => <BillRow key={b.id} bill={b} onChanged={load} onEdit={setEditing} />)}</ul></Section>}
        </>
      )}
    </main>
  );
}
