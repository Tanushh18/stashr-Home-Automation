import React, { useState } from "react";
import { View } from "react-native";
import { home } from "../../lib/homeApi";
import { pushHomeWidget, widgetSupported, widgetCount, requestPin, syncHomeWidgetTask } from "../../lib/homeWidget";
import { ago, fmtMinutes, healthItems } from "../../lib/smartHome";
import { Boundary, Bad, Box, Btn, Dim, Good, Input, Row, Txt, Dot, usePoll, useLoad, Sub } from "./h";

/** Ask Stashr: the same sentences the website, Telegram and the tablet understand. */
function Assistant({ reload }) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try { const r = await home.assistant(t); setReply(r.reply); setText(""); reload(); }
    catch (e) { setReply(e.message || "Could not do that."); }
    finally { setBusy(false); }
  };
  return (
    <Box title="Ask Stashr" subtitle="“volume up”, “tv ki awaaz kam karo”, “arijit ke gaane chalao”, “movie night”, “kaun ghar par hai”, “camera on”, “speed test”">
      <Row wrap={false}>
        <Input value={text} onChangeText={setText} placeholder="What should I do?" maxLength={200} onSubmitEditing={ask} autoCapitalize="sentences" style={{ flex: 1 }} />
        <Btn label={busy ? "…" : "Send"} kind="primary" onPress={ask} disabled={busy} />
      </Row>
      {reply ? <Txt bold>{reply}</Txt> : null}
    </Box>
  );
}

const comingText = (c) => (c.minutes <= 1 ? `${c.person} bas pahunchne wale hain` : `${c.person} ${c.minutes} minute mein aa rahe hain`);

