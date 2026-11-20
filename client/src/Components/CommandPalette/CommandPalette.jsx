import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useVault } from "../../state/vault";
import { buildEntries, rank } from "../../lib/palette";
import { useWorkspaceMode } from "../../three/immersive";
import "./CommandPalette.css";

const OPEN_EVENT = "stashr:palette";

/** Opens the palette from anywhere (sidebar search button, mobile top bar). */
export const openPalette = () => window.dispatchEvent(new Event(OPEN_EVENT));

/* Ctrl/Cmd+K opens a jump-to box for actions, pages, projects and vault items. Item results never include secrets. */
export default function CommandPalette() {
  const { status, items, projects, profile } = useVault();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const restoreRef = useRef(null);
  const listId = useId();
  const openRef = useRef(false);
  openRef.current = open;

  const { immersive, can3d, toggle: toggleWorkspace } = useWorkspaceMode();
  const entries = useMemo(() => {
    const base = buildEntries({ items, projects: projects || [], profile, signedIn: status === "ready" });
    if (!can3d || !base.length) return base;
    // Workspace switch: runs in place instead of navigating.
    const mode = {
      kind: "Action", to: "#workspace", hint: "Workspace view", run: toggleWorkspace,
      label: immersive ? "Switch to standard 2D workspace" : "Switch to immersive 3D workspace",
      haystack: "workspace view mode immersive 3d standard 2d switch toggle",
    };
    return [...base.slice(0, 4), mode, ...base.slice(4)];
  }, [items, projects, profile, status, can3d, immersive, toggleWorkspace]);
  const results = useMemo(() => rank(entries, query), [entries, query]);

  useEffect(() => {
    const show = () => {
      if (status !== "ready") return;
      restoreRef.current = document.activeElement;
      setOpen(true);
      setQuery("");
      setActive(0);
    };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        if (status !== "ready") return;
        e.preventDefault();
        if (openRef.current) setOpen(false); else show();
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, show);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_EVENT, show); };
  }, [status]);

  useEffect(() => {
    if (open) { inputRef.current?.focus(); return undefined; }
    restoreRef.current?.focus?.();
    return undefined;
  }, [open]);
  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;
  const go = (entry) => { if (!entry) return; setOpen(false); if (entry.run) { entry.run(); return; } restoreRef.current = null; navigate(entry.to); };
  const onInputKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
    else if (e.key === "Tab") e.preventDefault(); // focus stays in the palette while it is open
  };

  return (
    <div className="cmdk__scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Search and jump">
        <div className="cmdk__bar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
          <input
            ref={inputRef}
            className="cmdk__input"
            placeholder="Search passwords, projects, pages or actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-label="Search"
            autoComplete="off"
            spellCheck="false"
          />
          <kbd className="cmdk__esc">Esc</kbd>
        </div>
        <ul className="cmdk__list" role="listbox" id={listId} aria-label="Results">
          {results.map((r, i) => (
            <li key={r.kind + r.to + i} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? "is-active" : ""} onMouseEnter={() => setActive(i)} onClick={() => go(r)}>
              <span className={`cmdk__kind is-${r.kind.toLowerCase()}`}>{r.kind}</span><strong>{r.label}</strong><small>{r.hint}</small>
            </li>
          ))}
          {!results.length && <li className="cmdk__empty" role="presentation">Nothing matches “{query}”. Try a site name, username or page.</li>}
        </ul>
        <p className="cmdk__foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></p>
      </div>
    </div>
  );
}
