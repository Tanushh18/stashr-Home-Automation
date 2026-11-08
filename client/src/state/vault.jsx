import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api/client";
import { readMpin, clearMpin } from "../lib/mpin";
import { bootVerdict, bootDelay } from "../lib/errors";
import { normalizeItem, withHistory, trashExpired } from "../lib/items";
import { mergeDelta, createSseParser, reconnectDelay } from "../lib/sync";
import { normalizeProject } from "../lib/projectItems";
import { computeHealth } from "../lib/health";
import { pwnedCount } from "../lib/breach";

/**
 * Session + vault state for the website.
 *
 * status:
 *   "checking"  – asking the server who we are
 *   "signedOut" – no session
 *   "ready"     – signed in, items loaded
 *
 * Items and projects are encrypted with the server's own key, not with
 * anything derived from the account password, so there is no separate
 * unlock step: signing in is enough to see everything.
 */

const VaultContext = createContext(null);
const PREFS_KEY = "aurelia_prefs";
// The jungle/robot/river theme is on by default; Settings → Appearance can switch to the plain look.
const DEFAULT_PREFS = { icons: false, searchValues: true, autoBreach: false, fx: true, jungle: true };

const readPrefs = () => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch (e) {
    return DEFAULT_PREFS;
  }
};

const SYNC_MS = 60 * 1000;            // passwords + projects re-read from the server while the tab is visible
// Cheap fingerprint of the lists, so an unchanged background sync does not re-render everything.
const signature = (list) => (list || []).map((e) => e._id + ":" + (e.updatedAt || "")).join("|");

const toItem = (entry) => ({ ...normalizeItem(entry), id: entry._id, createdAt: entry.createdAt, updatedAt: entry.updatedAt });
const toProject = (entry) => ({ ...normalizeProject(entry), id: entry._id, createdAt: entry.createdAt, updatedAt: entry.updatedAt });

