import React, { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { VideoView, useVideoPlayer } from "expo-video";
import { activeServer, authHeaders } from "../../lib/api";
import { home, mediaPath } from "../../lib/homeApi";
import { ago } from "../../lib/smartHome";
import { Bad, Boundary, Box, Btn, Dim, Input, Pick, Row, Sub, Toggle, Txt, ask, useAct, usePoll } from "./h";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A time box that saves only when it looks like 23:30. */
function TimeBox({ value, onSave, label }) {
  const [v, setV] = useState(value || "");
  useEffect(() => setV(value || ""), [value]);
  return <Input value={v} onChangeText={(t) => { setV(t); if (TIME.test(t) && t !== value) onSave(t); }} placeholder={label || "HH:MM"} keyboardType="numbers-and-punctuation" maxLength={5} style={{ minWidth: 80, flexGrow: 0, width: 90 }} />;
}

const mediaUri = (id) => `${activeServer()}${mediaPath(id)}`;

function ClipPlayer({ uri }) {
  const player = useVideoPlayer({ uri, headers: authHeaders() }, (p) => { p.play(); });
  return <VideoView player={player} style={{ width: "100%", height: 280, backgroundColor: "#000" }} nativeControls contentFit="contain" />;
}

function Viewer({ item, onClose, onDelete }) {
  if (!item) return null;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} transparent>
      <View style={{ flex: 1, backgroundColor: "#000d", justifyContent: "center", padding: 12, gap: 12 }}>
        {item.kind === "video" ? <ClipPlayer uri={mediaUri(item.id)} /> : <Image source={{ uri: mediaUri(item.id), headers: authHeaders() }} style={{ width: "100%", height: 360 }} contentFit="contain" />}
        <Dim style={{ color: "#fff" }}>{item.reason === "motion" ? "Movement" : item.kind === "video" ? "Clip" : "Photo"} · {ago(item.at)}</Dim>
        <Row><Btn label="Close" kind="primary" onPress={onClose} /><Btn label="Delete" kind="danger" onPress={onDelete} /></Row>
      </View>
    </Modal>
  );
}

/** The tablet camera's frames, one about every 1.5 s. */
function LiveView({ hub, onClose }) {
  const act = useAct();
  const [n, setN] = useState(0);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const start = () => act(() => home.command(hub.id, "camera", { action: "live" }));
    start();
    // Every frame is written to the database and sent to the phone: the live view closes itself after 10 minutes (the free plan's bandwidth).
    const t0 = Date.now();
    const ask_ = setInterval(() => { if (Date.now() - t0 > 10 * 60 * 1000) { onClose(); return; } start(); }, 110 * 1000);
    const tick = setInterval(() => { if (Date.now() - t0 > 10 * 60 * 1000) return; setN((x) => x + 1); }, 1500);
    return () => { clearInterval(ask_); clearInterval(tick); };
  }, [hub.id]);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ height: 220, backgroundColor: "#000", borderRadius: 10, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
        <Image source={{ uri: `${activeServer()}/home/camera/live?t=${n}`, headers: authHeaders() }} style={{ width: "100%", height: "100%" }} contentFit="contain" cachePolicy="none" onLoad={() => setShown(true)} />
        {!shown ? <Dim style={{ position: "absolute", color: "#fff" }}>Connecting to the tablet camera…</Dim> : null}
      </View>
      <Dim>● LIVE · about one picture every 1–2 seconds. Closes itself after 10 minutes.</Dim>
      <Btn label="Close live view" onPress={onClose} />
    </View>
  );
}

function Thumb({ item, onOpen }) {
  return (
    <Pressable onPress={() => onOpen(item)} style={{ width: 96, height: 72, borderRadius: 8, overflow: "hidden", backgroundColor: "#0003", alignItems: "center", justifyContent: "center" }}>
      {item.kind === "video" ? <Txt bold>▶ Clip</Txt> : <Image source={{ uri: mediaUri(item.id), headers: authHeaders() }} style={{ width: 96, height: 72 }} contentFit="cover" recyclingKey={item.id} />}
    </Pressable>
  );
}