/** A live copy of what the tablet's screen shows. */
function HomeScreen() {
  const { data: d, setData } = useLoad(() => home.dashboard(), []);
  usePoll(async () => { setData(await home.dashboard()); }, 20000);
  // The home-screen widget shows the same picture: hand it what was just loaded (no extra request).
  React.useEffect(() => { pushHomeWidget(d); }, [d]);
  const [placed, setPlaced] = useState(() => widgetCount() > 0);
  if (!d) return null;
  const w = d.weather;
  return (
    <Box title="Home screen" subtitle="The same things the tablet shows, live.">
      {(d.coming || []).map((c) => <Good key={c.person}>🚗 {comingText(c)} · {c.km} km door</Good>)}
      <Txt bold>{new Date(d.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {w ? `${String(w.city || "").split(",")[0]} ${w.temp}°C · ${w.text} · ${w.min}–${w.max}°C${w.rainChance != null ? ` · ${w.rainChance}% rain` : ""}` : "Set your city under Camera & alerts → Alerts to see the weather."}</Txt>
      <Row>
        {d.people.length ? d.people.map((p) => <Txt key={p.person}>{p.home ? "● " : "○ "}{p.person} · {p.home ? "home" : "out"}</Txt>) : <Dim>Give a Wi-Fi device a person, or link a family phone.</Dim>}
      </Row>
      {d.tvs.map((t) => <Txt key={t.name}>📺 {t.name}: {!t.online ? "off or not connected" : t.screen === "off" ? "standby" : `on${t.app ? ` · ${t.app}` : ""}${t.title ? ` · ${t.title}` : ""}`}</Txt>)}
      <Txt>⏱ TV today: {fmtMinutes(d.tvMinutesToday || 0)}</Txt>
      {d.speed ? <Txt>🚀 Internet: {d.speed.down} Mbit/s down · {d.speed.up} up · {d.speed.ping} ms · {ago(d.speed.at)}</Txt> : null}
      {d.events.slice(0, 5).map((e, i) => <Dim key={i}>{ago(e.at)} · {e.text}</Dim>)}
      {widgetSupported && !placed ? (
        <Btn
          label="Add to phone's home screen"
          onPress={() => {
            if (!requestPin()) return;
            // The launcher asks the person first; check a little later and start the 15-minute refresh once it is there.
            setTimeout(() => { const on = widgetCount() > 0; setPlaced(on); if (on) { pushHomeWidget(d); syncHomeWidgetTask(); } }, 6000);
          }}
        />
      ) : null}
    </Box>
  );
}

/** What is switched on, and whether it is on right now. */
function Features({ settings: s, devices, go }) {
  if (!s) return null;
  const hub = devices.find((d) => d.kind === "hub" && d.status?.agent === "stashr-hub");
  const phones = devices.filter((d) => d.kind === "phone");
  const sharing = phones.filter((p) => p.status?.location && Date.now() - Number(p.status.location.at) < 45 * 60 * 1000);
  const a = s.alerts || {};
  const rows = [
    ["Devices", [
      ["Home tablet (Stashr Hub)", hub ? (hub.online ? "on" : "offline") : "off", hub ? "" : "Link it under Devices", "devices"],
      ["Family phones", phones.length ? "on" : "off", phones.length ? `${phones.length} linked` : "None linked yet", "devices"],
      ["Phone locations (Stashr Location)", sharing.length ? "on" : "off", sharing.length ? `${sharing.length} sharing` : "Link phones with the Stashr Location app", "devices"],
    ]],
    ["Camera and alerts", [
      ["Security camera", hub?.status?.camera?.armed ? "on" : "off", "", "security"],
      ["Camera on when everyone is out", s.camera?.auto ? "on" : "off", "", "security"],
      ["Movement alerts", a.camera !== false ? "on" : "off", "", "security"],
      ["New device on the Wi-Fi", a.newDevice !== false ? "on" : "off", "", "security"],
      ["Unknown device at night", a.night !== false ? "on" : "off", `${a.nightFrom || "00:00"}–${a.nightTo || "05:00"}`, "security"],
      ["Someone came home or left", a.presence ? "on" : "off", "", "security"],
      ["Nobody home but the TV is on", a.emptyHomeTv !== false ? "on" : "off", "", "security"],
      ["Morning brief", s.brief?.enabled ? "on" : "off", s.brief?.enabled ? `at ${s.brief.time}` : "", "security"],
      ["Weekly report", s.weekly?.enabled ? "on" : "off", "Sunday 20:00", "security"],
    ]],
    ["Automations", [
      ["Scenes", (s.scenes || []).length ? "on" : "off", `${(s.scenes || []).length} ready`, "automations"],
      ["Schedules", (s.schedules || []).some((x) => x.enabled !== false) ? "on" : "off", `${(s.schedules || []).filter((x) => x.enabled !== false).length} running`, "automations"],
      ["Daily TV limit", s.tvLimit?.minutes ? "on" : "off", s.tvLimit?.minutes ? `${fmtMinutes(s.tvLimit.minutes)}, then ${s.tvLimit.action}` : "", "automations"],
      ["Places and WhatsApp messages", (s.places || []).some((x) => x.enabled !== false) ? "on" : "off", `${(s.places || []).length} places`, "automations"],
      ["Who is on the way home", s.homeSpot && s.eta?.enabled !== false ? "on" : "off", s.homeSpot ? "" : "Set your home location under Places", "automations"],
      ["Location history and insights", s.history?.enabled ? "on" : "off", "Off until you turn it on", "insights"],
    ]],
    ["Media and network", [
      ["Weather", s.weather?.city ? "on" : "off", s.weather?.city || "Set a city under Camera & alerts", "security"],
      ["Morning headlines on the TV", s.news?.enabled !== false ? "on" : "off", "", "security"],
      ["Umbrella reminder when leaving", s.rain !== false ? "on" : "off", "Needs the weather city", "security"],
      ["Internet speed tests", hub?.status?.speed ? "on" : "off", "Every hour from the tablet", "media"],
      ["Photo frame (slideshow)", s.slideshowFolder ? "on" : "off", "", "media"],
    ]],
  ];
  return (
    <Box title="What is switched on" subtitle="Everything you can turn on, and whether it is on right now. Tap a name to open its section.">
      {rows.map(([group, items]) => (
        <View key={group} style={{ gap: 6 }}>
          <Sub>{group}</Sub>
          {items.map(([name, state, note, tab]) => (
            <Row key={name} wrap={false} style={{ paddingVertical: 2 }}>
              <Dot tone={state === "on" ? "ok" : state === "offline" ? "warn" : "mute"} />
              <View style={{ flex: 1 }}>
                <Txt onPress={() => go(tab)}>{name}</Txt>
                {note ? <Dim>{note}</Dim> : null}
              </View>
              <Dim>{state === "on" ? "On" : state === "offline" ? "Offline" : "Off"}</Dim>
            </Row>
          ))}
        </View>
      ))}
    </Box>
  );
}

export function healthCounts(devices) {
  let bad = 0, warn = 0;
  for (const d of devices) for (const i of healthItems(d)) { if (i.state === "bad") bad++; else if (i.state === "warn") warn++; }
  return { bad, warn };
}

export default function Overview({ ctx }) {
  const { devices, events, settings, go, reload } = ctx;
  const c = healthCounts(devices.filter((d) => d.kind === "tv" || d.kind === "hub" || d.kind === "phone"));
  return (
    <>
      {c.bad ? (
        <Box><Bad>{c.bad} thing{c.bad > 1 ? "s" : ""} on your devices need{c.bad > 1 ? "" : "s"} fixing.</Bad><Btn label="Open the health check" onPress={() => go("health")} /></Box>
      ) : null}
      <Boundary name="Ask Stashr"><Assistant reload={reload} /></Boundary>
      <Boundary name="Home screen"><HomeScreen /></Boundary>
      <Boundary name="What is switched on"><Features settings={settings} devices={devices} go={go} /></Boundary>
      <Boundary name="What happened">
        <Box title="What happened" subtitle="The last 60 days are kept">
          {events.length ? events.map((e) => <Dim key={e.id}>{ago(e.at)} · <Txt>{e.text}</Txt></Dim>) : <Dim>Nothing yet.</Dim>}
        </Box>
      </Boundary>
    </>
  );
}
