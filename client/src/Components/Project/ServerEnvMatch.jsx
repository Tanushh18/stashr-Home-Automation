import React, { useEffect, useState } from "react";
import { Modal } from "react-responsive-modal";
import "react-responsive-modal/styles.css";
import { toast } from "react-toastify";
import { syncGroupEnv } from "../../api/client";
import { errorMessage } from "../../Pages/Render/renderUtils";

const list = (names) => (names?.length ? names.slice(0, 8).join(", ") + (names.length > 8 ? " +" + (names.length - 8) : "") : "—");

/**
 * Makes every server of THIS project (one service, on any host) carry the same env. The server with the most variables is
 * the reference; a variable only another server has is added to it too. Servers of other projects are never touched.
 * Names and counts only: nothing is written until "Sync all".
 */
export default function ServerEnvMatch({ projectId, open, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [overwrite, setOverwrite] = useState(true);
  const [deploy, setDeploy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);

  const load = async () => {
    setBusy(true); setErr(""); setResult(null);
    try { setPreview(await syncGroupEnv(projectId, { apply: false })); }
    catch (e) { setPreview(null); setErr(errorMessage(e, "Could not compare the servers.")); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (open) void load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = preview?.targets || [];
  const willWrite = rows.reduce((n, t) => n + t.create.length + (overwrite ? t.update.length : 0), 0);
  const apply = async () => {
    setBusy(true); setErr("");
    try {
      const r = await syncGroupEnv(projectId, { apply: true, overwrite, deploy });
      setResult(r);
      const written = r.results.reduce((n, x) => n + x.written, 0);
      toast.success(written ? `Wrote ${written} variable${written === 1 ? "" : "s"}.` : "Every server already matched.");
      onDone?.();
    } catch (e) { setErr(errorMessage(e, "Could not sync the variables.")); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} center classNames={{ modal: "sheet" }}>
      <div className="sheet__body">
        <div className="sheet__head">
          <h2 className="sheet__title">Sync env across this project’s servers</h2>
          <p className="sheet__sub">The server with the most variables is the reference. Only the servers of this project are changed, never other projects. Names and counts only.</p>
        </div>
        {busy && !preview ? <p className="field__note">Reading every server…</p> : null}
        {preview ? (
          <div>
            <p className="field__note">Reference: <strong>{preview.source.name}</strong> ({preview.source.count} variables) · {preview.total} variables once everything is merged</p>
            <div className="pdep__scroll">
              <table className="pdep__table">
                <thead><tr><th>Server</th><th>Missing</th><th>Different</th><th>Already same</th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.ref}>
                      <td><strong>{t.name}</strong>{t.isSource ? " (reference)" : ""}<div className="pdep__dim">{t.label}</div></td>
                      <td>{t.error ? <span className="pdep__err">{t.error}</span> : <><strong>{t.create.length}</strong><div className="pdep__dim">{list(t.create)}</div></>}</td>
                      <td>{t.error ? "" : <><strong>{t.update.length}</strong><div className="pdep__dim">{list(t.update)}</div></>}</td>
                      <td>{t.error ? "" : t.same}{t.unreadable?.length ? <div className="pdep__dim">{t.unreadable.length} hidden by host</div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="field__note" style={{ display: "block" }}><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} disabled={busy} /> Also replace values that differ (so all servers match exactly)</label>
            <label className="field__note" style={{ display: "block" }}><input type="checkbox" checked={deploy} onChange={(e) => setDeploy(e.target.checked)} disabled={busy} /> Then redeploy the servers that changed</label>
          </div>
        ) : null}
        {err ? <div className="notice notice--err" role="alert">{err}</div> : null}
        {result ? <ul className="field__note">{result.results.map((r) => <li key={r.ref}>{r.name}: {r.written} written{r.failed.length ? " · failed: " + list(r.failed) : ""}{r.deployed ? " · deploying" : ""}{r.error ? " · " + r.error : ""}</li>)}</ul> : null}
        <div className="gh-panel__row">
          <button type="button" className="btn btn--primary" disabled={busy || !preview || !willWrite || Boolean(result)} onClick={() => void apply()}>{busy && preview ? "Syncing…" : willWrite ? `Sync all (${willWrite} change${willWrite === 1 ? "" : "s"})` : "Everything already matches"}</button>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
