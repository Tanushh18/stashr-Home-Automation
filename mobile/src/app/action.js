import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Page, Note } from "../components/kit";
import { GhostButton } from "../components/ui";
import { useTheme } from "../lib/theme";
import { home } from "../lib/homeApi";
import { actionKey } from "../lib/homeWidget";

/*
 * Runs a one-tap action from a Stashr home-screen widget (Scenes, TV remote, Quick actions).
 * It is behind the unlock (Stack.Protected in _layout.js), runs only when the link carries this install's secret key (so no
 * other app can fire it) and only the whitelisted commands below. It shows what the server answered: nothing is pretended.
 */
const TV = { media: ["play_pause"], volume: ["up", "down", "mute"], key: ["HOME"] };
const TV_WORDS = { play_pause: "Play / pause", up: "Volume up", down: "Volume down", mute: "Mute", HOME: "Home" };

/** What to do, from the link, or { error } when the link is not one of ours or not a known button. */
function planOf(p, key) {
  if (!key || String(p.k || "") !== key) return { error: "This link did not come from your Stashr widget, so nothing was done." };
  if (p.do === "scene" && typeof p.id === "string" && p.id) return { kind: "scene", id: p.id, label: "Running the scene" };
  if (p.do === "tv" && TV[p.type] && TV[p.type].includes(p.a)) {
    return { kind: "tv", type: p.type, args: p.type === "key" ? { key: p.a } : { action: p.a }, label: `TV: ${TV_WORDS[p.a]}` };
  }
  if (p.do === "camera") return { kind: "camera", label: "Taking a camera photo" };
  return { error: "This widget button is not known to this version of Stashr." };
}

async function run(plan) {
  if (plan.kind === "scene") {
    const r = await home.runScene(plan.id);
    const sent = Number(r && r.sent) || 0;
    if (!sent) throw new Error("No device in this scene could take the command (the TV or tablet may be offline).");
    return `Sent ${sent} command${sent > 1 ? "s" : ""} to your devices. They run within a few seconds.`;
  }
  const { devices } = await home.devices();
  if (plan.kind === "tv") {
    const tv = (devices || []).find((d) => d.kind === "tv");
    if (!tv) throw new Error("No TV is linked to Stashr.");
    if (!tv.online) throw new Error(`${tv.name || "The TV"} is off or not connected, so the command was not sent.`);
    await home.command(tv.id, plan.type, plan.args);
    return `Sent to ${tv.name || "the TV"}. It runs within a few seconds.`;
  }
  const hub = (devices || []).find((d) => d.kind === "hub" && d.online && d.status && d.status.agent === "stashr-hub");
  if (!hub) throw new Error("The home tablet is offline, so no photo can be taken.");
  await home.command(hub.id, "camera", { action: "snapshot" });
  return `Asked ${hub.name || "the tablet"} for a photo. It appears under Smart home → Camera & alerts.`;
}

export default function WidgetAction() {
  const { theme } = useTheme();
  const params = useLocalSearchParams();
  const [state, setState] = useState({ busy: true, ok: false, text: "" });
  const started = useRef(false);
  const sig = JSON.stringify(params);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planOf(params, actionKey()), [sig]);
  const timer = useRef(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (plan.error) { setState({ busy: false, ok: false, text: plan.error }); return; }
    run(plan)
      .then((text) => {
        setState({ busy: false, ok: true, text });
        // Done: back to the home screen the person came from.
        timer.current = setTimeout(() => BackHandler.exitApp(), 1200);
      })
      .catch((e) => setState({ busy: false, ok: false, text: e.message || "Stashr could not do that." }));
  }, [plan]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <Page title={plan.label || "Widget action"} subtitle="From your Stashr home-screen widget" back={false}>
      {state.busy ? (
        <View style={{ paddingVertical: 24, alignItems: "center", gap: 10 }}>
          <ActivityIndicator color={theme.accent} />
          <Text style={{ color: theme.textMuted, fontFamily: theme.font.body }}>Talking to Stashr…</Text>
        </View>
      ) : (
        <Note tone={state.ok ? "ok" : "bad"}>{state.text}</Note>
      )}
      {!state.busy && !state.ok ? <GhostButton title="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} /> : null}
    </Page>
  );
}
