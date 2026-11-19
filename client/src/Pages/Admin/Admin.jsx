import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { deleteAdminUser, getAdminUsers, setUserFeature, errorMessage } from "../../api/client";
import "./Admin.css";
import { useDialogs } from "../../Components/UI/Dialogs";

const when = (v) => (v ? new Date(v).toLocaleDateString() : "");

export default function Admin() {
  const { prompt } = useDialogs();
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (query) => {
    try { setData(await getAdminUsers(query)); setError(""); }
    catch (e) { setError(errorMessage(e, "Could not load users.")); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(q), 250); return () => clearTimeout(t); }, [q, load]);

  const remove = async (user) => {
    const typed = await prompt({ title: `Delete ${user.email}?`, message: "This permanently deletes the account and every record of theirs: passwords, projects, connected accounts, Smart home data and sign-ins. It cannot be undone.", label: "Their email address", match: user.email, confirmLabel: "Delete account", tone: "danger", maxLength: 320 });
    if (typed === null) return;
    setBusy("del" + user.id);
    try {
      await deleteAdminUser(user.id, typed);
      setData((d) => ({ ...d, users: (d?.users || []).filter((u) => u.id !== user.id), total: Math.max(0, (d?.total || 1) - 1) }));
      toast.success(`${user.email} and all their records were deleted.`);
    } catch (e) { toast.error(errorMessage(e, "Could not delete that user.")); }
    finally { setBusy(""); }
  };

  const toggleable = (data?.features || []).filter((f) => !f.locked);
  const locked = (data?.features || []).filter((f) => f.locked);

  const set = async (user, feature, enabled) => {
    const id = user.id + feature.key;
    setBusy(id);
    try {
      const res = await setUserFeature(user.id, feature.key, enabled);
      setData((d) => ({ ...d, users: (d?.users || []).map((u) => (u.id === user.id ? res.user : u)) }));
    } catch (e) { toast.error(errorMessage(e, "Could not change that.")); }
    finally { setBusy(""); }
  };

  return (
    <main className="admin page"><div className="shell">
      <header className="admin__head">
        <p className="eyebrow">Admin</p>
        <h1>Users and features</h1>
        <p className="admin__lede">Choose which parts of Stashr each person sees. A box that is ticked means that person has the feature. A dot marks a setting you changed; click it to go back to the default.</p>
      </header>

      {error ? <p className="admin__error">{error}</p> : null}

      <section className="card admin__card">
        <div className="admin__bar">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email" />
          <span className="admin__count">{data ? `${(data.users || []).length} of ${data.total ?? 0} users` : "Loading…"}</span>
        </div>
        <div className="admin__scroll">
          <table className="admin__table">
            <thead>
              <tr><th>User</th><th>Delete</th>{toggleable.map((f) => <th key={f.key} title={f.description}>{f.label}<small>{f.audience === "admin" ? "default: admin" : "default: everyone"}</small></th>)}</tr>
            </thead>
            <tbody>
              {(data?.users || []).map((u) => (
                <tr key={u.id}>
                  <td className="admin__user"><strong>{u.email}</strong><small>{u.name || "No name"}{u.isAdmin ? " · admin" : ""}{u.createdAt ? ` · joined ${when(u.createdAt)}` : ""}</small></td>
                  <td className="admin__cell">{u.isAdmin ? <small>admin</small> : <button type="button" className="btn btn--sm" disabled={busy === "del" + u.id} onClick={() => void remove(u)}>Delete</button>}</td>
                  {toggleable.map((f) => {
                    const custom = typeof u.overrides?.[f.key] === "boolean";
                    return (
                      <td key={f.key} className="admin__cell">
                        <input type="checkbox" aria-label={`${f.label} for ${u.email}`} checked={Boolean(u.features[f.key])} disabled={busy === u.id + f.key} onChange={(e) => void set(u, f, e.target.checked)} />
                        {custom ? <button type="button" className="admin__dot" title="Changed from the default. Click to reset." onClick={() => void set(u, f, null)} /> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {data && (data.users || []).length === 0 ? <p className="admin__empty">No users match.</p> : null}
        </div>
      </section>

      <section className="card admin__card">
        <h2>What each feature is</h2>
        <ul className="admin__features">
          {(data?.features || []).map((f) => (
            <li key={f.key}><strong>{f.label}</strong><span>{f.description}</span><em>{f.locked ? "Administrators only, fixed" : f.audience === "admin" ? "Admin by default, can be granted" : "Everyone by default, can be turned off"}</em></li>
          ))}
        </ul>
        {locked.length ? <p className="admin__note">Administrators are set on the server (REGISTRY_ADMINS), not here.</p> : null}
      </section>
    </div></main>
  );
}
