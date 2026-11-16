import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  getRenderLogs, getRenderEnvVars, getRenderDeploys, getRenderMetrics, getRenderSnapshots, getRenderEnvGroups,
  getRenderDbExports, createRenderDbExport, createRenderSnapshot, restoreRenderSnapshot, updateRenderEnvVar,
  deleteRenderEnvVar, triggerRenderDeploy, restartRenderService, suspendRenderService, resumeRenderService,
  rollbackRenderDeploy, cancelRenderDeploy, deleteRenderService, checkRenderHealth, diagnoseRenderLogs, renameRenderService
} from "../../api/client";
import { Modal, StatePill, Skeleton, Empty, LineChart, Section } from "./RenderUi";
import { usePolling, useRequestGate } from "./renderHooks";
import DomainPanel from "./DomainPanel";
import EnvText from "../../Components/Project/EnvText";
import { parseEnvBlock } from "../../lib/projectItems";
import ServiceBranch from "./ServiceBranch";
import {
  serviceKind, serviceState, serviceKey, repoKeyOf, normalizeList, normalizeMetricPoints, timeAgo, formatDateTime, formatNumber,
  METRIC_OPTIONS, RANGE_OPTIONS, rangeStart, diagnoseLogText, isErrorLog, safeUrl, errorMessage
} from "./renderUtils";

const TABS = [
  ["overview", "Overview"], ["metrics", "Metrics"], ["logs", "Logs"], ["env", "Environment"], ["deploys", "Deployments"]
];
const IN_PROGRESS = ["created", "queued", "build_in_progress", "update_in_progress", "pre_deploy_in_progress"];

