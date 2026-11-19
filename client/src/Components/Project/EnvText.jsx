import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { parseEnvBlock } from "../../lib/projectItems";
import { envToText } from "../../lib/envText";
import { Copy } from "../Icons/Icons";

/**
 * All variables as one text block, editable as a whole. Opens closed (it is a long list); "Apply text" replaces
 * the variables with what is in the box, so you can paste a whole .env and add, edit or delete in one go.
 */
export default function EnvText({ rows, onChange, idPrefix = "env", flushRef = null }) {
  const [text, setText] = useState(() => envToText(rows));
  const [dirty, setDirty] = useState(false);
  // Keep the box in step with the rows when they change elsewhere (and the user has not typed).
  useEffect(() => { if (!dirty) setText(envToText(rows)); }, [rows, dirty]);

  // The form's Save asks for what is typed but not applied yet, so pressing Save never silently drops it. null = nothing pending.
  if (flushRef) flushRef.current = () => {
    if (!dirty) return null;
    const byName = new Map();
    for (const row of parseEnvBlock(text)) byName.set(row.name, { name: row.name, value: row.value });
    return Array.from(byName.values());
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(envToText(rows)); toast.success("All variables copied."); }
    catch { toast.error("Clipboard is not available."); }
  };
  const apply = () => {
    const parsed = parseEnvBlock(text);
    const byName = new Map();
    for (const row of parsed) byName.set(row.name, { name: row.name, value: row.value });
    onChange(Array.from(byName.values()));
    setDirty(false);
    toast.success(parsed.length + " variable" + (parsed.length === 1 ? "" : "s") + " saved from the text.");
  };

  return (
    <details className="envtext">
      <summary>Edit all variables as text <small>({(rows || []).filter((r) => r.name).length})</small></summary>
      <p className="field__note">One <code>NAME=value</code> per line. Paste a whole <code>.env</code> here, then press Apply. Lines starting with # are ignored.</p>
      <textarea
        id={idPrefix + "-text"}
        className="input envtext__box"
        rows={Math.min(14, Math.max(4, (rows || []).length + 2))}
        spellCheck="false"
        aria-label="All environment variables as text"
        value={text}
        onChange={(e) => { setText(e.target.value); setDirty(true); }}
      />
      <div className="gh-panel__row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copy()}><Copy size={13} /> Copy all</button>
        <button type="button" className="btn btn--primary btn--sm" onClick={apply} disabled={!dirty}>Apply text</button>
        {dirty ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setText(envToText(rows)); setDirty(false); }}>Discard edits</button> : null}
      </div>
    </details>
  );
}
