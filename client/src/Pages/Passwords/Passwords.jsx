import { fx } from "../../lib/fx";
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import useShortcuts from "../../hooks/useShortcuts";
import ServiceStatus from "../../Components/ServiceStatus/ServiceStatus";
import VaultHealth from "../../Components/VaultHealth/VaultHealth";
import ItemCard from "../../Components/Item/ItemCard";
import ItemEditor from "../../Components/Item/ItemEditor";
import ImportModal from "../../Components/Item/ImportModal";
import VaultSidebar from "../../Components/Vault/VaultSidebar";
import { IcTrash } from "../../Components/Vault/VaultIcons";
import VaultBackdrop from "../../Components/Vault/VaultBackdrop";
import { KeyLine, Plus, Search, Upload, Arrow, LockLine, Alert } from "../../Components/Icons/Icons";
import { PageHeader, EmptyState } from "../../Components/UI/ui";
import { useDialogs } from "../../Components/UI/Dialogs";
import { useVault } from "../../state/vault";
import { SECTIONS, isBuiltinSection, visibleItems, sectionCounts, folderNames, securityStatus } from "../../lib/vaultView";
import "./Passwords.css";
import "../../Components/Vault/Vault.css";

import MascotBanner from "../../Components/Robot/MascotBanner";
import { vaultMood } from "../../lib/pageMoods";

const SECTION_TITLES = {
  __all: "All items",
  __logins: "Logins",
  __fav: "Favourites",
  __note: "Secure notes",
  __card: "Cards",
  __identity: "Identities",
  __trash: "Trash",
};
const HEALTH_FILTERS = ["weak", "reused", "breached", "old", "strong"];

const HEALTH_LABELS = { strong: "Strong", weak: "Weak", reused: "Reused", breached: "Breached", old: "Older than 6 months" };

