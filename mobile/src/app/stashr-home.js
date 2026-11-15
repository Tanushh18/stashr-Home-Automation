import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { home } from "../lib/homeApi";
import { pushHomeWidget } from "../lib/homeWidget";
import { ago } from "../lib/smartHome";
import { weatherLine, comingLine } from "../lib/widgetText";
import { freshness, nodesOf, headline, quickActions, GREETING } from "../lib/commandCentre";
import { healthCounts } from "../components/home/Overview";
import { usePoll, Boundary } from "../components/home/h";
import Orb from "../components/stashrhome/Orb";

const BG = "#050912", INK = "#F8FAFC", MUTE = "#94A3B8", GREEN = "#22C55E", AMBER = "#F59E0B", RED = "#EF4444";
const TONE = { ok: GREEN, warn: AMBER, bad: RED };
const glass = { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderRadius: 20 };
const tick = () => Haptics.selectionAsync().catch(() => {});

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  return now;
}

/** Slowly drifting colour blobs behind everything. Skipped when the system asks for less motion. */
function Aurora({ tone, still }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return undefined;
    const l = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 14000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(a, { toValue: 0, duration: 14000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    l.start();
    return () => l.stop();
  }, [a, still]);
  const x = a.interpolate({ inputRange: [0, 1], outputRange: [-30, 30] });
  const y = a.interpolate({ inputRange: [0, 1], outputRange: [20, -20] });
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
      <Animated.View style={{ position: "absolute", top: -120, left: -100, width: 380, height: 380, borderRadius: 190, backgroundColor: tone, opacity: 0.16, transform: [{ translateX: x }, { translateY: y }] }} />
      <Animated.View style={{ position: "absolute", bottom: 40, right: -140, width: 360, height: 360, borderRadius: 180, backgroundColor: "#6366F1", opacity: 0.13, transform: [{ translateX: y }, { translateY: x }] }} />
    </View>
  );
}

function Glass({ title, right, children, style }) {
  return (
    <View style={[glass, { padding: 14, gap: 10 }, style]}>
      {title ? <View style={{ flexDirection: "row", alignItems: "center" }}><Text style={{ flex: 1, color: MUTE, fontSize: 11.5, letterSpacing: 1.2, fontWeight: "600" }}>{title.toUpperCase()}</Text>{right}</View> : null}
      {children}
    </View>
  );
}

/** Sends a sentence to the same assistant as the website, Telegram and tablet; shows exactly what the server answered. */
function CommandBar({ onDone }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]); // newest first: { q, a, ok }
  const send = useCallback(async (value) => {
    const q = String(value ?? text).trim();
    if (!q || busy) return;
    setBusy(true); tick();
    try {
      const r = await home.assistant(q);
      setLog((l) => [{ q, a: r.reply || "Done.", ok: true }, ...l].slice(0, 5));
      setText(""); onDone();
    } catch (e) {
      setLog((l) => [{ q, a: e.message || "That did not work.", ok: false }, ...l].slice(0, 5));
    } finally { setBusy(false); }
  }, [text, busy, onDone]);
  return (
    <Glass>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontSize: 20 }}>✨</Text>
        <TextInput
          value={text} onChangeText={setText} onSubmitEditing={() => send()} editable={!busy} returnKeyType="send" maxLength={200}
          placeholder="Ask Stashr… “movie night”, “kaun ghar par hai”" placeholderTextColor="#64748B"
          style={{ flex: 1, color: INK, fontSize: 15, paddingVertical: 6 }} accessibilityLabel="Ask Stashr"
        />
        <Pressable onPress={() => send()} disabled={busy || !text.trim()} accessibilityRole="button" accessibilityLabel="Send" style={{ backgroundColor: GREEN, opacity: busy || !text.trim() ? 0.4 : 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 }}>
          <Text style={{ color: "#052E16", fontWeight: "700" }}>{busy ? "…" : "Go"}</Text>
        </Pressable>
      </View>
      {log.map((m, i) => (
        <View key={i} style={{ gap: 2, borderTopWidth: i ? 0 : 1, borderTopColor: "rgba(255,255,255,0.08)", paddingTop: i ? 0 : 8 }}>
          <Pressable onPress={() => setText(m.q)} accessibilityHint="Puts this command back in the box to repeat or edit">
            <Text style={{ color: MUTE, fontSize: 12 }}>You · {m.q}  ↺</Text>
          </Pressable>
          <Text style={{ color: m.ok ? INK : RED, fontSize: 14, lineHeight: 20 }}>{m.a}</Text>
        </View>
      ))}
    </Glass>
  );
}

