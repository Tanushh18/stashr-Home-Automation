import React, { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { router } from "expo-router";
import { Page } from "../components/kit";
import { Box, Btn, Dim, Bad, Row, useAct } from "../components/home/h";
import { activeServer } from "../lib/api";
import { downloadApk, haveApk, installApk } from "../lib/apkInstall";

/** The Stashr apps and where to download them (the server serves the newest build of each). */
const APPS = [
  { key: "android", name: "Stashr", for: "Phone", text: "Passwords, projects, Money and Smart home on your phone (this app)." },
  { key: "hub", name: "Stashr Hub", for: "Home tablet", text: "The always-on tablet: camera alerts, voice commands, Wi-Fi scan, local mode and the WhatsApp sender." },
  { key: "tv", name: "Stashr TV", for: "TV", text: "The TV launcher: movies from Drive, notices, live map and cast receiver." },
  { key: "where", name: "Stashr Location", for: "Family phones", text: "Shares only where the phone is, in the background, with your own Stashr. Runs always-on with a per-phone switch." },
  { key: "cast", name: "Stashr Cast", for: "Phone", text: "Mirror your phone screen to the TV." },
  { key: "launcher", name: "Stashr Launcher", for: "Phone home screen", text: "The Stashr home screen (Lawnchair with Stashr's name, icon and colour). Updating keeps your layout." },
];

const mb = (n) => (Number(n) / (1024 * 1024)).toFixed(1);

/** One app: check the newest build, download it with a progress bar, open Android's installer; "Install" reuses a finished download. */
function AppCard({ app }) {
  const act = useAct();
  const base = activeServer().replace(/\/+$/, "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);
  const [ready, setReady] = useState(null);          // { uri, versionCode, version }
  const [latest, setLatest] = useState(null);

  // a build downloaded earlier is offered straight away (no second download)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${base}/api/mobile-updates/${app.key}/latest?currentVersionCode=0`, { headers: { Accept: "application/json" } });
        const m = await r.json();
        if (!r.ok) return;
        setLatest(m);
        const uri = await haveApk(app.key, m.versionCode, m.sizeBytes);
        if (uri) setReady({ uri, versionCode: m.versionCode, version: m.version });
      } catch (e) { /* offline: the buttons still work later */ }
    })();
  }, [app.key, base]);

  const open = async (uri, versionCode) => {
    try {
      const r = await installApk(uri);
      setStatus(r === "installer" ? `Build ${versionCode}: confirm the install on Android's screen. If nothing appears, press Install again.` : "Allow Stashr to install apps on the screen that opened, come back and press Install again.");
    } catch (e) { setError(`Could not open the installer: ${e.message || "unknown error"}`); }
  };

  const update = async () => {
    setBusy(true); setError(""); setStatus("Checking the newest build…");
    try {
      const r = await fetch(`${base}/api/mobile-updates/${app.key}/latest?currentVersionCode=0`, { headers: { Accept: "application/json" } });
      const m = await r.json();
      if (!r.ok) throw new Error(m.error || `the update server answered HTTP ${r.status}`);
      setLatest(m);
      setStatus(`Downloading ${app.name} ${m.version} (${m.sizeBytes ? `${mb(m.sizeBytes)} MB` : "size unknown"})…`);
      const uri = await downloadApk(app.key, m, (p) => { setProgress(p); setStatus(`Downloading ${app.name} ${m.version}: ${p.pct}% (${mb(p.got)} of ${p.total ? mb(p.total) : "?"} MB)`); });
      setReady({ uri, versionCode: m.versionCode, version: m.version });
      setStatus("File checked, the size matches. Opening Android's installer…");
      await open(uri, m.versionCode);
    } catch (e) {
      setError(`${e.message || "Could not download"}. Try again when online, or use the browser button.`);
    } finally { setBusy(false); setTimeout(() => setProgress(null), 3000); }
  };

  return (
    <Box title={app.name} subtitle={`${app.for}${latest ? ` · newest ${latest.version}` : ""}`}>
      <Dim>{app.text}</Dim>
      {progress ? <Dim>{`${progress.pct}%`}</Dim> : null}
      {status ? <Dim>{status}</Dim> : null}
      {error ? <Bad>{error}</Bad> : null}
      <Row>
        <Btn kind="primary" label={busy ? "Working…" : "Download & install"} disabled={busy} onPress={update} />
        {ready ? <Btn label={`Install ${ready.version || ""} (already downloaded)`} onPress={() => open(ready.uri, ready.versionCode)} /> : null}
        <Btn label="Open in browser" onPress={() => act(() => Linking.openURL(`${base}/api/mobile-updates/${app.key}/download`))} />
      </Row>
    </Box>
  );
}

export default function Apps() {
  return (
    <Page title="Apps" subtitle="Download or update any Stashr app. Android will ask you to confirm the install.">
      <View style={{ gap: 14 }}>
        <Box title="Phone setup" subtitle="Make the phone fast and keep payments working">
          <Dim>A checklist: Home app, accessibility off (for Google Pay), battery, unused apps, animations.</Dim>
          <Row><Btn kind="primary" label="Open the checklist" onPress={() => router.push("/phone-setup")} /></Row>
        </Box>
        {APPS.map((a) => <AppCard key={a.key} app={a} />)}
        <Dim>The Chrome extension and the website are on the Apps page of the website.</Dim>
      </View>
    </Page>
  );
}