export default function Passwords() {
  const {
    items, broken, health, breaches, breachProgress, prefs,
    addItem, updateItem, deleteItem, purgeItem, restoreItem, emptyTrash, trash, toggleFavorite, importItems, runBreachCheck, lock,
  } = useVault();

  const [params, setParams] = useSearchParams();
  const { confirm, prompt } = useDialogs();
  const [search, setSearch] = useState(() => params.get("q") || "");
  const [filter, setFilter] = useState(() => (HEALTH_FILTERS.includes(params.get("filter")) ? params.get("filter") : "all")); // health filter
  const [folder, setFolder] = useState(() => (Object.values(SECTIONS).includes(params.get("section")) ? params.get("section") : SECTIONS.all)); // sidebar section: __all | __logins | __fav | __note | __card | __identity | __trash | <folder>
  const [sort, setSort] = useState("recent");
  const [editing, setEditing] = useState(() => (params.get("new") === "1" ? "new" : null)); // null | "new" | item
  const searchRef = useShortcuts(() => setEditing("new"));
  const [importing, setImporting] = useState(() => params.get("import") === "1");

  /* Links from the overview and the command palette (?new=1, ?import=1, ?filter=, ?section=) open the matching view once. */
  useEffect(() => {
    const q = params.get("q");
    if (q !== null) setSearch(q);
    if (params.get("new") === "1") setEditing("new");
    if (params.get("import") === "1") setImporting(true);
    if (HEALTH_FILTERS.includes(params.get("filter"))) setFilter(params.get("filter"));
    if (Object.values(SECTIONS).includes(params.get("section"))) setFolder(params.get("section"));
    if (params.has("new") || params.has("import")) {
      const next = new URLSearchParams(params);
      next.delete("new"); next.delete("import");
      setParams(next, { replace: true });
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const [breachChecked, setBreachChecked] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const toggleSelect = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); };
  /* Runs one action over every selected id; reports how many worked so a partial failure is never silent. */
  const runBulk = async (label, fn) => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy(true);
    const results = await Promise.allSettled(ids.map(fn));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    setBusy(false);
    if (ok === ids.length) toast.success(`${label}: ${ok} item${ok === 1 ? "" : "s"}.`);
    else toast.error(`${label}: ${ok} of ${ids.length} worked, ${ids.length - ok} failed.`);
    setSelected(new Set(results.flatMap((r, i) => (r.status === "rejected" ? [ids[i]] : []))));
  };
  const bulkFavorite = (value) => runBulk(value ? "Favourited" : "Unfavourited", (id) => updateItem(id, { favorite: value }));
  const bulkMove = async () => {
    const name = await prompt({
      title: `Move ${selected.size} item${selected.size === 1 ? "" : "s"}`,
      message: folders.length ? `Existing folders: ${folders.join(", ")}` : "Type a folder name to create it.",
      label: "Folder (leave empty for no folder)",
      defaultValue: isBuiltinSection(folder) ? "" : folder,
      confirmLabel: "Move",
      allowEmpty: true,
    });
    if (name === null) return;
    return runBulk("Moved", (id) => updateItem(id, { folder: name.trim() }));
  };
  const bulkDelete = async () => {
    const n = selected.size;
    if (!(await confirm({ title: `Move ${n} item${n === 1 ? "" : "s"} to Trash?`, message: "You can restore them from Trash for 30 days.", confirmLabel: "Move to Trash", tone: "danger" }))) return;
    return runBulk("Moved to Trash", (id) => deleteItem(id));
  };
  const renameFolder = async () => {
    const name = await prompt({ title: `Rename “${folder}”`, message: "Using the name of an existing folder merges the two.", label: "New folder name", defaultValue: folder, confirmLabel: "Rename" });
    if (name === null || !name.trim() || name.trim() === folder) return;
    const target = name.trim();
    const ids = items.filter((i) => i.folder === folder).map((i) => i.id);
    setBusy(true);
    const results = await Promise.allSettled(ids.map((id) => updateItem(id, { folder: target })));
    setBusy(false);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) toast.error(`${failed} item${failed === 1 ? "" : "s"} could not be moved.`);
    else { toast.success(`Folder is now "${target}".`); setFolder(target); }
  };
  const trashOne = async (item) => {
    if (!(await confirm({ title: `Move “${item.name || "this item"}” to Trash?`, message: "You can restore it from Trash for 30 days.", confirmLabel: "Move to Trash", tone: "danger" }))) return;
    try {
      await deleteItem(item.id);
      toast.success("Moved to Trash. You can restore it for 30 days.");
    } catch (e) {
      toast.error("Couldn't move that to Trash.");
    }
  };

  const folders = useMemo(() => folderNames(items), [items]);
  const counts = useMemo(() => sectionCounts(items, trash), [items, trash]);

  /* A folder that disappeared (renamed elsewhere, last item deleted) falls back to Overview. */
  useEffect(() => {
    if (!isBuiltinSection(folder) && !folders.includes(folder)) setFolder(SECTIONS.all);
  }, [folder, folders]);

  const visible = useMemo(
    () => visibleItems({ items, trash, section: folder, search, filter, sort, info: health.info }),
    [items, trash, search, filter, folder, sort, health]
  );

  const checkBreaches = async () => {
    try {
      const found = await runBreachCheck();
      setBreachChecked(true);
      if (found) {
        toast.error(`${found} password${found === 1 ? " was" : "s were"} found in data breaches.`);
        fx.emit("boom", { big: true });
        setFilter("breached");
      } else toast.success("None of your passwords appear in known breaches.");
    } catch (err) {
      toast.error(err.message);
    }
  };

  /* Opt-in weekly check (Settings): runs quietly and only speaks up when something was found. */
  useEffect(() => {
    if (!prefs.autoBreach || !items.length || breachProgress) return;
    let last = 0;
    try { last = Number(localStorage.getItem("stashr_breach_at") || 0); } catch (e) { /* private mode */ }
    if (Date.now() - last < 7 * 86400000) return;
    try { localStorage.setItem("stashr_breach_at", String(Date.now())); } catch (e) { /* private mode */ }
    runBreachCheck()
      .then((found) => { if (found) toast.error(`Weekly check: ${found} password${found === 1 ? " was" : "s were"} found in data breaches.`); })
      .catch(() => { try { localStorage.removeItem("stashr_breach_at"); } catch (e) { /* private mode */ } });
  }, [prefs.autoBreach, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveItem = async (form) => {
    if (editing === "new") {
      await addItem(form);
      toast.success("Encrypted and saved ✨");
      fx.emit("land");
    } else {
      await updateItem(editing.id, form);
      toast.success("Updated and re-encrypted.");
      fx.emit("land");
    }
  };

  const checked = breachChecked || Object.keys(breaches).length > 0;
  const status = securityStatus(health, checked);
  const inTrash = folder === SECTIONS.trash;
  const sectionTitle = SECTION_TITLES[folder] || folder;
  const pickSection = (id) => { setFolder(id); if (id === SECTIONS.trash) stopSelecting(); };

  const headerSub = items.length === 0
    ? "Nothing saved yet. Every item is encrypted before it is stored."
    : `${items.length} item${items.length === 1 ? "" : "s"} · encrypted at rest`;

  return (
    <div className="vault vx page">
      <div className="vx__shell">
        <div className="vx-head vx-head--v2">
          <VaultBackdrop />
          <p className="vx-board" aria-label={`Security status: ${status.label}`}>
            <span className="vx-board__cell vx-hide-sm">Gate</span>
            <span className="vx-board__cell vx-board__cell--strong">Vault</span>
            <span className={`vx-board__status is-${status.tone}`}><i aria-hidden="true" />{status.label}</span>
            {health.total ? <span className="vx-board__cell">Score {health.score}</span> : null}
          </p>
        <PageHeader
          title="Passwords"
          subtitle={
            <>
              {headerSub}
            </>
          }
          actions={
            <>
              <ServiceStatus />
              <button type="button" className="btn btn--quiet btn--sm" onClick={lock} title="Lock now">
                <LockLine size={14} /> Lock
              </button>
            </>
          }
        />
        </div>

        <div className="vx-tools">
          <div className="vx-search">
            <span className="vx-search__icon"><Search size={17} /></span>
            <input
              className="input vx-search__input"
              type="search"
              ref={searchRef}
              placeholder="Search names, usernames, websites, notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search your vault"
              aria-keyshortcuts="/"
            />
            <kbd className="kbd vx-search__kbd" aria-hidden="true">/</kbd>
          </div>
          <div className="vx-tools__actions">
            <button className="btn btn--primary vx-add" onClick={() => setEditing("new")} aria-keyshortcuts="n">
              <Plus size={15} /> Add item <kbd className="kbd">N</kbd>
            </button>
          </div>
        </div>

        {broken ? (
          <div className="notice notice--err vault__notice">
            <Alert size={15} /> {broken} item{broken === 1 ? "" : "s"} couldn't be decrypted with this key and {broken === 1 ? "is" : "are"} hidden.
          </div>
        ) : null}

        <div className="vx-layout">
          <aside className="vx-side">
            <VaultSidebar section={folder} onSelect={pickSection} counts={counts} folders={folders} />
          </aside>

          <main className="vx-main" aria-label={sectionTitle}>
            {folder === SECTIONS.all && !search && items.length ? (
              <VaultHealth
                insights={health}
                loading={false}
                filter={filter}
                onFilter={setFilter}
                onBreachCheck={items.length ? checkBreaches : null}
                breachProgress={breachProgress}
                breachChecked={checked}
              />
            ) : null}

            <div className="vx-bot">
              <MascotBanner kind="safe" {...vaultMood(health, items.length)} stats={[]} />
            </div>

            <div className="vx-list-head">
              <div className="vx-list-head__title">
                <h2>{sectionTitle}</h2>
                <span className="vx-list-head__count">{visible.length} {visible.length === 1 ? "item" : "items"}</span>
                {filter !== "all" && !inTrash ? (
                  <button type="button" className="vx-tag" onClick={() => setFilter("all")} aria-label={`Remove filter ${HEALTH_LABELS[filter]}`}>
                    {HEALTH_LABELS[filter]} <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {!isBuiltinSection(folder) ? (
                  <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={renameFolder}>Rename or merge</button>
                ) : null}
              </div>
              {!inTrash ? (
                <div className="vx-list-head__tools">
                  <select className="input vx-sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
                    <option value="recent">Recently updated</option>
                    <option value="az">A → Z</option>
                    <option value="weakest">Weakest first</option>
                  </select>
                  <button className="btn btn--ghost btn--sm" onClick={() => setImporting(true)}>
                    <Upload size={14} /> Import
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting}>
                    {selecting ? "Done" : "Select"}
                  </button>
                </div>
              ) : null}
            </div>

            {selecting && !inTrash ? (
              <div className="bulkbar vx-bulk" role="toolbar" aria-label="Bulk actions">
                <strong>{selected.size} selected</strong>
                <button className="btn btn--quiet btn--sm" onClick={() => setSelected(new Set(visible.map((i) => i.id)))}>Select all {visible.length}</button>
                <button className="btn btn--quiet btn--sm" disabled={busy || !selected.size} onClick={() => bulkFavorite(true)}>Favourite</button>
                <button className="btn btn--quiet btn--sm" disabled={busy || !selected.size} onClick={() => bulkFavorite(false)}>Unfavourite</button>
                <button className="btn btn--quiet btn--sm" disabled={busy || !selected.size} onClick={bulkMove}>Move to folder…</button>
                <button className="btn btn--quiet btn--sm" disabled={busy || !selected.size} onClick={bulkDelete}>Delete</button>
              </div>
            ) : null}

            {inTrash && trash.length ? (
              <p className="vx-trash-note">
                <IcTrash size={15} /> Deleted items stay here for 30 days.
                <button type="button" className="btn btn--quiet btn--sm vx-danger" disabled={busy} onClick={async () => {
                  if (!(await confirm({ title: `Permanently delete ${trash.length} item${trash.length === 1 ? "" : "s"}?`, message: "Items in Trash are erased for good. This cannot be undone.", confirmLabel: "Empty Trash", tone: "danger" }))) return;
                  try { await emptyTrash(); toast.success("Trash emptied."); fx.emit("boom", { big: true }); setFolder(SECTIONS.all); } catch (e) { toast.error(e.message); }
                }}>Empty trash</button>
              </p>
            ) : null}

            {items.length === 0 && !inTrash ? (
              <EmptyState
                icon={<KeyLine size={24} />}
                title="Your vault is empty"
                actions={
                  <>
                    <button className="btn btn--primary" onClick={() => setEditing("new")}>Add your first item <Arrow size={15} /></button>
                    <button className="btn btn--ghost" onClick={() => setImporting(true)}><Upload size={15} /> Import a CSV</button>
                  </>
                }
              >
                Add a login, card, note or identity, or import everything from your browser or another password manager.
              </EmptyState>
            ) : visible.length === 0 ? (
              <EmptyState
                compact
                icon={inTrash ? <IcTrash size={22} /> : <Search size={22} />}
                title={search ? <>Nothing matches “{search}”</> : inTrash ? "Trash is empty" : "Nothing here"}
                actions={inTrash && !search ? null : <button className="btn btn--ghost" onClick={() => { setSearch(""); setFilter("all"); setFolder(SECTIONS.all); }}>Clear search and filters</button>}
              >
                {inTrash && !search ? "Items you delete wait here for 30 days." : filter !== "all" && !search ? "Good news: nothing needs attention in this view." : "Try another word, or search across all sections."}
              </EmptyState>
            ) : inTrash ? (
              <ul className="vx-trash">
                {visible.map((item) => (
                  <li className="vx-trash__row" key={item.id}>
                    <div className="vx-trash__id">
                      <strong>{item.name || "Untitled"}</strong>
                      <small>{item.username ? `${item.username} · ` : ""}deleted {new Date(item.deletedAt).toLocaleDateString()}</small>
                    </div>
                    <span className="vx-trash__acts">
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => restoreItem(item.id).then(() => { toast.success("Restored."); fx.emit("land"); }).catch(() => toast.error("Couldn't restore that."))}>Restore</button>
                      <button type="button" className="btn btn--quiet btn--sm vx-danger" onClick={async () => { if (await confirm({ title: `Delete “${item.name || "this item"}” forever?`, message: "This cannot be undone.", confirmLabel: "Delete forever", tone: "danger" })) purgeItem(item.id).then(() => { toast.success("Deleted for good."); fx.emit("boom"); }).catch(() => toast.error("Couldn't delete that.")); }}>Delete forever</button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="vx-grid">
                {visible.map((item, i) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    info={health.info[item.id]}
                    icons={prefs.icons}
                    onEdit={() => setEditing(item)}
                    onTrash={() => trashOne(item)}
                    selecting={selecting}
                    selected={selected.has(item.id)}
                    onSelect={() => toggleSelect(item.id)}
                    onFavorite={() => toggleFavorite(item.id).catch(() => toast.error("Couldn't update that."))}
                    style={{ animationDelay: `${Math.min(i, 10) * 0.03}s` }}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      <ItemEditor
        open={Boolean(editing)}
        item={editing && editing !== "new" ? editing : null}
        folders={folders}
        icons={prefs.icons}
        onClose={() => setEditing(null)}
        onSave={saveItem}
        onDelete={async () => {
          await deleteItem(editing.id);
          toast.success("Moved to Trash. You can restore it for 30 days.");
        }}
      />
      <ImportModal open={importing} onClose={() => setImporting(false)} onImport={importItems} existing={[...items, ...(trash || [])]} />
    </div>
  );
}
