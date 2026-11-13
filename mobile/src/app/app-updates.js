import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Page, Loading, Note } from "../components/kit";
import { Box, Btn, Dim, Bad, Txt, Row, Toggle, Boundary, useAct } from "../components/home/h";
import { admin, rolloutSummary, cannotBePicked, rolloutPayload } from "../lib/adminApi";

const MODES = [
  ["all", "Everyone", "Whoever opens the app sees the new version (the old behaviour)."],
  ["selected", "Chosen devices only", "Only the ticked devices see the update. Nobody else."],
  ["hold", "Nobody (hold)", "Not offered to anyone yet. Choose when you are ready."],
];

/** Who gets a new app version: Stashr, Stashr Location, Stashr Hub and Stashr TV (administrators only). */
export default function AppUpdates() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => { try { setData(await admin.rollout()); setError(""); } catch (e) { setError(e.message || "Could not load."); } }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  return (
    <Page title="App updates" subtitle="When a new APK is built, this decides which devices are offered it as “update available”. Administrators only." onRefresh={refresh} refreshing={refreshing}>
      {error ? <Note tone="bad">{error}</Note> : null}
      {!data && !error ? <Loading /> : null}
      {data ? <View style={{ gap: 14 }}>{data.apps.map((a) => <Boundary key={a.key} name={a.label}><AppCard app={a} onSaved={load} /></Boundary>)}</View> : null}
    </Page>
  );
}

function AppCard({ app, onSaved }) {
  const [mode, setMode] = useState(app.rule.mode);
  const [ticked, setTicked] = useState(new Set(app.rule.devices));
  const [wait, setWait] = useState(app.defaultMode === "hold");
  const act = useAct();
  useEffect(() => { setMode(app.rule.mode); setTicked(new Set(app.rule.devices)); setWait(app.defaultMode === "hold"); }, [app]);
  const toggle = (id) => setTicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const warn = mode === "selected" ? cannotBePicked(app, ticked) : [];
  const save = async () => { if (await act(() => admin.saveRollout(app.key, rolloutPayload(mode, ticked, wait)), "Saved.")) onSaved(); };
  return (
    <Box title={app.label} subtitle={app.latest ? `New release: ${app.latest.version}${app.latest.publishedAt ? ` · ${new Date(app.latest.publishedAt).toLocaleString()}` : ""}` : "No release found yet."}>
      <Txt bold>{rolloutSummary(app)}</Txt>
      {app.latest ? (
        <>
          {MODES.filter(([m]) => app.selectable || m !== "selected").map(([m, label, hint]) => (
            <View key={m} style={{ gap: 2 }}>
              <Row><Btn label={`${mode === m ? "● " : "○ "}${label}`} onPress={() => setMode(m)} /></Row>
              {mode === m ? <Dim>{hint}</Dim> : null}
            </View>
          ))}
          {!app.selectable ? <Dim>In this app each phone is not told apart, so only “everyone” or “hold” is possible.</Dim> : null}
          {mode === "selected" ? (app.devices.length ? app.devices.map((d) => (
            <Toggle key={d.id} label={`${d.name}${d.person && d.person !== d.name ? ` (${d.person})` : ""}`}
              hint={`app ${d.installedVersion || "?"} · ${d.upToDate === true ? "up to date" : d.upToDate === false ? "update pending" : ""} · ${d.online ? "online" : "offline"}`}
              value={ticked.has(d.id)} onChange={() => toggle(d.id)} />
          )) : <Dim>No device is linked.</Dim>) : null}
          {warn.length ? <Bad>{`${warn.map((d) => d.name).join(", ")}: the app on ${warn.length === 1 ? "this device does" : "these devices do"} not tell the server who it is yet, so the update will not be shown. Update it by hand first.`}</Bad> : null}
          <Toggle label="Hold future releases of this app until I say OK" value={wait} onChange={setWait} />
          <Btn kind="primary" label="Save" onPress={save} disabled={mode === "selected" && !ticked.size} />
        </>
      ) : null}
    </Box>
  );
}