export function VaultProvider({ children }) {
  const [status, setStatus] = useState("checking");
  const [profile, setProfile] = useState(null); // /authenticate payload minus entries
  const [allItems, setItems] = useState([]); // live items plus trashed ones (deletedAt set)
  const items = useMemo(() => allItems.filter((i) => !i.deletedAt), [allItems]);
  const trash = useMemo(() => allItems.filter((i) => i.deletedAt), [allItems]);
  const [breaches, setBreaches] = useState({});
  const [breachProgress, setBreachProgress] = useState(null);
  const [prefs, setPrefsState] = useState(readPrefs);
  const [projects, setProjects] = useState([]);

  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch (e) {
        /* private mode */
      }
      return next;
    });
  }, []);

  const lastSig = useRef({ items: null, projects: null });
  const loadProfile = useCallback(async () => {
    const res = await api.checkAuthenticated().catch((e) => { console.warn("[stashr] /authenticate failed", { status: e?.response?.status, error: e?.response?.data?.error, server: api.API_URL(), code: e?.code }); throw e; });
    const { passwords, projects: projectEntries, ...rest } = res.data;
    setProfile(rest);
    const itemsSig = signature(passwords), projectsSig = signature(projectEntries);
    if (itemsSig !== lastSig.current.items) { lastSig.current.items = itemsSig; setItems((passwords || []).map(toItem)); }
    if (projectsSig !== lastSig.current.projects) { lastSig.current.projects = projectsSig; setProjects((projectEntries || []).map(toProject)); }
    return rest;
  }, []);

  /* ── Boot: a saved session is only dropped when the server says it is invalid (401). A sleeping server or a network
        error says nothing about the session, so keep it and try again instead of showing the sign-in page. ── */
  const [waking, setWaking] = useState(false);
  useEffect(() => {
    let cancelled = false, timer = null, attempt = 0;
    const run = () => {
      loadProfile()
        .then(() => { if (!cancelled) { setWaking(false); setStatus("ready"); } })
        .catch((error) => {
          if (cancelled) return;
          if (bootVerdict(error, attempt) === "signedOut") { if (error?.response?.status === 401) api.setBearer(""); setWaking(false); setStatus("signedOut"); return; }
          setWaking(true);
          timer = window.setTimeout(run, bootDelay(attempt));
          attempt += 1;
        });
    };
    run();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [loadProfile]);

  const clearVault = useCallback(() => {
    lastSig.current = { items: null, projects: null };
    purgedOnce.current = false;
    setItems([]);
    setBreaches({});
    setProjects([]);
  }, []);

  /* ── Sign in / up ── */
  /* Once the server has accepted a sign-in (password or MPIN): load the profile, falling back to the token when the browser blocks the cookie. */
  const finishLogin = useCallback(
    async (loginResponse) => {
      console.info("[stashr] login accepted by", api.API_URL());
      // Keep the sign-in token in the browser too, so every server (not only the one that signed us in) knows who we are.
      const loginToken = loginResponse?.data?.token;
      api.setBearer(loginToken || "");
      try {
        try {
          await loadProfile();
        } catch (first) {
          // The browser did not keep the session cookie (cross-site cookies blocked): use the token instead.
          const token = loginResponse?.data?.token;
          if (first?.response?.status !== 401 || !token) throw first;
          console.warn("[stashr] the browser blocked the session cookie, using the token fallback");
          api.setBearer(token);
          await loadProfile();
        }
      } catch (e) {
        api.setBearer("");
        console.error("[stashr] login worked but the session check failed", { status: e?.response?.status, data: e?.response?.data, server: api.API_URL(), message: e?.message });
        const error = new Error(e?.response?.status === 401
          ? "Signed in, but the browser did not keep the session. Allow third-party cookies / cross-site cookies for this site, then try again."
          : api.errorMessage(e, "Signed in, but your vault could not be loaded."));
        error.kind = !e?.response ? "network" : e.response.status >= 500 ? "server" : "other";
        throw error;
      }
      setStatus("ready");
      return { ok: true };
    },
    [loadProfile]
  );

  const login = useCallback(
    async (email, password, code) => {
      let loginResponse = null;
      try {
        loginResponse = await api.loginUser({ email, password, code: code || undefined, returnToken: true });
      } catch (e) {
        if (e?.response?.data?.twoFactorRequired) return { twoFactorRequired: true, error: code ? api.errorMessage(e) : null };
        const status = e?.response?.status;
        const error = new Error(api.errorMessage(e, "That email and password don't match."));
        error.kind = !e?.response ? "network" : status === 429 ? "limited" : status >= 500 ? "server" : status === 400 || status === 401 ? "credentials" : "other";
        throw error;
      }
      return finishLogin(loginResponse);
    },
    [finishLogin]
  );

  /* Sign in with the 4-digit MPIN of this device (set up in Settings after a normal sign-in). */
  const loginWithMpin = useCallback(
    async (pin) => {
      const device = readMpin();
      if (!device) { const error = new Error("MPIN is not set up on this device."); error.kind = "gone"; throw error; }
      let res;
      try {
        res = await api.mpinLogin({ deviceId: device.deviceId, deviceSecret: device.deviceSecret, pin, returnToken: true });
      } catch (e) {
        const data = e?.response?.data || {};
        if (data.mpinGone) clearMpin();
        const status = e?.response?.status;
        const error = new Error(api.errorMessage(e, "That MPIN didn't work."));
        error.kind = !e?.response ? "network" : data.mpinGone ? "gone" : status === 429 ? "limited" : status >= 500 ? "server" : "credentials";
        error.triesLeft = data.triesLeft;
        throw error;
      }
      return finishLogin(res);
    },
    [finishLogin]
  );

  const register = useCallback(async ({ name, email, password }) => {
    try {
      await api.signupUser({ name, email, password, cpassword: password });
    } catch (e) {
      const error = new Error(api.errorMessage(e, "We couldn't create your account."));
      error.kind = !e?.response ? "network" : e.response.status === 429 ? "limited" : e.response.status >= 500 ? "server" : "invalid";
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logoutUser();
    } catch (e) {
      /* clear locally anyway */
    }
    clearVault();
    setProfile(null);
    setStatus("signedOut");
  }, [clearVault]);

  /* Lock = sign out on this device: everything is hidden until you sign in again. */
  const lock = useCallback(async () => {
    await logout();
  }, [logout]);

  /* ── Auto-sync: changes made in the extension, the app or another tab show up here on their own.
        Delta sync asks only for what changed; a live event stream triggers it instantly, and a timer plus
        focus/visibility is the fallback. Anything unexpected falls back to a full reload. ── */
  const syncedAt = useRef(null); // server time of the last successful sync
  const deltaOk = useRef(true);  // false once the server turned out not to support /vault/changes
  useEffect(() => {
    if (status !== "ready") return undefined;
    let timer = null, stopped = false, running = false, queued = false, fullAt = Date.now();
    const signedOut = (e) => { if (e?.response?.status === 401) { clearVault(); setProfile(null); setStatus("signedOut"); } };
    const sync = async () => {
      if (document.hidden || stopped) return;
      if (running) { queued = true; return; }
      running = true;
      try {
        const needFull = !deltaOk.current || !syncedAt.current || Date.now() - fullAt > 10 * 60 * 1000;
        if (needFull) {
          const startedAt = new Date().toISOString();
          await loadProfile();
          fullAt = Date.now();
          if (deltaOk.current) {
            // Seed the delta clock from just before the full load (cheap: nothing newer exists). A server without
            // the endpoint answers 404 and we stay on full loads.
            try { const c = await api.getVaultChanges(startedAt); syncedAt.current = c.serverTime; setItems((l) => mergeDelta(l, c.items, c.itemIds, toItem)); setProjects((l) => mergeDelta(l, c.projects, c.projectIds, toProject)); }
            catch (e) { if (e?.response?.status === 404) deltaOk.current = false; }
          }
        } else {
          const c = await api.getVaultChanges(syncedAt.current);
          syncedAt.current = c.serverTime;
          setItems((list) => mergeDelta(list, c.items, c.itemIds, toItem));
          setProjects((list) => mergeDelta(list, c.projects, c.projectIds, toProject));
        }
      } catch (e) {
        if (e?.response?.status === 404) deltaOk.current = false;
        signedOut(e);
        syncedAt.current = null; // next round does a full reload
      } finally {
        running = false;
        if (queued) { queued = false; void sync(); }
      }
    };

    // Live stream: a "change" event from another device/tab triggers a delta sync right away.
    const controller = new AbortController();
    const stream = async () => {
      let attempt = 0;
      while (!stopped) {
        try {
          const res = await api.openVaultEvents(controller.signal);
          if (!res.ok || !res.body) throw new Error("stream " + res.status);
          attempt = 0;
          const parse = createSseParser((ev) => {
            if (ev.event !== "change") return;
            try { if (JSON.parse(ev.data).source === api.CLIENT_ID) return; } catch (e) { /* treat as foreign */ }
            void sync();
          });
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          for (;;) { const { done, value } = await reader.read(); if (done) break; parse(decoder.decode(value, { stream: true })); }
        } catch (e) {
          if (stopped || e?.name === "AbortError") return;
        }
        if (stopped) return;
        await new Promise((r) => window.setTimeout(r, reconnectDelay(attempt)));
        attempt += 1;
      }
    };
    void sync();
    void stream();
    const onVisible = () => { if (!document.hidden) void sync(); };
    timer = window.setInterval(() => void sync(), SYNC_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true; controller.abort(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible);
    };
  }, [status, loadProfile, clearVault]);


  /* ── Items ── */
  const addItem = useCallback(async (fields) => {
    const item = normalizeItem({ ...fields, passwordUpdatedAt: new Date().toISOString() });
    const res = await api.createItem(item);
    const created = toItem(res.data.item);
    setItems((list) => [created, ...list]);
    return created;
  }, []);

  const updateItem = useCallback(async (id, fields) => {
    const current = allItems.find((i) => i.id === id);
    let next = normalizeItem({ ...current, ...fields });
    if (current && current.password !== next.password) next.passwordUpdatedAt = new Date().toISOString();
    next = withHistory(current, next);
    const res = await api.updateItem(id, next);
    setItems((list) => list.map((i) => (i.id === id ? { ...next, id, createdAt: i.createdAt, updatedAt: res.data.item.updatedAt } : i)));
    setBreaches((b) => {
      if (!current || current.password === next.password) return b;
      const copy = { ...b };
      delete copy[id];
      return copy;
    });
  }, [allItems]);

  const toggleFavorite = useCallback((id) => {
    const current = allItems.find((i) => i.id === id);
    return current ? updateItem(id, { favorite: !current.favorite }) : Promise.resolve();
  }, [allItems, updateItem]);

  /* Delete moves an item to the trash; purgeItem removes it for good. */
  const purgeItem = useCallback(async (id) => {
    await api.deleteItem(id);
    setItems((list) => list.filter((i) => i.id !== id));
  }, []);
  const deleteItem = useCallback((id) => updateItem(id, { deletedAt: new Date().toISOString(), favorite: false }), [updateItem]);
  const restoreItem = useCallback((id) => updateItem(id, { deletedAt: null }), [updateItem]);
  const emptyTrash = useCallback(async () => {
    const ids = allItems.filter((i) => i.deletedAt).map((i) => i.id);
    const results = await Promise.allSettled(ids.map((id) => purgeItem(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) throw new Error(`${failed} item${failed === 1 ? "" : "s"} could not be removed.`);
  }, [allItems, purgeItem]);

  /* Items that sat in the trash for more than 30 days are removed the next time the vault loads. */
  const purgedOnce = useRef(false);
  useEffect(() => {
    if (status !== "ready" || purgedOnce.current) return;
    purgedOnce.current = true;
    allItems.filter((i) => trashExpired(i)).forEach((i) => { purgeItem(i.id).catch(() => {}); });
  }, [status, allItems, purgeItem]);

  /* ── Projects ── */
  const addProject = useCallback(async (fields) => {
    const project = normalizeProject(fields);
    const res = await api.createProject(project);
    const created = toProject(res.data.item);
    setProjects((list) => [created, ...list]);
    return created;
  }, []);

  const updateProjectEntry = useCallback(async (id, fields) => {
    const current = projects.find((p) => p.id === id);
    const next = normalizeProject({ ...current, ...fields });
    const res = await api.updateProject(id, next);
    setProjects((list) => list.map((p) => (p.id === id ? { ...next, id, createdAt: p.createdAt, updatedAt: res.data.item.updatedAt } : p)));
  }, [projects]);

  const deleteProjectEntry = useCallback(async (id) => {
    await api.deleteProject(id);
    setProjects((list) => list.filter((p) => p.id !== id));
  }, []);

  const importProjects = useCallback(async (list, onProgress) => {
    const prepared = list.map((p) => normalizeProject(p));
    const created = [];
    for (let i = 0; i < prepared.length; i += 500) {
      const chunk = prepared.slice(i, i + 500);
      const res = await api.createProjects(chunk.map((p) => ({ data: p })));
      res.data.items.forEach((entry) => created.push(toProject(entry)));
      onProgress?.(Math.min(prepared.length, i + chunk.length), prepared.length);
    }
    setProjects((list2) => [...created, ...list2]);
    return created.length;
  }, []);

  const importItems = useCallback(async (list, onProgress) => {
    const now = new Date().toISOString();
    const prepared = list.map((it) => normalizeItem({ ...it, passwordUpdatedAt: it.passwordUpdatedAt || now }));
    const created = [];
    for (let i = 0; i < prepared.length; i += 500) {
      const chunk = prepared.slice(i, i + 500);
      const res = await api.createItems(chunk.map((it) => ({ data: it })));
      res.data.items.forEach((entry) => created.push(toItem(entry)));
      onProgress?.(Math.min(prepared.length, i + chunk.length), prepared.length);
    }
    setItems((l) => [...created, ...l]);
    return created.length;
  }, []);

  /* ── Breach check (Have I Been Pwned, k-anonymity) ── */
  const runBreachCheck = useCallback(async () => {
    const targets = items.filter((i) => i.password);
    const found = {};
    setBreachProgress({ done: 0, total: targets.length });
    for (let n = 0; n < targets.length; n += 1) {
      try {
        const count = await pwnedCount(targets[n].password);
        if (count) found[targets[n].id] = count;
      } catch (e) {
        setBreachProgress(null);
        throw e;
      }
      setBreachProgress({ done: n + 1, total: targets.length });
    }
    setBreaches(found);
    setTimeout(() => setBreachProgress(null), 1200);
    return Object.keys(found).length;
  }, [items]);

  /* ── Account ── */
  const changePassword = useCallback(async ({ current, next, code }) => {
    try {
      await api.changePassword({ currentPassword: current, newPassword: next, code: code || undefined });
    } catch (e) {
      const err = new Error(api.errorMessage(e, "Couldn't change your password."));
      err.twoFactorRequired = Boolean(e?.response?.data?.twoFactorRequired);
      throw err;
    }
    await loadProfile();
  }, [loadProfile]);

  const refreshProfile = useCallback(() => loadProfile().catch(() => null), [loadProfile]);

  const value = useMemo(() => {
    const health = computeHealth(items, breaches);
    return {
      status,
      profile,
      items,
      broken: 0,
      health,
      breaches,
      breachProgress,
      prefs,
      setPrefs,
      login,
      loginWithMpin,
      register,
      logout,
      lock,
      addItem,
      updateItem,
      toggleFavorite,
      deleteItem,
      purgeItem,
      restoreItem,
      emptyTrash,
      trash,
      importItems,
      runBreachCheck,
      changePassword,
      refreshProfile,
      setProfileName: (name) => setProfile((p) => (p ? { ...p, name } : p)),
      projects,
      projectsBroken: 0,
      addProject,
      updateProject: updateProjectEntry,
      deleteProject: deleteProjectEntry,
      importProjects,
    };
  }, [
    status, waking, profile, items, breaches, breachProgress, prefs, setPrefs, login, loginWithMpin, register, logout, lock,
    addItem, updateItem, toggleFavorite, deleteItem, purgeItem, restoreItem, emptyTrash, trash, importItems, runBreachCheck, changePassword, refreshProfile,
    projects, addProject, updateProjectEntry, deleteProjectEntry, importProjects,
  ]);

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export const useVault = () => useContext(VaultContext);