/** Scenes and quick actions. A button reports the server's answer; it never claims success on its own. */
function Actions({ scenes, devices, reload }) {
  const [state, setState] = useState({}); // key -> "run" | "ok" | "fail"
  const [msg, setMsg] = useState("");
  const run = async (key, fn, label) => {
    tick(); setState((s) => ({ ...s, [key]: "run" })); setMsg("");
    try { await fn(); setState((s) => ({ ...s, [key]: "ok" })); setMsg(`${label}: sent`); reload(); }
    catch (e) { setState((s) => ({ ...s, [key]: "fail" })); setMsg(`${label} failed: ${e.message || "no answer"}`); }
    setTimeout(() => setState((s) => ({ ...s, [key]: undefined })), 2500);
  };
  const quick = quickActions(devices);
  const chip = (key, label, onPress, disabled) => (
    <Pressable key={key} disabled={disabled || state[key] === "run"} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={{ ...glass, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14, opacity: disabled ? 0.4 : 1, borderColor: state[key] === "ok" ? GREEN : state[key] === "fail" ? RED : glass.borderColor }}>
      <Text style={{ color: INK, fontSize: 13.5, fontWeight: "600" }}>{state[key] === "run" ? "…" : state[key] === "ok" ? "✓ " : state[key] === "fail" ? "✕ " : ""}{label}</Text>
    </Pressable>
  );
  if (!scenes.length && !quick.length) return null;
  return (
    <Glass title="Scenes & quick actions">
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {scenes.map((s) => chip("s" + s.id, s.name, () => run("s" + s.id, () => home.runScene(s.id), s.name)))}
        {quick.map((q) => chip(q.key, `${q.icon} ${q.label}`, () => run(q.key, () => home.command(q.device.id, q.type, q.args), q.label), q.disabled))}
      </View>
      {msg ? <Text style={{ color: MUTE, fontSize: 12.5 }}>{msg}</Text> : null}
    </Glass>
  );
}

