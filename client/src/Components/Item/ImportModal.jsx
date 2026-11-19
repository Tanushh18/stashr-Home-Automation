import React, { useRef, useState } from "react";
import { Modal } from "react-responsive-modal";
import { toast } from "react-toastify";
import Field from "../Field/Field";
import { parseCSV, rowsToItems, normalizeItem, splitDuplicates } from "../../lib/items";
import { importBackup } from "../../lib/crypto";
import { Upload, Check } from "../Icons/Icons";

/**
 * Import from an Stashr encrypted backup, CSV (Chrome, Bitwarden, 1Password,
 * LastPass…) or an Excel sheet. Everything is parsed and encrypted in the browser.
 */
export default function ImportModal({ open, onClose, onImport, existing = [] }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [backupText, setBackupText] = useState(null);
  const [backupPassword, setBackupPassword] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const reset = () => {
    setFile(null);
    setBackupText(null);
    setBackupPassword("");
    setPreview(null);
    setProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    reset();
    onClose();
  };

  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    reset();
    setFile(f);
    try {
      const name = f.name.toLowerCase();
      if (name.endsWith(".json") || name.endsWith(".aurelia")) {
        setBackupText(await f.text());
        return;
      }
      if (name.endsWith(".csv")) {
        setPreview(rowsToItems(parseCSV(await f.text())));
        return;
      }
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      setPreview(rowsToItems(rows));
    } catch (err) {
      toast.error("We couldn't read that file.");
      reset();
    }
  };

  const unlockBackup = async () => {
    try {
      setBusy(true);
      const items = await importBackup(backupText, backupPassword);
      setPreview(items.map(normalizeItem));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Items already in the vault (or repeated in the file) are skipped: importing the same file twice must not double everything.
  const { fresh, duplicates } = preview ? splitDuplicates(preview, existing) : { fresh: [], duplicates: 0 };

  const run = async () => {
    try {
      setBusy(true);
      const n = fresh.length ? await onImport(fresh, (done, total) => setProgress({ done, total })) : 0;
      toast.success(`${n} item${n === 1 ? "" : "s"} imported and encrypted.` + (duplicates ? ` ${duplicates} already in your vault ${duplicates === 1 ? "was" : "were"} skipped.` : ""));
      close();
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} center classNames={{ modal: "sheet" }}>
      <div className="sheet__body">
        <span className="card__ribbon" />
        <div className="sheet__head">
          <span className="sheet__seal"><Upload size={22} /></span>
          <h2 className="sheet__title">Import passwords</h2>
          <p className="sheet__sub">Stashr backups, CSV exports from Chrome, Bitwarden, 1Password or LastPass, or an Excel sheet.</p>
        </div>

        <label className="dropzone">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.json,.aurelia" onChange={pick} hidden />
          <Upload size={20} />
          <span>{file ? file.name : "Choose a file"}</span>
          <small>Nothing leaves your browser unencrypted.</small>
        </label>

        {backupText && !preview ? (
          <div className="import__backup">
            <Field id="imp-pass" label="Backup password" secret value={backupPassword} onChange={(e) => setBackupPassword(e.target.value)} autoFocus />
            <button type="button" className="btn btn--primary btn--block" onClick={unlockBackup} disabled={!backupPassword || busy}>
              {busy ? <span className="spinner" /> : null} Open backup
            </button>
          </div>
        ) : null}

        {preview ? (
          <div className="import__preview">
            <p>
              <strong>{preview.length}</strong> item{preview.length === 1 ? "" : "s"} found
              {preview.length ? `: ${preview.slice(0, 4).map((i) => i.name || "Untitled").join(", ")}${preview.length > 4 ? "…" : ""}` : "."}
            </p>
            {duplicates ? <p className="field__note">{duplicates} {duplicates === 1 ? "is" : "are"} already in your vault and will be skipped, so nothing is doubled.</p> : null}
            {progress ? (
              <div className="progress"><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            ) : null}
            <button type="button" className="btn btn--primary btn--block" onClick={run} disabled={!fresh.length || busy}>
              <span className="btn__sheen" />
              {busy ? <span className="spinner" /> : <Check size={15} />}
              {busy ? "Encrypting…" : fresh.length ? `Import ${fresh.length} item${fresh.length === 1 ? "" : "s"}` : "Nothing new to import"}
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