function CameraCard({ devices, settings: s, save }) {
  const act = useAct();
  const hub = devices.find((d) => d.kind === "hub" && d.status?.agent === "stashr-hub");
  const [list, setList] = useState(null);
  const [live, setLive] = useState(false);
  const [open, setOpen] = useState(null);
  const load = async () => { try { setList((await home.media()).media); } catch { /* hidden */ } };
  usePoll(load, 30000);
  if (!hub && !(list && list.length)) return null;
  const cam = hub?.status?.camera || {};
  const cmd = (action, text) => act(async () => { await home.command(hub.id, "camera", { action }); }, text);
  return (
    <Box title="Security camera" subtitle={hub ? `${hub.name} · ${cam.armed ? "🔴 guarding: records and alerts on movement" : "off: the camera is closed"}${cam.lastMotion ? ` · last movement ${ago(cam.lastMotion)}` : ""}` : "Photos and clips from the tablet"}>
      {hub ? (
        <>
          {cam.armed ? <Btn label="Stop security camera" kind="danger" onPress={() => cmd("disarm", "Security camera stopped.")} /> : <Btn label="Start security camera" kind="primary" onPress={() => cmd("arm", "Security camera started. You get a photo and a clip on Telegram when someone moves in view.")} />}
          <Dim>While it is on, the tablet watches its camera. When someone moves in view it sends a photo at once, then records while the movement lasts (up to a minute) and sends the clip. Everything is kept for 14 days. The camera stays closed while it is off.</Dim>
          <Row>
            <Btn label={live ? "Hide live view" : "👁 Live view"} onPress={() => setLive(!live)} />
            <Btn label="Take a photo" onPress={() => cmd("snapshot", "Taking a photo…")} />
            <Btn label="Record a clip" onPress={() => cmd("clip", "Recording 10 seconds…")} />
          </Row>
          {live ? <LiveView hub={hub} onClose={() => setLive(false)} /> : null}
          {s ? (
            <>
              <Sub>Sensitivity: {s.camera.sensitivity} of 10</Sub>
              <Pick options={[1, 3, 5, 7, 10].map((n) => [n, String(n)])} value={s.camera.sensitivity} onChange={(n) => save({ camera: { sensitivity: n } }, "Sensitivity saved.")} />
              <Toggle label="Record clips on movement" value={s.camera.video} onChange={(v) => save({ camera: { video: v } })} />
              <Toggle label="Turn on by itself when everyone is out, off when someone is home" value={Boolean(s.camera.auto)} onChange={(v) => save({ camera: { auto: v } }, v ? "The camera will turn on when everyone is out and off when someone is back." : "Automatic camera is off.")} />
            </>
          ) : null}
        </>
      ) : null}
      {cam.error ? <Bad>{cam.error}</Bad> : null}
      {list && list.length ? <Row gap={6}>{list.map((m) => <Thumb key={m.id} item={m} onOpen={setOpen} />)}</Row> : <Dim>No recordings yet.</Dim>}
      <Viewer item={open} onClose={() => setOpen(null)} onDelete={async () => { if (await ask("Delete this?", "It is removed from Stashr.", "Delete", true) && await act(() => home.deleteMedia(open.id), "Deleted.")) { setOpen(null); load(); } }} />
    </Box>
  );
}

function AlertsCard({ settings: s, save }) {
  const act = useAct();
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (s) setCity(s.weather.city || ""); }, [s]);
  if (!s) return null;
  const a = s.alerts;
  const setA = (k, v) => save({ alerts: { [k]: v } });
  const test = async (which) => {
    setBusy(true);
    const r = await act(() => home.testBrief(which));
    setBusy(false);
    if (r && r.text !== undefined) await ask(r.sent ? "Sent to your Telegram." : "Connect Telegram in Settings to get it there. Here it is:", String(r.text).replace(/<[^>]+>/g, ""), "OK");
  };
  return (
    <Box title="Alerts and daily briefs" subtitle="Sent to your Telegram bot (connect it in Settings). Everything is also in “What happened”.">
      <Sub>Tell me when</Sub>
      <Toggle label="A new device joins the Wi-Fi" value={a.newDevice} onChange={(v) => setA("newDevice", v)} />
      <Toggle label="An unknown device joins at night" value={a.night} onChange={(v) => setA("night", v)} />
      <Row><Dim>Night is</Dim><TimeBox value={a.nightFrom} onSave={(t) => setA("nightFrom", t)} /><Dim>to</Dim><TimeBox value={a.nightTo} onSave={(t) => setA("nightTo", t)} /></Row>
      <Toggle label="Remind someone to take an umbrella when they leave and rain is likely" value={s.rain !== false} onChange={(v) => save({ rain: v }, v ? "People who leave home when rain is likely get a “take an umbrella” message." : "Umbrella reminders are off.")} />
      <Toggle label="Someone comes home or leaves" value={a.presence} onChange={(v) => setA("presence", v)} />
      <Toggle label="Nobody is home but the TV is on" value={a.emptyHomeTv} onChange={(v) => setA("emptyHomeTv", v)} />
      <Toggle label="The tablet camera sees someone (with the photo)" value={a.camera} onChange={(v) => setA("camera", v)} />
      <Sub>Briefs</Sub>
      <Toggle label="Morning brief: weather, who is home, TV, Wi-Fi, internet" value={s.brief.enabled} onChange={(v) => save({ brief: { enabled: v } })} />
      <Row><Dim>at</Dim><TimeBox value={s.brief.time} onSave={(t) => save({ brief: { time: t } })} /><Btn label="Send one now" disabled={busy} onPress={() => test("brief")} /></Row>
      <Toggle label="Weekly report, Sundays at 20:00" value={s.weekly.enabled} onChange={(v) => save({ weekly: { enabled: v } })} />
      <Btn label="Send a weekly report now" disabled={busy} onPress={() => test("weekly")} />
      <Row wrap={false}>
        <Input value={city} onChangeText={setCity} placeholder="Your city, for the weather" maxLength={80} autoCapitalize="words" style={{ flex: 1 }} />
        <Btn label="Save" onPress={() => save({ weatherCity: city }, "Weather place saved.")} />
      </Row>
      <Sub>News on the TV</Sub>
      <Toggle label="Morning headlines on the TV launcher" value={s.news?.enabled !== false} onChange={(v) => save({ news: { enabled: v } })} />
      <Pick options={[["en", "English"], ["hi", "हिन्दी"], ["both", "Both"]]} value={s.news?.lang || "en"} onChange={(v) => save({ news: { lang: v } })} />
      <Pick options={[3, 5, 6, 8, 10].map((n) => [n, `${n} headlines`])} value={s.news?.count || 6} onChange={(v) => save({ news: { count: v } })} />
      <Dim>Headlines come from the public Google News (India) feed. The first time the TV shows its home screen each morning, it shows the weather and the top headlines for half a minute. Times are in {s.timezone}.</Dim>
    </Box>
  );
}

export default function Security({ ctx }) {
  const { devices, settings, save } = ctx;
  return (
    <>
      <Boundary name="Security camera"><CameraCard devices={devices} settings={settings} save={save} /></Boundary>
      <Boundary name="Alerts"><AlertsCard settings={settings} save={save} /></Boundary>
    </>
  );
}