export default function StashrHome() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const now = useClock();
  const [dash, setDash] = useState(null);
  const [devices, setDevices] = useState(null);
  const [events, setEvents] = useState([]);
  const [at, setAt] = useState(0);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [still, setStill] = useState(false);
  const [, setBeat] = useState(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {});
    const s = AccessibilityInfo.addEventListener("reduceMotionChanged", setStill);
    const t = setInterval(() => setBeat((b) => b + 1), 20000); // re-evaluates freshness while nothing else changes
    return () => { s.remove(); clearInterval(t); };
  }, []);

  // Old numbers stay on screen when a refresh fails, but are labelled stale; they are never shown as live.
  const reload = useCallback(async () => {
    const [d, v, e] = await Promise.allSettled([home.dashboard(), home.devices(), home.events(6)]);
    let ok = false;
    if (d.status === "fulfilled") { setDash(d.value); pushHomeWidget(d.value); ok = true; }
    if (v.status === "fulfilled") { setDevices(v.value.devices || []); ok = true; }
    if (e.status === "fulfilled") setEvents(e.value.events || []);
    if (ok) { setAt(Date.now()); setError(""); }
    else setError((d.reason && d.reason.message) || "Could not reach Stashr.");
  }, []);
  usePoll(reload, 20000);
  const refresh = async () => { setRefreshing(true); await reload(); setRefreshing(false); };

  const fresh = freshness(at);
  const list = devices || [];
  const nodes = useMemo(() => nodesOf(list), [list]);
  const counts = useMemo(() => healthCounts(list.filter((x) => x.kind === "tv" || x.kind === "hub" || x.kind === "phone")), [list]);
  const offline = nodes.filter((n) => n.tone === "off").length;
  const head = headline({ bad: counts.bad, offline, error, fresh });
  const people = (dash && dash.people) || [];
  const here = people.filter((p) => p.home);
  const wl = dash ? weatherLine(dash.weather) : "";
  const coming = dash ? comingLine(dash.coming) : "";
  const scenes = (dash && dash.scenes) || [];
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  const orbSize = Math.min(width - 32, 330);

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <Aurora tone={TONE[head.tone]} still={still} />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 40, paddingHorizontal: 16, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={GREEN} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: MUTE, fontSize: 13 }}>{GREETING(now.getHours())} · {date}</Text>
            <Text style={{ color: INK, fontSize: 56, fontWeight: "200", letterSpacing: -2, lineHeight: 62 }} accessibilityLabel={`Time ${time}`}>{time}</Text>
            {wl ? <Text style={{ color: "#CBD5E1", fontSize: 13.5 }}>{wl}</Text> : null}
          </View>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close Stashr Home" style={{ ...glass, borderRadius: 14, width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: INK, fontSize: 16 }}>✕</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: TONE[head.tone] }} />
          <Text style={{ color: INK, fontWeight: "700", fontSize: 15 }}>{head.text}</Text>
          <Text style={{ color: MUTE, fontSize: 12.5, flexShrink: 1 }} numberOfLines={1}>· {head.sub}</Text>
        </View>
        <Text style={{ color: fresh === "live" ? GREEN : fresh === "none" ? MUTE : AMBER, fontSize: 12 }}>
          {fresh === "none" ? (error || "Loading…") : fresh === "live" ? "● Live" : `● Updated ${ago(at)}${error ? " · refresh failed" : ""}`}
        </Text>

        <Boundary name="Home orb">
          <Orb size={orbSize} accent={GREEN} bad={head.tone === "bad"} nodes={nodes} still={still}
            centre={people.length ? `${here.length}/${people.length}` : nodes.length ? String(nodes.filter((n) => n.tone !== "off").length) : "–"}
            sub={people.length ? (here.length ? `home: ${here.map((p) => p.person).join(", ")}` : "nobody home") : nodes.length ? "devices online" : "no devices linked"} />
        </Boundary>

        {coming ? <Glass><Text style={{ color: INK, fontSize: 14.5 }}>{coming}</Text></Glass> : null}

        <Boundary name="Ask Stashr"><CommandBar onDone={reload} /></Boundary>
        <Boundary name="Scenes"><Actions scenes={scenes} devices={list} reload={reload} /></Boundary>

        {nodes.length ? (
          <Glass title="Devices" right={<Text onPress={() => router.push("/home?tab=devices")} style={{ color: GREEN, fontSize: 12.5 }}>Open ›</Text>}>
            {nodes.map((n) => (
              <View key={n.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: n.tone === "on" ? GREEN : n.tone === "idle" ? AMBER : RED }} />
                <Text style={{ flex: 1, color: INK, fontSize: 14.5 }} numberOfLines={1}>{n.name}</Text>
                <Text style={{ color: MUTE, fontSize: 12.5 }}>{n.line}</Text>
              </View>
            ))}
          </Glass>
        ) : null}

        {dash && dash.speed ? (
          <Glass title="Internet"><Text style={{ color: INK, fontSize: 15 }}>{dash.speed.down} Mbit/s down · {dash.speed.up} up · {dash.speed.ping} ms <Text style={{ color: MUTE }}>({ago(dash.speed.at)})</Text></Text></Glass>
        ) : null}

        <Glass title="What happened" right={<Text onPress={() => router.push("/home")} style={{ color: GREEN, fontSize: 12.5 }}>All ›</Text>}>
          {events.length ? events.map((e) => <Text key={e.id || e.at} style={{ color: INK, fontSize: 13.5, lineHeight: 19 }}><Text style={{ color: MUTE }}>{ago(e.at)} · </Text>{e.text}</Text>) : <Text style={{ color: MUTE, fontSize: 13 }}>Nothing yet.</Text>}
        </Glass>

        <Pressable onPress={() => router.push("/home")} accessibilityRole="button" style={{ alignSelf: "center", padding: 10 }}>
          <Text style={{ color: MUTE, fontSize: 13 }}>Full Smart home settings ›</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