export default function ServiceDetail({ service, services, incidentKeys, opsConfig, askConfirm, isFavorite, onToggleFavorite, onClose, onOpenService, onRefresh, onAudit }) {
  const kind = serviceKind(service);
  const state = serviceState(service, incidentKeys);
  const tabs = kind === "PostgreSQL" ? [...TABS, ["database", "Database"]] : kind === "Web service" || kind === "Static site" ? [...TABS, ["domains", "Domains & URL"]] : TABS;
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(service.name || "");
  const [renameBusy, setRenameBusy] = useState(false);
  const fail = (e, fallback) => { const message = errorMessage(e, fallback); setError(message); return message; };

  // Health
  const [health, setHealth] = useState(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  // Metrics
  const [metric, setMetric] = useState("cpu");
  const [range, setRange] = useState("1h");
  const [metricPoints, setMetricPoints] = useState(null);
  const [metricBusy, setMetricBusy] = useState(false);
  const metricGate = useRequestGate();
  // Logs
  const [logs, setLogs] = useState([]);
  const [logType, setLogType] = useState("app");
  const [logSearch, setLogSearch] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [follow, setFollow] = useState(true);
  const [logBusy, setLogBusy] = useState(false);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [diagnosis, setDiagnosis] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const logGate = useRequestGate();
  // Env
  const [envVars, setEnvVars] = useState([]);
  const [envBusy, setEnvBusy] = useState(false);
  const [envSearch, setEnvSearch] = useState("");
  const [reveal, setReveal] = useState(false);
  const [newEnv, setNewEnv] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [envGroups, setEnvGroups] = useState([]);
  const [syncOpen, setSyncOpen] = useState(false);
  // "Import env": pick variables from any server (any account, any repo) or a pasted .env, staged here until Save and deploy.
  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState("");
  const [importText, setImportText] = useState("");
  const [importRows, setImportRows] = useState(null);
  const [importPick, setImportPick] = useState(() => new Set());
  const [importBusy, setImportBusy] = useState(false);
  const [syncSkip, setSyncSkip] = useState(() => new Set()); // keys of web services the user unticked
  const [syncDirection, setSyncDirection] = useState("to");
  const [syncOverwrite, setSyncOverwrite] = useState(false);
  const [syncDeploy, setSyncDeploy] = useState(true);
  const [syncBusy, setSyncBusy] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  // Deploys
  const [deploys, setDeploys] = useState([]);
  const [clockNow, setClockNow] = useState(Date.now());
  const [simpleLogs, setSimpleLogs] = useState(true);
  const [deployBusy, setDeployBusy] = useState(false);
  // Database
  const [dbExports, setDbExports] = useState([]);
  const [dbBusy, setDbBusy] = useState(false);

  const ref = { accountId: service.accountId, id: service.id };

  /* ---------- health ---------- */
  const runHealth = useCallback(async (quiet = false) => {
    if (!quiet) setHealthBusy(true);
    try {
      const result = await checkRenderHealth(ref.accountId, ref.id);
      setHealth((previous) => {
        if (alertsEnabled && previous && previous.state !== result.state && "Notification" in window && window.Notification.permission === "granted") {
          new window.Notification("Render health changed: " + service.name, { body: previous.state + " → " + result.state });
        }
        return result;
      });
      if (!quiet) toast.info("Health check: " + result.state);
      void onAudit();
    } catch (e) {
      setHealth({ state: "unknown", checkedAt: new Date().toISOString(), message: errorMessage(e, "Health check failed.") });
    } finally { if (!quiet) setHealthBusy(false); }
  }, [ref.accountId, ref.id, alertsEnabled, service.name, onAudit]);

  useEffect(() => { if (tab === "overview") void runHealth(true); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(() => runHealth(true), 30000, tab === "overview");

  const enableAlerts = async () => {
    if (!("Notification" in window)) { toast.error("Browser notifications are not supported here."); return; }
    const permission = window.Notification.permission === "granted" ? "granted" : await window.Notification.requestPermission();
    if (permission !== "granted") { toast.info("Allow browser notifications to receive health-change alerts."); return; }
    setAlertsEnabled(true);
    toast.success("Health-change alerts enabled while this panel is open.");
  };

  /* ---------- metrics ---------- */
  const loadMetrics = useCallback(async (nextMetric = metric, nextRange = range) => {
    const isCurrent = metricGate();
    setMetricBusy(true);
    try {
      const result = await getRenderMetrics(ref.accountId, ref.id, nextMetric, rangeStart(nextRange));
      if (!isCurrent()) return;
      setMetricPoints(normalizeMetricPoints(result));
      setError("");
    } catch (e) {
      if (!isCurrent()) return;
      setMetricPoints([]);
      fail(e, "Metrics are not available for this service or plan.");
    } finally { if (isCurrent()) setMetricBusy(false); }
  }, [ref.accountId, ref.id, metric, range]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- logs ---------- */
  const loadLogs = useCallback(async (type = logType, quiet = false) => {
    if (!service.ownerId) { setError("Render did not include the owner ID required to query logs for this service."); return; }
    const isCurrent = logGate();
    if (!quiet) setLogBusy(true);
    try {
      const end = new Date();
      const result = await getRenderLogs(ref.accountId, {
        ownerId: service.ownerId, resource: ref.id, startTime: new Date(end.getTime() - 3600000).toISOString(),
        endTime: end.toISOString(), direction: "backward", limit: "100", type
      });
      if (!isCurrent()) return;
      setLogs(Array.isArray(result.logs) ? result.logs : []);
      setLogsLoaded(true);
      setError("");
    } catch (e) { if (isCurrent()) fail(e, "Could not load logs."); }
    finally { if (isCurrent() && !quiet) setLogBusy(false); }
  }, [ref.accountId, ref.id, service.ownerId, logType]); // eslint-disable-line react-hooks/exhaustive-deps

  usePolling(() => loadLogs(logType, true), 15000, tab === "logs" && follow);
  usePolling(() => loadMetrics(metric, range), 30000, tab === "metrics");

  const visibleLogs = useMemo(() => {
    const needle = logSearch.trim().toLowerCase();
    return logs.filter((l) => (!needle || String(l.message || "").toLowerCase().includes(needle)) && (!errorsOnly || isErrorLog(l)));
  }, [logs, logSearch, errorsOnly]);
  // Simple mode groups adjacent duplicate lines without hiding unique errors.
  const displayLogs = useMemo(() => {
    if (!simpleLogs) return visibleLogs.map((entry) => ({ ...entry, repeatCount: 1 }));
    const rows = [];
    for (const entry of visibleLogs) {
      const normalized = String(entry.message || "(empty log entry)").replace(/\s+/g, " ").trim();
      const previous = rows[rows.length - 1];
      if (previous && previous.normalized === normalized) previous.repeatCount += 1;
      else rows.push({ ...entry, normalized, repeatCount: 1 });
    }
    return rows;
  }, [visibleLogs, simpleLogs]);

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(visibleLogs.map((l) => (l.timestamp ? l.timestamp + " " : "") + (l.message || "")).join("\n"));
      toast.success("Copied " + visibleLogs.length + " log line(s).");
    } catch { toast.error("Clipboard is not available in this browser."); }
  };

  const diagnoseWithAI = async () => {
    if (!logs.length) { toast.info("Load logs before requesting AI diagnosis."); return; }
    const ok = await askConfirm({ title: "Send redacted logs to Groq?", message: "Up to 16,000 characters of log text will be sent to the optional Groq AI provider. Stashr redacts common token, password and email patterns first, but automated redaction can miss sensitive data. Continue only if you are comfortable sharing these logs externally.", confirmLabel: "Send for diagnosis" });
    if (!ok) return;
    setAiBusy(true);
    try {
      const text = logs.map((entry) => String(entry.message || "")).join("\n").slice(-16000);
      const result = await diagnoseRenderLogs(service.name, text, true);
      setDiagnosis("AI-assisted diagnosis (Groq; redacted log text)\n\n" + result.diagnosis + "\n\nProvider: " + result.provider + " · Model: " + result.model + " · Redacted characters sent: " + result.redactedCharacters);
      toast.success("AI diagnosis received. Verify suggestions against logs and deployment history.");
    } catch (e) { toast.error(errorMessage(e, "AI diagnosis unavailable. Use the rule-based diagnosis.")); }
    finally { setAiBusy(false); }
  };

  /* ---------- environment ---------- */
  const loadEnv = useCallback(async () => {
    setEnvBusy(true); setError("");
    try {
      const result = await getRenderEnvVars(ref.accountId, ref.id);
      setEnvVars(normalizeList(result, "envVar").map((v) => ({ key: v.key || "", value: v.value || "", originalValue: v.value || "", isNew: false })).filter((v) => v.key));
    } catch (e) { fail(e, "Could not load environment variables."); }
    finally { setEnvBusy(false); }
  }, [ref.accountId, ref.id]);

  const loadEnvGroups = useCallback(async () => {
    try {
      const result = await getRenderEnvGroups(ref.accountId);
      const rows = Array.isArray(result) ? result : Array.isArray(result?.envGroups) ? result.envGroups : [];
      setEnvGroups(rows.map((item) => item?.envGroup || item).filter((item) => item && item.id));
    } catch { setEnvGroups([]); }
  }, [ref.accountId]);

  const loadSnapshots = async () => {
    setSnapshotBusy(true);
    try {
      const result = await getRenderSnapshots(ref.accountId, ref.id);
      setSnapshots(Array.isArray(result.snapshots) ? result.snapshots : []);
    } catch (e) { fail(e, "Could not load environment snapshots."); }
    finally { setSnapshotBusy(false); }
  };

  // `remove` marks a variable that was deleted in the text editor; it is deleted on save.
  const dirty = envVars.filter((v) => v.isNew || v.remove || v.value !== v.originalValue);
  const textRows = useMemo(() => envVars.filter((v) => !v.remove).map((v) => ({ name: v.key, value: v.value })), [envVars]);

  // Bulk edit from the text box: names that stay get their new value, names left out are removed, new names are added.
  const applyEnvText = (rows) => {
    const next = new Map(rows.map((r) => [r.name, r.value]));
    setEnvVars((old) => {
      const kept = old.map((v) => {
        if (!next.has(v.key)) return v.isNew ? null : { ...v, remove: true };
        return { ...v, value: next.get(v.key), remove: false };
      }).filter(Boolean);
      const known = new Set(old.map((v) => v.key));
      const added = rows.filter((r) => !known.has(r.name)).map((r) => ({ key: r.name, value: r.value, originalValue: "", isNew: true }));
      return [...kept, ...added];
    });
  };

  const saveEnv = async () => {
    if (!dirty.length) { toast.info("No environment variable changes to save."); return; }
    const ok = await askConfirm({ title: "Save environment changes?", message: dirty.length + " variable(s) will be written to " + service.name + ": " + dirty.map((v) => v.key).join(", ") + ". The latest commit is then deployed so the changes take effect.", confirmLabel: "Save and deploy" });
    if (!ok) return;
    setBusy(true);
    let saved = 0;
    try {
      for (const item of dirty) {
        if (item.remove) await deleteRenderEnvVar(ref.accountId, ref.id, item.key);
        else await updateRenderEnvVar(ref.accountId, ref.id, item.key, item.value);
        saved += 1;
      }
      try { await triggerRenderDeploy(ref.accountId, ref.id, false); toast.success("Environment variables saved. Deploying the latest commit."); }
      catch { toast.warn("Variables saved, but the deploy did not start. Deploy it from the Overview tab."); }
    } catch (e) {
      fail(e, "Could not save environment variables.");
      if (saved) toast.warn(saved + " of " + dirty.length + " variable(s) were saved before the error.");
    } finally {
      await loadEnv(); // always resync so the UI never shows a half-applied state as clean
      void onAudit();
      setBusy(false);
    }
  };

  /* Other servers deployed from the same GitHub repo, as targets for "Sync env". */
  const siblings = useMemo(() => {
    const repo = repoKeyOf(service.repo);
    if (!repo) return [];
    return (services || []).filter((s) => serviceKey(s) !== serviceKey(service) && repoKeyOf(s.repo) === repo && serviceKind(s) === "Web service");
  }, [services, service]);

  const importCandidates = useMemo(() => (services || []).filter((s) => serviceKey(s) !== serviceKey(service) && serviceKind(s) !== "PostgreSQL"), [services, service]);

  const loadImport = async () => {
    setImportBusy(true); setImportRows(null);
    try {
      let rows;
      if (importSource === "paste") rows = parseEnvBlock(importText).map((r) => ({ key: r.name, value: r.value || "" }));
      else {
        const src = importCandidates.find((t) => serviceKey(t) === importSource);
        if (!src) { toast.info("Choose a server first."); return; }
        rows = normalizeList(await getRenderEnvVars(src.accountId, src.id), "envVar").map((v) => ({ key: v.key || "", value: v.value || "" }));
      }
      rows = rows.filter((r) => r.key && r.value !== "");
      if (!rows.length) { toast.info("No variables with a value were found there."); return; }
      const mine = new Map(envVars.filter((v) => !v.remove).map((v) => [v.key, v.value]));
      const view = rows.map((r) => ({ ...r, state: !mine.has(r.key) ? "new" : mine.get(r.key) === r.value ? "same" : "different" }));
      setImportRows(view);
      setImportPick(new Set(view.filter((r) => r.state === "new").map((r) => r.key)));
    } catch (e) { fail(e, "Could not read that server's variables."); }
    finally { setImportBusy(false); }
  };

  const stageImport = () => {
    const chosen = (importRows || []).filter((r) => importPick.has(r.key));
    if (!chosen.length) { toast.info("Tick at least one variable."); return; }
    setEnvVars((old) => {
      const byKey = new Map(chosen.map((r) => [r.key, r.value]));
      const updated = old.map((v) => (byKey.has(v.key) ? { ...v, value: byKey.get(v.key), remove: false } : v));
      const known = new Set(old.map((v) => v.key));
      const added = chosen.filter((r) => !known.has(r.key)).map((r) => ({ key: r.key, value: r.value, originalValue: "", isNew: true }));
      return [...updated, ...added];
    });
    toast.success(chosen.length + " variable" + (chosen.length === 1 ? "" : "s") + " added below. Press Save and deploy to apply.");
    setImportOpen(false); setImportRows(null);
  };

  const copyEnv = async () => {
    const rows = envVars.filter((v) => !v.remove && v.key);
    if (!rows.length) { toast.info("There are no variables to copy."); return; }
    const text = rows.map((v) => v.key + "=" + (/[\s#"']/.test(v.originalValue) ? JSON.stringify(v.originalValue) : v.originalValue)).join("\n");
    try { await navigator.clipboard.writeText(text); toast.success("Copied " + rows.length + " variables as .env text."); }
    catch { toast.error("Your browser blocked copying. Turn on Reveal values and copy the text instead."); }
  };

  const syncEnv = async () => {
    const others = siblings.filter((s) => !syncSkip.has(serviceKey(s)));
    const push = syncDirection === "to"; // "to": this server is the source; "from": this server receives
    const own = envVars.filter((v) => !v.remove && !v.isNew && v.key && v.originalValue !== "");
    if (!others.length) { toast.info("Tick at least one web service to sync with."); return; }
    if (push && !own.length) { toast.info("This server has no variables with a value to copy."); return; }
    const names = others.map((t) => t.name).join(", ");
    const ok = await askConfirm({
      title: "Sync environment variables?",
      message: (push ? "Copy " + (syncOverwrite ? "all variables" : "the missing variables") + " from " + service.name + " to " + names : "Copy " + (syncOverwrite ? "all variables" : "the missing variables") + " from " + names + " to " + service.name) + (syncOverwrite ? ", replacing values that already exist" : ". Existing values are not changed") + "." + (syncDeploy ? " Servers that receive changes are redeployed." : ""),
      confirmLabel: "Sync", danger: syncOverwrite
    });
    if (!ok) return;
    setSyncBusy(true);
    const report = [];
    const readEnv = async (svc) => normalizeList(await getRenderEnvVars(svc.accountId, svc.id), "envVar").map((v) => ({ key: v.key || "", value: v.value || "" })).filter((v) => v.key);
    const copy = async (from, to) => {
      const source = from === service ? own.map((v) => ({ key: v.key, value: v.originalValue })) : (await readEnv(from)).filter((v) => v.value !== "");
      const have = new Map((to === service ? envVars.filter((v) => !v.isNew).map((v) => ({ key: v.key, value: v.originalValue })) : await readEnv(to)).map((v) => [v.key, v.value]));
      const todo = source.filter((v) => syncOverwrite ? have.get(v.key) !== v.value : !have.has(v.key));
      for (const v of todo) await updateRenderEnvVar(to.accountId, to.id, v.key, v.value);
      let deployed = false;
      if (todo.length && syncDeploy && serviceState(to, incidentKeys) !== "suspended") { try { await triggerRenderDeploy(to.accountId, to.id, false); deployed = true; } catch { /* the variables are saved either way */ } }
      return to.name + ": " + todo.length + " synced" + (deployed ? ", deploying" : "");
    };
    try {
      for (const other of others) {
        try { report.push(push ? await copy(service, other) : await copy(other, service)); }
        catch (e) { report.push((push ? other.name : service.name) + ": failed (" + errorMessage(e, "error") + ")"); }
      }
      toast.info(report.join(" · "), { autoClose: 9000 });
      if (!push) await loadEnv();
    } finally { setSyncBusy(false); void onAudit(); }
  };

  const removeEnv = async (item) => {
    if (item.isNew) { setEnvVars((old) => old.filter((v) => v.key !== item.key)); return; }
    const ok = await askConfirm({ title: "Delete variable?", message: "Permanently delete " + item.key + " from " + service.name + "? This cannot be undone from Stashr unless you have a snapshot.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteRenderEnvVar(ref.accountId, ref.id, item.key);
      setEnvVars((old) => old.filter((v) => v.key !== item.key));
      toast.success("Environment variable deleted.");
      void onAudit();
    } catch (e) { fail(e, "Could not delete this variable."); }
    finally { setBusy(false); }
  };

  const addEnv = (event) => {
    event.preventDefault();
    const key = newKey.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || envVars.some((v) => v.key === key)) { setError("Enter a valid, unique environment variable name (letters, digits, underscores)."); return; }
    setEnvVars((old) => [...old, { key, value: newValue, originalValue: "", isNew: true }]);
    setNewKey(""); setNewValue(""); setNewEnv(false); setError("");
  };

  const createSnapshot = async () => {
    const ok = await askConfirm({ title: "Create snapshot?", message: "Create an encrypted snapshot of all current environment variables for " + service.name + "?", confirmLabel: "Create snapshot" });
    if (!ok) return;
    setSnapshotBusy(true);
    try {
      await createRenderSnapshot(ref.accountId, ref.id);
      const result = await getRenderSnapshots(ref.accountId, ref.id);
      setSnapshots(Array.isArray(result.snapshots) ? result.snapshots : []);
      void onAudit();
      toast.success("Encrypted environment snapshot created.");
    } catch (e) { fail(e, "Could not create a snapshot."); }
    finally { setSnapshotBusy(false); }
  };

  const restoreSnapshot = async (snapshot) => {
    const ok = await askConfirm({ title: "Restore snapshot?", message: "Restore " + snapshot.count + " environment variables from " + formatDateTime(snapshot.createdAt) + "? Variables absent from the snapshot will be deleted. This cannot be automatically undone, and a deploy may be required.", confirmLabel: "Restore", danger: true });
    if (!ok) return;
    setSnapshotBusy(true);
    try {
      const result = await restoreRenderSnapshot(ref.accountId, ref.id, snapshot.id);
      await loadEnv();
      void onAudit();
      toast.success(result.message || "Snapshot restored.");
    } catch (e) { fail(e, "Could not restore this snapshot."); }
    finally { setSnapshotBusy(false); }
  };

  /* ---------- deploys / lifecycle ---------- */
  const loadDeploys = useCallback(async () => {
    setDeployBusy(true); setError("");
    try { setDeploys(normalizeList(await getRenderDeploys(ref.accountId, ref.id), "deploy")); }
    catch (e) { fail(e, "Could not load deployment history."); }
    finally { setDeployBusy(false); }
  }, [ref.accountId, ref.id]);
  const activeDeploys = deploys.filter((d) => IN_PROGRESS.includes(String(d.status || "").toLowerCase()));
  const typicalDeployMs = useMemo(() => {
    const durations = deploys.filter((d) => d.status === "live" && d.createdAt && (d.finishedAt || d.updatedAt))
      .map((d) => Date.parse(d.finishedAt || d.updatedAt) - Date.parse(d.createdAt))
      .filter((ms) => Number.isFinite(ms) && ms >= 5000 && ms <= 2 * 60 * 60 * 1000)
      .sort((a, b) => a - b);
    return durations.length ? durations[Math.floor(durations.length / 2)] : null;
  }, [deploys]);
  const countdown = (ms) => {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(seconds / 60) + "m " + String(seconds % 60).padStart(2, "0") + "s";
  };
  usePolling(() => setClockNow(Date.now()), 1000, tab === "deploys" && activeDeploys.length > 0);
  usePolling(() => { void loadDeploys(); }, 5000, tab === "deploys" && activeDeploys.length > 0);
  usePolling(() => { if (!dirty.length) void loadEnv(); }, 30000, tab === "env" && dirty.length === 0);

  const deploy = async (clearCache) => {
    const ok = await askConfirm({ title: clearCache ? "Deploy with cache cleared?" : "Deploy latest commit?", message: (clearCache ? "Trigger a new deploy of " : "Trigger a deploy of the latest commit for ") + service.name + (clearCache ? " with the build cache cleared." : "."), confirmLabel: "Deploy" });
    if (!ok) return;
    setBusy(true);
    try {
      await triggerRenderDeploy(ref.accountId, ref.id, clearCache);
      toast.success("Deployment triggered.");
      void onAudit();
      setTab("deploys"); void loadDeploys();
    } catch (e) { fail(e, "Could not trigger deployment."); }
    finally { setBusy(false); }
  };

  const restart = async () => {
    const ok = await askConfirm({ title: "Restart service?", message: "Restart " + service.name + "? This may briefly interrupt traffic.", confirmLabel: "Restart", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await restartRenderService(ref.accountId, ref.id); toast.success("Restart requested."); void onAudit(); }
    catch (e) { fail(e, "Could not restart service."); }
    finally { setBusy(false); }
  };

  const saveServiceName = async () => {
    const name = nameDraft.trim();
    if (name.length < 2 || name.length > 100) {
      setError("Service name must be between 2 and 100 characters.");
      return;
    }
    if (name === service.name) { setEditingName(false); return; }
    setRenameBusy(true);
    setError("");
    try {
      await renameRenderService(ref.accountId, ref.id, name);
      toast.success("Render service name updated.");
      setEditingName(false);
      await onRefresh();
      void onAudit();
    } catch (e) { fail(e, "Could not rename the Render service."); }
    finally { setRenameBusy(false); }
  };

  const toggleSuspend = async () => {
    const suspendedNow = service.suspended === "suspended";
    const ok = await askConfirm({ title: suspendedNow ? "Resume service?" : "Suspend service?", message: suspendedNow ? "Resume " + service.name + "? This may trigger a deployment or startup." : "Suspend " + service.name + "? It will become unavailable until resumed.", confirmLabel: suspendedNow ? "Resume" : "Suspend", danger: !suspendedNow });
    if (!ok) return;
    setLifecycleBusy(true);
    try {
      if (suspendedNow) await resumeRenderService(ref.accountId, ref.id); else await suspendRenderService(ref.accountId, ref.id);
      toast.success((suspendedNow ? "Resume" : "Suspend") + " requested.");
      await onRefresh();
      void onAudit();
    } catch (e) { fail(e, "Could not change service state."); }
    finally { setLifecycleBusy(false); }
  };

  const deleteService = async () => {
    const live = service.suspended !== "suspended";
    const typed = await askConfirm({
      title: "Delete " + service.name + " permanently?",
      message: (live ? "⚠ This service is LIVE and will go offline immediately. " : "") + "This permanently deletes the " + (live ? "live" : "suspended") + " service from Render, including its deploy history, logs and direct environment variables. It cannot be undone. Take an environment snapshot first if you may need the variables. Type the service name to confirm.",
      confirmLabel: "Delete service", danger: true,
      input: { placeholder: service.name, label: "Service name", maxLength: 200, match: service.name }
    });
    if (typed !== service.name) return;
    setBusy(true);
    try {
      await deleteRenderService(ref.accountId, ref.id, typed, live);
      toast.success(service.name + " was deleted.");
      onClose();
      await onRefresh();
      void onAudit();
    } catch (e) { fail(e, "Could not delete this service."); }
    finally { setBusy(false); }
  };

  const cancelDeploy = async (d) => {
    const ok = await askConfirm({ title: "Cancel deployment?", message: "Cancel the in-progress deployment " + d.id + "?", confirmLabel: "Cancel deployment", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await cancelRenderDeploy(ref.accountId, ref.id, d.id); toast.success("Cancellation requested."); await loadDeploys(); void onAudit(); }
    catch (e) { fail(e, "Could not cancel deployment."); }
    finally { setBusy(false); }
  };

  const rollback = async (d) => {
    const ok = await askConfirm({ title: "Roll back?", message: "Roll back " + service.name + " to deployment " + (d.commit?.id ? d.commit.id.slice(0, 8) : d.id) + "? Autodeploy may later redeploy the latest branch commit.", confirmLabel: "Roll back", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await rollbackRenderDeploy(ref.accountId, ref.id, d.id); toast.success("Rollback requested."); await loadDeploys(); void onAudit(); }
    catch (e) { fail(e, "Could not roll back deployment."); }
    finally { setBusy(false); }
  };

  /* ---------- database ---------- */
  const loadDbExports = useCallback(async () => {
    setDbBusy(true);
    try { const result = await getRenderDbExports(ref.accountId, ref.id); setDbExports(Array.isArray(result.exports) ? result.exports : []); }
    catch (e) { fail(e, "Could not load database exports."); }
    finally { setDbBusy(false); }
  }, [ref.accountId, ref.id]);

  const createDbExport = async () => {
    const ok = await askConfirm({ title: "Start database export?", message: "Start a PostgreSQL export for " + service.name + "? The export may contain sensitive production data. Protect any downloaded file.", confirmLabel: "Start export" });
    if (!ok) return;
    setDbBusy(true);
    try {
      await createRenderDbExport(ref.accountId, ref.id);
      const result = await getRenderDbExports(ref.accountId, ref.id);
      setDbExports(Array.isArray(result.exports) ? result.exports : []);
      void onAudit();
      toast.success("Database export requested. Refresh the list shortly for its download link.");
    } catch (e) { fail(e, "Could not start database export."); }
    finally { setDbBusy(false); }
  };

  /* ---------- tab loading ---------- */
  // Prefetch every tab in the background as soon as the service opens (the Overview health check runs first),
  // so switching tabs shows data that is already there instead of starting a fetch.
  const prefetched = useRef(new Set());
  useEffect(() => {
    const seen = prefetched.current;
    const run = (id, fn) => { seen.add(id); void fn(); };
    run("metrics", loadMetrics);
    run("logs", loadLogs);
    run("env", () => Promise.all([loadEnv(), loadEnvGroups()]));
    run("deploys", loadDeploys);
    if (kind === "PostgreSQL") run("database", loadDbExports);
    setError("");
  }, [ref.accountId, ref.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setError("");
    if (prefetched.current.has(tab)) return;
    if (tab === "metrics") void loadMetrics();
    if (tab === "logs" && !logsLoaded) void loadLogs();
    if (tab === "env") { void loadEnv(); void loadEnvGroups(); }
    if (tab === "deploys") void loadDeploys();
    if (tab === "database") void loadDbExports();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTabKey = (event) => {
    const index = tabs.findIndex(([id]) => id === tab);
    let next = null;
    if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
    if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
    if (event.key === "Home") next = tabs[0];
    if (event.key === "End") next = tabs[tabs.length - 1];
    if (next) { event.preventDefault(); setTab(next[0]); document.getElementById("rd-tab-" + next[0])?.focus(); }
  };

  const related = services.filter((s) => s.accountId === service.accountId && s.id !== service.id && ((s.repo && s.repo === service.repo) || (s.branch && s.branch === service.branch && service.repo === s.repo)));
  const linkedGroups = envGroups.filter((group) => (group.serviceLinks || []).some((link) => link.id === service.id));
  const lastMetric = metricPoints?.length ? metricPoints[metricPoints.length - 1] : null;

  return (
    <Modal labelledBy="rd-detail-title" onClose={onClose} wide className="rd-detail">
      <header className="rd-detail__head">
        <div>
          <div className="rd-eyebrow"><span />{kind.toUpperCase()}</div>
          {editingName ? (
            <form className="rd-detail__rename" onSubmit={(e) => { e.preventDefault(); void saveServiceName(); }}>
              <label className="rd-sr" htmlFor="rd-service-name">Server name</label>
              <input id="rd-service-name" value={nameDraft} maxLength={100} autoFocus onChange={(e) => setNameDraft(e.target.value)} disabled={renameBusy} />
              <button type="submit" className="rd-btn rd-btn--primary" disabled={renameBusy || nameDraft.trim().length < 2}>{renameBusy ? "Saving…" : "Save"}</button>
              <button type="button" className="rd-btn rd-btn--quiet" disabled={renameBusy} onClick={() => { setNameDraft(service.name || ""); setEditingName(false); }}>Cancel</button>
            </form>
          ) : (
            <h2 id="rd-detail-title">{service.name} <StatePill state={state} /><button type="button" className="rd-btn rd-btn--quiet rd-detail__edit-name" onClick={() => { setNameDraft(service.name || ""); setEditingName(true); }} disabled={renameBusy} aria-label={"Edit name for " + service.name}>✎ Edit name</button></h2>
          )}
          <p className="rd-muted rd-mono">{service.accountName} · {service.id}</p>
          {service.serviceDetails?.url && <a className="rd-detail__service-url" href={safeUrl(service.serviceDetails.url)} target="_blank" rel="noreferrer noopener"><span>Server URL</span><strong>{service.serviceDetails.url}</strong><span aria-hidden="true">↗</span></a>}
        </div>
        <div className="rd-detail__tools">
          <button type="button" className={"rd-icon-btn" + (isFavorite ? " is-on" : "")} aria-pressed={isFavorite} aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"} onClick={onToggleFavorite}>{isFavorite ? "★" : "☆"}</button>
          <button type="button" className="rd-icon-btn" onClick={onClose} aria-label="Close service panel">×</button>
        </div>
      </header>

      <div className="rd-detail__actions">
        <a className="rd-btn rd-btn--quiet" href={safeUrl(service.dashboardUrl)} target="_blank" rel="noreferrer noopener">Open in Render ↗</a>
        <button type="button" className="rd-btn rd-btn--primary" disabled={busy} onClick={() => void deploy(false)}>Deploy latest</button>
        <button type="button" className="rd-btn rd-btn--quiet" disabled={busy} onClick={() => void deploy(true)}>Deploy + clear cache</button>
        <button type="button" className="rd-btn rd-btn--quiet" disabled={busy || kind === "Cron job" || service.suspended === "suspended"} onClick={() => void restart()}>↻ Restart</button>
        <label className={"rd-service-toggle rd-service-toggle--detail" + (service.suspended === "suspended" ? " is-off" : "")} title={service.suspended === "suspended" ? "Turn on to resume this Render service" : "Turn off to suspend this Render service"}>
          <input type="checkbox" role="switch" checked={service.suspended !== "suspended"} disabled={busy || lifecycleBusy} aria-label={(service.suspended === "suspended" ? "Resume " : "Suspend ") + service.name} onChange={() => void toggleSuspend()} />
          <span className="rd-service-toggle__track" aria-hidden="true"><span className="rd-service-toggle__knob" /></span>
          <span className="rd-service-toggle__label">{lifecycleBusy ? "Working…" : service.suspended === "suspended" ? "Suspended" : "Running"}</span>
        </label>
        <button type="button" className="rd-btn rd-btn--danger-quiet rd-detail__delete" disabled={busy} onClick={() => void deleteService()}>🗑 Delete service…</button>
      </div>

      <div className="rd-tabs" role="tablist" aria-label="Service sections" onKeyDown={onTabKey}>
        {tabs.map(([id, label]) => <button key={id} id={"rd-tab-" + id} role="tab" type="button" aria-selected={tab === id} aria-controls={"rd-panel-" + id} tabIndex={tab === id ? 0 : -1} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{label}{id === "env" && dirty.length > 0 ? <b className="rd-badge">{dirty.length}</b> : null}</button>)}
      </div>

      {error && <div className="rd-alert rd-alert--error" role="alert"><span aria-hidden="true">!</span><div>{error}</div><button type="button" onClick={() => setError("")} aria-label="Dismiss">×</button></div>}

      <div className="rd-detail__body" role="tabpanel" id={"rd-panel-" + tab} aria-labelledby={"rd-tab-" + tab}>
        {tab === "overview" && <>
          <ServiceBranch service={service} />
          <div className={"rd-health is-" + (health?.state || "unknown")}>
            <div>
              <strong>Endpoint health</strong>
              <p>{health?.message || "Probes the public HTTPS URL supplied by Render."}</p>
              <small>{health?.checkedAt ? "Checked " + new Date(health.checkedAt).toLocaleTimeString() + (health.latencyMs != null ? " · " + health.latencyMs + " ms" : "") : "Not checked yet"}</small>
            </div>
            <span className="rd-health__state" role="status">{healthBusy ? "Checking…" : (health?.state || "unknown")}</span>
            <div className="rd-health__actions">
              <button type="button" className="rd-btn rd-btn--quiet" disabled={healthBusy} onClick={() => void runHealth()}>Run check</button>
              <button type="button" className="rd-btn rd-btn--quiet" onClick={() => void enableAlerts()} aria-pressed={alertsEnabled}>{alertsEnabled ? "Alerts on" : "Enable alerts"}</button>
            </div>
          </div>
          <dl className="rd-facts">
            {[["Service ID", service.id], ["Type", service.type || "Unknown"], ["Region", service.serviceDetails?.region || "—"], ["Plan", service.serviceDetails?.plan || service.serviceDetails?.buildPlan || "—"], ["Repository", service.repo || "—"], ["Branch", service.branch || "—"], ["Auto-deploy", service.autoDeploy || "—"], ["Last updated", timeAgo(service.updatedAt)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          <p className="rd-note">“Active” means Render lists the service as not suspended — it is not a live health guarantee. Browser alerts only run while this panel is open.</p>
          <Section title="Related services" subtitle="Same repository in this workspace">
            {related.length ? <div className="rd-chips">{related.slice(0, 8).map((s) => <button key={s.id} type="button" className="rd-chip" onClick={() => onOpenService(s)}>{s.name}<small>{serviceKind(s)}</small></button>)}</div> : <p className="rd-muted">No related services detected from repository metadata.</p>}
          </Section>
        </>}

        {tab === "metrics" && <Section title="Resource & request metrics" subtitle="Availability depends on the service type and plan."
          actions={<>
            <select aria-label="Metric" value={metric} onChange={(e) => { setMetric(e.target.value); void loadMetrics(e.target.value, range); }}>{METRIC_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <select aria-label="Time range" value={range} onChange={(e) => { setRange(e.target.value); void loadMetrics(metric, e.target.value); }}>{RANGE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button type="button" className="rd-icon-btn" aria-label="Refresh metrics" disabled={metricBusy} onClick={() => void loadMetrics()}>↻</button>
          </>}>
          {metricBusy && !metricPoints ? <Skeleton lines={5} height={18} /> : <>
            {lastMetric && <p className="rd-bignum">{formatNumber(lastMetric.value)} <small>{lastMetric.unit}</small><span className="rd-muted"> latest · {metricPoints.length} samples</span></p>}
            <LineChart series={[{ key: "svc", name: service.name, points: metricPoints || [] }]} metric={METRIC_OPTIONS.find(([v]) => v === metric)?.[1] || metric} />
          </>}
        </Section>}

        {tab === "logs" && <Section title="Logs" subtitle={follow ? "Last hour · refreshing every 15 seconds while this tab is visible" : "Last hour · live refresh paused"}
          actions={<>
            <select aria-label="Log type" value={logType} onChange={(e) => { setLogType(e.target.value); void loadLogs(e.target.value); }}><option value="app">Application</option><option value="request">Request</option><option value="build">Build</option></select>
            <button type="button" className={"rd-btn rd-btn--quiet" + (follow ? " is-active" : "")} aria-pressed={follow} onClick={() => setFollow((v) => !v)}>{follow ? "● Live" : "○ Paused"}</button>
            <button type="button" className="rd-icon-btn" aria-label="Refresh logs" onClick={() => void loadLogs()}>↻</button>
          </>}>
          <div className="rd-toolrow">
            <input className="rd-field" type="search" placeholder="Filter log messages…" aria-label="Filter log messages" value={logSearch} onChange={(e) => setLogSearch(e.target.value)} />
            <label className="rd-check"><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Errors only</label>
            <button type="button" className={"rd-btn rd-btn--quiet" + (simpleLogs ? " is-active" : "")} aria-pressed={simpleLogs} onClick={() => setSimpleLogs((v) => !v)}>{simpleLogs ? "Simple view" : "Raw lines"}</button>
            <button type="button" className="rd-btn rd-btn--quiet" disabled={!visibleLogs.length} onClick={() => void copyLogs()}>Copy</button>
            <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setDiagnosis(diagnoseLogText(logs).join("\n\n"))}>✦ Diagnose</button>
            <button type="button" className="rd-btn rd-btn--quiet" disabled={aiBusy || !logs.length || !opsConfig?.aiDiagnosisAvailable} title={opsConfig?.aiDiagnosisAvailable ? "Sends redacted log text to Groq after confirmation." : "Set GROQ_API_KEY on the Stashr API to enable AI diagnosis."} onClick={() => void diagnoseWithAI()}>{aiBusy ? "Asking Groq…" : "AI diagnosis ↗"}</button>
          </div>
          {diagnosis && <pre className="rd-diagnosis" aria-live="polite">{diagnosis}</pre>}
          {logBusy && !logs.length ? <Skeleton lines={6} /> : (
            <div className="rd-logs" role="log" aria-label="Service logs">
              {displayLogs.map((l, i) => {
                const message = String(l.message || "(empty log entry)");
                const severity = isErrorLog(l) ? "ERROR" : /\bwarn(?:ing)?\b/i.test(message) ? "WARN" : /\bdebug\b/i.test(message) ? "DEBUG" : "INFO";
                return <div className={"rd-log" + (isErrorLog(l) ? " is-error" : "")} key={l.id || i}>
                  <time dateTime={l.timestamp}>{l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : "—"}</time>
                  <span className={"rd-log__severity is-" + severity.toLowerCase()}>{severity}</span>
                  <code>{message}</code>
                  {l.repeatCount > 1 && <span className="rd-log__repeat">×{l.repeatCount}</span>}
                </div>;
              })}
              {!visibleLogs.length && <Empty icon="≡" title={logs.length ? "No matching log lines" : "No logs returned"}>{logs.length ? "Adjust the filter or turn off “Errors only”." : "Render returned nothing for the last hour for this log type."}</Empty>}
            </div>
          )}
        </Section>}

        {tab === "env" && <Section title="Environment variables" subtitle="Direct service variables only. Saving deploys the latest commit so the changes take effect."
          actions={<>
            <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setReveal((v) => !v)} aria-pressed={reveal}>{reveal ? "Mask values" : "Reveal values"}</button>
            <button type="button" className="rd-icon-btn" aria-label="Reload variables" onClick={() => void loadEnv()}>↻</button>
          </>}>
          {linkedGroups.length > 0 && <p className="rd-note">Linked environment groups (managed in Render): {linkedGroups.map((g) => g.name).join(", ")}</p>}
          <div className="rd-toolrow">
            <input className="rd-field" type="search" placeholder="Filter variable names…" aria-label="Filter variable names" value={envSearch} onChange={(e) => setEnvSearch(e.target.value)} />
            <button type="button" className="rd-btn rd-btn--quiet" disabled={snapshotBusy} onClick={() => void createSnapshot()}>▣ Snapshot</button>
            <button type="button" className="rd-btn rd-btn--quiet" disabled={snapshotBusy} onClick={() => void loadSnapshots()}>Snapshots</button>
            <button type="button" className="rd-btn rd-btn--quiet" onClick={() => void copyEnv()}>⧉ Copy env</button>
            <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setSyncOpen((v) => !v)} aria-expanded={syncOpen} disabled={!siblings.length} title={siblings.length ? "" : "No other web service uses this repo"}>⇄ Sync env</button>
            <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setImportOpen((v) => !v)} aria-expanded={importOpen}>⬇ Import env</button>
            <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setNewEnv((v) => !v)} aria-expanded={newEnv}>＋ Add variable</button>
          </div>
          {importOpen && <div className="rd-listbox">
            <strong>Import variables into {service.name}</strong>
            <select className="rd-field" aria-label="Import from" value={importSource} onChange={(e) => { setImportSource(e.target.value); setImportRows(null); }}>
              <option value="">Choose where to import from…</option>
              <optgroup label="All servers (every account, any project)">
                {importCandidates.map((t) => <option key={serviceKey(t)} value={serviceKey(t)}>{t.name} · {t.accountName || "account"}</option>)}
              </optgroup>
              <optgroup label="From env text"><option value="paste">Paste a .env…</option></optgroup>
            </select>
            {importSource === "paste" && <textarea className="rd-field" rows={5} spellCheck="false" aria-label="Paste env text" placeholder="NAME=value" value={importText} onChange={(e) => setImportText(e.target.value)} />}
            <button type="button" className="rd-btn rd-btn--quiet" disabled={importBusy || !importSource || (importSource === "paste" && !importText.trim())} onClick={() => void loadImport()}>{importBusy ? "Reading…" : "Show variables"}</button>
            {importRows && <>
              <p className="rd-note">Tick the ones you want. New ones are ticked; ones that already exist with another value are unticked (ticking replaces them).</p>
              <div>
                <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setImportPick(new Set(importRows.map((r) => r.key)))}>Select all</button>{" "}
                <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setImportPick(new Set())}>None</button>
              </div>
              {importRows.map((r) => (
                <label key={r.key} style={{ display: "block" }}>
                  <input type="checkbox" checked={importPick.has(r.key)} disabled={r.state === "same"} onChange={() => setImportPick((set) => { const n = new Set(set); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })} /> {r.key} <small>({r.state === "new" ? "new" : r.state === "same" ? "already the same" : "different value"})</small>
                </label>
              ))}
              <button type="button" className="rd-btn rd-btn--primary" onClick={stageImport}>Add {importPick.size} to {service.name}</button>
            </>}
          </div>}
          {syncOpen && siblings.length > 0 && <div className="rd-listbox">
            <strong>Sync environment variables</strong>
            <select className="rd-field" aria-label="Sync direction" value={syncDirection} onChange={(e) => setSyncDirection(e.target.value)}>
              <option value="to">From {service.name} (this server) → to the server below</option>
              <option value="from">From the server below → to {service.name} (this server)</option>
            </select>
            <div className="rd-note" role="group" aria-label="Web services to sync with">
              <div>
                <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setSyncSkip(new Set())}>Select all</button>{" "}
                <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setSyncSkip(new Set(siblings.map(serviceKey)))}>None</button>
              </div>
              {siblings.map((t) => (
                <label key={serviceKey(t)} style={{ display: "block" }}>
                  <input type="checkbox" checked={!syncSkip.has(serviceKey(t))} onChange={() => setSyncSkip((old) => { const n = new Set(old); if (n.has(serviceKey(t))) n.delete(serviceKey(t)); else n.add(serviceKey(t)); return n; })} /> {t.name} · {t.accountName || "account"}{serviceState(t, incidentKeys) === "suspended" ? " (suspended)" : ""}
                </label>
              ))}
            </div>
            <label className="rd-note"><input type="checkbox" checked={syncOverwrite} onChange={(e) => setSyncOverwrite(e.target.checked)} /> Also replace values that already exist on the target</label>
            <label className="rd-note"><input type="checkbox" checked={syncDeploy} onChange={(e) => setSyncDeploy(e.target.checked)} /> Redeploy servers that receive changes</label>
            <div><button type="button" className="rd-btn rd-btn--primary" disabled={syncBusy || envBusy} onClick={() => void syncEnv()}>{syncBusy ? "Syncing…" : "Sync now"}</button></div>
          </div>}
          {snapshots.length > 0 && <div className="rd-listbox"><strong>Encrypted snapshots</strong>{snapshots.map((s) => <article key={s.id}><div><b>{s.serviceName}</b><small>{formatDateTime(s.createdAt)} · {s.count} variables</small></div><button type="button" className="rd-btn rd-btn--quiet" disabled={snapshotBusy} onClick={() => void restoreSnapshot(s)}>Restore</button></article>)}</div>}
          {newEnv && <form className="rd-newenv" onSubmit={addEnv}><input data-autofocus className="rd-field" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="VARIABLE_NAME" aria-label="Variable name" autoComplete="off" spellCheck="false" required /><input className="rd-field" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Value" aria-label="Variable value" autoComplete="off" required /><button type="submit" className="rd-btn rd-btn--primary">Add</button></form>}
          {envBusy ? <Skeleton lines={5} height={34} /> : (
            <div className="rd-envlist">
              {envVars.filter((v) => !v.remove && v.key.toLowerCase().includes(envSearch.trim().toLowerCase())).map((v) => (
                <div className={"rd-envrow" + (v.isNew || v.value !== v.originalValue ? " is-dirty" : "")} key={v.key}>
                  <strong className="rd-mono">{v.key}{v.isNew && <small> NEW</small>}{!v.isNew && v.value !== v.originalValue && <small> EDITED</small>}</strong>
                  <input className="rd-field" type={reveal ? "text" : "password"} aria-label={"Value of " + v.key} value={v.value} onChange={(e) => setEnvVars((old) => old.map((x) => x.key === v.key ? { ...x, value: e.target.value } : x))} autoComplete="off" spellCheck="false" />
                  <button type="button" className="rd-icon-btn rd-icon-btn--danger" onClick={() => void removeEnv(v)} disabled={busy} aria-label={"Delete " + v.key}>×</button>
                </div>
              ))}
              {!envVars.length && <Empty icon="⌗" title="No direct variables">Render returned no environment variables set directly on this service.</Empty>}
            </div>
          )}
          {reveal ? <EnvText rows={textRows} onChange={applyEnvText} idPrefix="rd-env" /> : <p className="rd-note">Turn on “Reveal values” to edit all variables as text.</p>}
          <div className="rd-stickybar">
            <small>{dirty.length ? dirty.length + " unsaved change" + (dirty.length === 1 ? "" : "s") : "No unsaved changes"}</small>
            <div>
              <button type="button" className="rd-btn rd-btn--quiet" disabled={!dirty.length || busy} onClick={() => setEnvVars((old) => old.filter((v) => !v.isNew).map((v) => ({ ...v, value: v.originalValue, remove: false })))}>Discard</button>
              <button type="button" className="rd-btn rd-btn--primary" onClick={() => void saveEnv()} disabled={busy || envBusy || !dirty.length}>Save and deploy</button>
            </div>
          </div>
        </Section>}

        {tab === "domains" && <DomainPanel service={service} askConfirm={askConfirm} onAudit={onAudit} />}
        {tab === "deploys" && <Section title="Deployment history" subtitle="Most recent deployments for this service" actions={<button type="button" className="rd-icon-btn" aria-label="Refresh deployments" onClick={() => void loadDeploys()}>↻</button>}>
          {deployBusy && !deploys.length ? <Skeleton lines={5} height={36} /> : (
            <ol className="rd-deploys">
              {deploys.map((d) => (
                <li className="rd-deploy" key={d.id}>
                  <span className={"rd-deploy__status is-" + String(d.status || "unknown").replace(/_/g, "-")}>{String(d.status || "unknown").replace(/_/g, " ")}</span>
                  <div>
                    <strong>{d.commit?.message?.split("\n")[0] || d.id}</strong>
                    <small className="rd-mono">{d.commit?.id ? d.commit.id.slice(0, 8) + " · " : ""}{d.trigger || ""}</small>
                    {IN_PROGRESS.includes(String(d.status || "").toLowerCase()) && d.createdAt && <small className="rd-deploy__timer" aria-live="polite">
                      Elapsed {countdown(clockNow - Date.parse(d.createdAt))}
                      {typicalDeployMs != null ? (typicalDeployMs > clockNow - Date.parse(d.createdAt) ? " · estimated ~" + countdown(typicalDeployMs - (clockNow - Date.parse(d.createdAt))) + " remaining" : " · past typical duration") : " · ETA available after a completed deployment"}
                      <span>Estimate uses this service’s previous successful deploys.</span>
                    </small>}
                    <div className="rd-deploy__actions">
                      {IN_PROGRESS.includes(d.status) && <button type="button" className="rd-btn rd-btn--quiet" disabled={busy} onClick={() => void cancelDeploy(d)}>Cancel</button>}
                      {d.status === "live" && <button type="button" className="rd-btn rd-btn--quiet" disabled={busy} onClick={() => void rollback(d)}>Roll back to this</button>}
                    </div>
                  </div>
                  <time dateTime={d.createdAt} title={formatDateTime(d.createdAt)}>{timeAgo(d.createdAt)}</time>
                </li>
              ))}
              {!deploys.length && <Empty icon="↗" title="No deployments">Render returned no deployments for this service.</Empty>}
            </ol>
          )}
        </Section>}

        {tab === "database" && <Section title="Database exports" subtitle="Manual export jobs returned by Render. This is not a view of Render's automatic backups."
          actions={<><button type="button" className="rd-btn rd-btn--quiet" disabled={dbBusy} onClick={() => void loadDbExports()}>Refresh</button><button type="button" className="rd-btn rd-btn--primary" disabled={dbBusy} onClick={() => void createDbExport()}>Start export</button></>}>
          {dbBusy && !dbExports.length ? <Skeleton lines={3} height={30} /> : (
            <div className="rd-listbox">
              {dbExports.map((item, i) => <article key={item.id || i}><div><b>{item.id || "Export"}</b><small>{item.createdAt ? formatDateTime(item.createdAt) : "—"}</small></div>{item.url ? <a className="rd-btn rd-btn--quiet" href={safeUrl(item.url, "#")} target="_blank" rel="noreferrer noopener">Download</a> : <span className="rd-muted">{item.status || "pending"}</span>}</article>)}
              {!dbExports.length && <Empty icon="▤" title="No exports yet">Start an export to create a downloadable backup.</Empty>}
            </div>
          )}
        </Section>}
      </div>
    </Modal>
  );
}

