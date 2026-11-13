import React, { useState } from "react";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { home } from "../../lib/homeApi";
import {
  STATE_LABEL, TAG_LABEL, ago, batteryOf, fmtBytes, groupByRoom, lanName, nowPlaying, signalWord, splitStale, stateOf,
} from "../../lib/smartHome";
import { Bad, Boundary, Box, Btn, Dim, Dot, Good, Input, Pick, Row, Sub, Toggle, Txt, ask, useAct, useLoad, usePoll } from "./h";
import { FamilyMap } from "./Charts";

const APPS = [["Netflix", "com.netflix.ninja"], ["Prime Video", "com.amazon.amazonvideo.livingroom"], ["JioHotstar", "in.startv.hotstar"], ["YouTube", "com.google.android.youtube.tv"], ["MX Player", "com.mxtech.videoplayer.television"], ["Zee5", "com.graymatrix.did"]];
const tone = (state) => (state === "on" ? "ok" : state === "standby" || state === "idle" ? "warn" : "mute");

/** Rename or remove a device. */
/** Merge a device that was linked again under another name into the one you keep: its history, places and trail move over, then it is removed. */
function MergeInto({ device, reload }) {
  const act = useAct();
  const [open, setOpen] = useState(false);
  const [others, setOthers] = useState(null);
  const show = async () => {
    setOpen(true);
    try { const r = await home.devices(); setOthers((r.devices || []).filter((d) => d.id !== device.id && d.kind === device.kind && !d.viaHub)); } catch (e) { setOthers([]); }
  };
  if (!open) return <Btn label="Merge into…" onPress={show} />;
  return (
    <View style={{ gap: 6 }}>
      <Dim>{`Keep which one? "${device.name}" is removed and everything recorded for it moves to the one you pick (it keeps its own name).`}</Dim>
      {others === null ? <Dim>Loading…</Dim> : others.length === 0 ? <Dim>There is no other {device.kind === "phone" ? "phone" : device.kind === "tv" ? "TV" : "tablet"} to merge into.</Dim> : others.map((o) => (
        <Btn key={o.id} label={`${o.name} (${o.online ? "online" : "offline"})`} onPress={async () => {
          if (await ask(`Merge "${device.name}" into "${o.name}"?`, `Everything recorded for "${device.name}" (history, places, trail, room samples) moves to "${o.name}". Then "${device.name}" is removed. This cannot be undone.`, "Merge", true) && await act(() => home.mergeDevice(device.id, o.id), "Merged.")) { setOpen(false); reload(); }
        }} />
      ))}
      <Btn label="Cancel" onPress={() => setOpen(false)} />
    </View>
  );
}

function DeviceMenu({ device, reload }) {
  const act = useAct();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(device.name);
  if (!open) return <Btn label="⋯" onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: 8 }}>
      <Input value={name} onChangeText={setName} placeholder="Name" maxLength={60} autoCapitalize="words" />
      <Row>
        <Btn label="Save name" kind="primary" onPress={async () => { if (await act(() => home.renameDevice(device.id, name.trim()), "Renamed.")) { setOpen(false); reload(); } }} />
        <Btn label="Remove device" kind="danger" onPress={async () => { if (await ask(`Remove ${device.name}?`, "It stops reporting. Link it again with the code to bring it back.", "Remove", true) && await act(() => home.removeDevice(device.id), "Removed.")) reload(); }} />
        <Btn label="Close" onPress={() => setOpen(false)} />
      </Row>
      <MergeInto device={device} reload={reload} />
    </View>
  );
}

function Pending({ commands }) {
  const list = (commands || []).slice(0, 3);
  if (!list.length) return null;
  return <View>{list.map((c) => <Dim key={c.id}>{c.type.replace(/_/g, " ")}{c.args?.name ? ` · ${c.args.name}` : ""}: {c.status === "done" ? "done" : c.status === "failed" ? "failed" : "waiting"}{c.result ? ` · ${c.result}` : ""}</Dim>)}</View>;
}

function TvCard({ device, reload }) {
  const act = useAct();
  const [url, setUrl] = useState("");
  const s = device.status || {}, state = stateOf(device), usb = s.usb || {}, movies = s.movies || [];
  const cmd = (type, args, text) => act(async () => { await home.command(device.id, type, args); reload(); }, text || "Sent. The TV picks it up within a minute.");
  return (
    <Box title={`📺 ${device.name}`} subtitle={`${STATE_LABEL[state]} · seen ${ago(device.lastSeen)}`} right={<Dot tone={tone(state)} />}>
      <Txt bold>{state === "on" ? nowPlaying(s) : state === "standby" ? "Screen is off" : "Not connected"}</Txt>
      <Dim>{[s.wifi?.rssi ? `Wi-Fi ${signalWord(s.wifi.rssi)} (${s.wifi.rssi} dBm)` : "", s.volume?.max ? `Volume ${s.volume.level}/${s.volume.max}` : "", s.version ? `App ${s.version}` : "", s.cast?.active ? `Mirroring ${s.cast.from || "a phone"}` : ""].filter(Boolean).join(" · ")}</Dim>
      {state !== "off" ? (
        <>
          <Row><Btn label="⏮" onPress={() => cmd("media", { action: "previous" })} /><Btn label="⏯ Play / Pause" kind="primary" onPress={() => cmd("media", { action: "play_pause" })} /><Btn label="⏭" onPress={() => cmd("media", { action: "next" })} /></Row>
          <Row><Btn label="Vol −" onPress={() => cmd("volume", { action: "down" })} /><Btn label="Vol +" onPress={() => cmd("volume", { action: "up" })} /><Btn label="Mute" onPress={() => cmd("volume", { action: "mute" })} /><Btn label="Home" onPress={() => cmd("key", { key: "HOME" })} /><Btn label="Back" onPress={() => cmd("key", { key: "BACK" })} /></Row>
          <Row>{APPS.map(([label, pkg]) => <Btn key={pkg} label={label} onPress={() => cmd("launch_app", { package: pkg }, `Opening ${label}…`)} />)}</Row>
          <Row><Btn label="Live location on the TV" onPress={() => cmd("live_location", {}, "Opening the live map on the TV…")} />{s.cast?.active ? <Btn label="Stop mirroring" onPress={() => cmd("mirror_stop", {}, "Stopped.")} /> : null}</Row>
          <Row wrap={false}>
            <Input value={url} onChangeText={setUrl} placeholder="YouTube link to play on the TV" style={{ flex: 1 }} />
            <Btn label="Open" disabled={!/^https:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(url.trim())} onPress={async () => { if (await cmd("open_url", { url: url.trim() }, "Opening on the TV…")) setUrl(""); }} />
          </Row>
        </>
      ) : null}
      <Sub>USB drive</Sub>
      {usb.present === false ? <Dim>No USB drive is plugged in.</Dim> : usb.total ? <Dim>{fmtBytes(usb.free)} free of {fmtBytes(usb.total)}{usb.fs === "vfat" ? " · FAT32 (files must be under 4 GB)" : ""}</Dim> : <Dim>No details yet.</Dim>}
      {s.upload?.active ? <Dim>Receiving {s.upload.name}: {Math.round(100 * (s.upload.done || 0) / Math.max(1, s.upload.size || 1))}%</Dim> : null}
      {s.sync?.line ? <Dim>{s.sync.line}</Dim> : null}
      {s.sync?.error ? <Bad>Sync: {s.sync.error}</Bad> : null}
      {movies.length ? movies.map((m) => (
        <Row key={m.name} wrap style={{ justifyContent: "space-between" }}>
          <View style={{ flexShrink: 1 }}><Txt bold>{m.name}</Txt><Dim>{fmtBytes(m.size)}</Dim></View>
          <Row>
            {state === "on" ? <Btn label="Play on TV" onPress={() => cmd("play_movie", { name: m.name }, `Playing ${m.name}…`)} /> : null}
            <Btn label="Remove" kind="danger" onPress={async () => { if (await ask("Remove from the USB drive?", `“${m.name}” will be deleted from the TV’s USB drive. This cannot be undone.`, "Remove", true)) cmd("remove_movie", { name: m.name }, "Removal sent."); }} />
          </Row>
        </Row>
      )) : <Dim>No movies on the USB drive.</Dim>}
      <Btn label="Sync movies now" onPress={() => cmd("sync_now", {}, "Asking the TV to sync…")} />
      <Pending commands={device.commands} />
      <DeviceMenu device={device} reload={reload} />
    </Box>
  );
}

function LanRow({ device, row, rows, reload }) {
  const act = useAct();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ label: row.label || "", room: row.room || "", person: row.person || "", tag: row.tag || "", mac: row.wakeMac || "" });
  const [into, setInto] = useState("");
  const set = (k) => (v) => setF({ ...f, [k]: v });
  const ph = row.phone;
  const smart = device.status?.agent === "stashr-hub";
  return (
    <View style={{ gap: 4, paddingVertical: 8, borderTopWidth: 0.5, borderColor: "#8884" }}>
      <Row wrap={false}>
        <Dot tone={row.up ? "ok" : "mute"} />
        <Txt bold style={{ flexShrink: 1 }}>{ph && !row.label ? ph.name : lanName(row)}</Txt>
        <Dim>{row.tag ? TAG_LABEL[row.tag] : !row.label ? "Not named" : ""}{row.person ? ` · ${row.person}` : ""}</Dim>
      </Row>
      <Dim>{row.ip}{row.name && row.name !== lanName(row) ? " · " + row.name : ""}{row.vendor ? " · " + row.vendor : ""}{row.wakeMac ? " · " + row.wakeMac : ""}</Dim>
      <Dim>{row.up ? (row.pingMs ? `answers in ${row.pingMs} ms` : "online") : `last seen ${ago(row.lastSeen)}`} · first seen {ago(row.firstSeen)}{row.ports && row.ports.length ? ` · open ports ${row.ports.join(", ")}` : ""}</Dim>
      {ph ? <Dim>📱 {ph.name}: 🔋 {ph.battery ?? "?"}%{ph.charging ? " charging" : ""}{ph.storage?.total ? ` · 💾 ${Math.round(100 * (1 - ph.storage.free / ph.storage.total))}% full` : ""} · reported {ago(ph.lastSeen)}</Dim> : null}
      {(row.risks || []).map((r) => <Bad key={r.port}>⚠ Port {r.port} is open: {r.why}. Turn it off in that device's settings if you did not mean it.</Bad>)}
      {edit ? (
        <View style={{ gap: 8 }}>
          <Input value={f.label} onChangeText={set("label")} placeholder="Name" maxLength={60} autoCapitalize="words" />
          <Input value={f.room} onChangeText={set("room")} placeholder="Room" maxLength={60} autoCapitalize="words" />
          <Input value={f.person} onChangeText={set("person")} placeholder="Whose? (for who is home)" maxLength={40} autoCapitalize="words" />
          <Pick options={[["", "Not sorted"], ["mine", "Mine"], ["family", "Family"], ["guest", "Guest"], ["unknown", "Unknown"]]} value={f.tag} onChange={set("tag")} />
          <Input value={f.mac} onChangeText={set("mac")} placeholder="MAC, for wake-up (optional)" maxLength={17} />
          <Row>
            <Btn label="Save" kind="primary" onPress={async () => { if (await act(() => home.labelLan(device.id, row.key, f), "Saved.")) { setEdit(false); reload(); } }} />
            <Btn label="Cancel" onPress={() => setEdit(false)} />
            <Btn label="Forget" kind="danger" onPress={async () => { if (await ask(`Forget ${lanName(row)}?`, "It disappears from the list and its name is deleted. If it comes back on the Wi-Fi, it shows up as a new device.", "Forget", true) && await act(() => home.forgetLan(device.id, row.key), "Forgotten.")) reload(); }} />
          </Row>
          <Sub>Same device as…</Sub>
          <Pick options={rows.filter((r) => r.key !== row.key).slice(0, 12).map((r) => [r.key, `${lanName(r)} (${r.ip})`])} value={into} onChange={setInto} />
          <Btn label="Merge" disabled={!into} onPress={async () => { if (await act(() => home.mergeLan(device.id, row.key, into), "Merged into one device.")) { setEdit(false); reload(); } }} />
        </View>
      ) : (
        <Row>
          {row.wakeMac && !row.up && smart ? <Btn label="Wake" onPress={() => act(() => home.command(device.id, "wake", { mac: row.wakeMac }), `Waking ${lanName(row)}…`)} /> : null}
          <Btn label="Name / room" onPress={() => setEdit(true)} />
        </Row>
      )}
    </View>
  );
}

function HubCard({ device, reload }) {
  const act = useAct();
  const s = device.status || {}, state = stateOf(device);
  const [showOld, setShowOld] = useState(false);
  const smart = s.agent === "stashr-hub";
  const { fresh, old } = splitStale(device.lan);
  const groups = groupByRoom(fresh);
  const up = (device.lan || []).filter((d) => d.up).length;
  const unnamed = fresh.filter((d) => !d.label && !d.tag).length;
  const cmd = (type, args, text) => act(async () => { await home.command(device.id, type, args); reload(); }, text);
  const bat = batteryOf(s);
  return (
    <Box title={`🧩 ${device.name}`} subtitle={`${STATE_LABEL[state]} · seen ${ago(device.lastSeen)} · ${up} of ${fresh.length} devices answering${unnamed ? ` · ${unnamed} not named yet` : ""}`} right={<Dot tone={tone(state)} />}>
      <Dim>{[bat ? `Battery ${bat.pct}%${bat.charging ? " · charging" : ""}` : "", s.wifi?.rssi ? `Wi-Fi ${signalWord(s.wifi.rssi)} (${s.wifi.rssi} dBm)` : "", s.version || s.model ? `${s.model || "Tablet"} ${s.version || ""}` : ""].filter(Boolean).join(" · ")}</Dim>
      {smart ? <Row><Btn label="Scan the Wi-Fi now" onPress={() => cmd("scan_now", {}, "Scanning…")} /><Btn label="Speed test" onPress={() => cmd("speed_test", {}, "Testing the internet…")} /></Row> : null}
      {s.camera?.armed ? <Good>Security camera is watching.</Good> : null}
      {groups.map(([room, rows]) => (
        <View key={room}>
          <Sub>{room}</Sub>
          {rows.map((r) => <LanRow key={r.key} device={device} row={r} rows={fresh} reload={reload} />)}
        </View>
      ))}
      {old.length ? (
        <>
          <Btn label={showOld ? "Hide old devices" : `Show ${old.length} old device${old.length > 1 ? "s" : ""} (not seen for a day)`} onPress={() => setShowOld(!showOld)} />
          {showOld ? old.map((r) => <LanRow key={r.key} device={device} row={r} rows={fresh} reload={reload} />) : null}
        </>
      ) : null}
      {!fresh.length ? <Dim>No scan yet. The tablet scans the Wi-Fi about once a minute.</Dim> : null}
      <Pending commands={device.commands} />
      <DeviceMenu device={device} reload={reload} />
    </Box>
  );
}

function PeopleCard({ people }) {
  return (
    <Box title="Who is home" subtitle="From the Wi-Fi: give a device a person in its Name / room, or link that person's phone.">
      {people.length ? people.map((p) => <Row key={p.person}><Dot tone={p.home ? "ok" : "mute"} /><Txt bold>{p.person}</Txt><Dim>{p.home ? "home" : `out · last seen ${ago(p.lastSeen)}`}{p.devices?.length ? ` · ${p.devices.join(", ")}` : ""}</Dim></Row>) : <Dim>Nobody yet. Name a Wi-Fi device with a person, or link a family phone.</Dim>}
    </Box>
  );
}

function PhonesCard({ phones, reload }) {
  const act = useAct();
  const [who, setWho] = useState({});
  const hubPhones = phones.filter((p) => p.status?.agent !== "stashr-where");
  if (!hubPhones.length) return null;
  return (
    <Box title="Family phones (Stashr Hub phone mode)" subtitle="Each reports its health about every 15 minutes, and when it joins the Wi-Fi.">
      {hubPhones.map((p) => {
        const s = p.status || {}, bat = batteryOf(s);
        const used = s.storage?.total ? Math.round(100 * (1 - s.storage.free / s.storage.total)) : null;
        return (
          <View key={p.id} style={{ gap: 4, paddingVertical: 6 }}>
            <Txt bold>{p.name}{p.person && p.person !== p.name ? ` · ${p.person}` : ""}</Txt>
            <Dim>{s.model || "Phone"}{s.android ? ` · Android ${s.android}` : ""} · {p.online ? `reported ${ago(p.lastSeen)}` : `last report ${ago(p.lastSeen)}`}{s.wifi ? ` · on Wi-Fi (${s.ip || "?"})` : s.network ? ` · on ${s.network}` : ""}</Dim>
            <Dim>{[bat ? `🔋 ${bat.pct}%${bat.charging ? " charging" : ""}` : "", used != null ? `💾 ${used}% full · ${fmtBytes(s.storage.free)} free` : "", s.ram?.total ? `RAM ${Math.round(100 * (1 - s.ram.free / s.ram.total))}% used` : ""].filter(Boolean).join(" · ")}</Dim>
            <Row wrap={false}>
              <Input value={who[p.id] ?? (p.person || "")} onChangeText={(v) => setWho({ ...who, [p.id]: v })} placeholder="Whose phone?" style={{ flex: 1 }} autoCapitalize="words" />
              <Btn label="Save" onPress={async () => { if (await act(() => home.setPerson(p.id, (who[p.id] ?? p.person ?? "").trim()), "Saved.")) reload(); }} />
              <Btn label="Remove" kind="danger" onPress={async () => { if (await ask(`Remove ${p.name}?`, "The phone stops reporting.", "Remove", true) && await act(() => home.removeDevice(p.id), "Removed.")) reload(); }} />
            </Row>
            <MergeInto device={p} reload={reload} />
          </View>
        );
      })}
    </Box>
  );
}

const whereText = (p) => {
  if (p.state === "home") return "At home";
  if (p.state === "coming") return `${p.etaMinutes <= 1 ? "Almost home" : `About ${p.etaMinutes} min away`} · ${p.distanceKm} km · heading home${p.traffic ? " · live traffic" : ""}`;
  if (p.state === "away") return `${p.distanceKm} km from home${p.etaMinutes ? ` · about ${p.etaMinutes} min if they head home now${p.traffic ? " (live traffic)" : ""}` : ""}`;
  if (p.state === "unset") return "Set your home location (Automations → Home location) to see the distance";
  return "Waiting for the first location";
};

function CodeBox({ label, code, onCopy, onNew, note }) {
  return (
    <View style={{ gap: 6 }}>
      <Sub>{label}</Sub>
      <Row><Txt bold style={{ fontSize: 22, letterSpacing: 4, fontFamily: "monospace" }}>{code || "…"}</Txt><Btn label="Copy" onPress={onCopy} disabled={!code} /><Btn label="New code" onPress={onNew} /></Row>
      {note ? <Dim>{note}</Dim> : null}
    </View>
  );
}

function LocationsCard({ settings, save }) {
  const act = useAct();
  const [code, setCode] = useState("");
  const { data, reload } = useLoad(() => home.where(), []);
  useLoad(async () => { const r = await home.locationCode(); setCode(r.code); return r; }, []);
  usePoll(() => reload(), 30000);
  return (
    <Box title="Family locations" subtitle="Who is where, how far from home and when they will arrive. Phones run the separate Stashr Location app (it never sees your passwords).">
      <CodeBox label="Link code for Stashr Location" code={code}
        onCopy={async () => { await Clipboard.setStringAsync(code); }}
        onNew={async () => { if (await ask("Make a new link code?", "Phones that are already linked stay linked. Only new phones need the new code.", "New code")) { const r = await act(() => home.rotateLocationCode(), "New code ready."); if (r && r.code) setCode(r.code); } }}
        note="Install Stashr Location from the Apps page on the family phone, type this code and the person’s name. It stays linked until you disconnect it here or they press Disconnect in the app." />
      {settings ? <Toggle label="Allow the live map on the TV (phones that are out then update every few seconds while it is open)" value={settings.tvLive?.enabled !== false} onChange={(v) => save({ tvLive: { enabled: v } }, v ? "The TV can show the live map." : "The live map on the TV is off.")} /> : null}
      {data && !data.homeSet ? <Bad>Home location is not set yet. Set it under Automations → Home location so distances and arrival times can be worked out.</Bad> : null}
      {data && data.people.length ? data.people.map((p) => (
        <View key={p.id} style={{ gap: 2, paddingVertical: 4 }}>
          <Txt bold>{p.state === "coming" ? "🚗" : p.state === "home" ? "🏠" : "📍"} {p.name}</Txt>
          <Dim>{whereText(p)}{p.battery?.pct != null ? ` · battery ${p.battery.pct}%${p.battery.charging ? " (charging)" : ""}` : ""}{p.lastSeen ? ` · updated ${ago(p.lastSeen)}` : ""}{p.app === "Stashr Hub" ? " · via Stashr Hub" : ""}</Dim>
          <Btn label="Disconnect" kind="danger" onPress={async () => { if (await ask(`Disconnect ${p.name}?`, "Their phone stops being tracked here. They can link again with the code.", "Disconnect", true) && await act(() => home.removeDevice(p.id), "Disconnected.")) reload(); }} />
          <MergeInto device={{ id: p.id, name: p.name, kind: "phone" }} reload={reload} />
        </View>
      )) : <Dim>No phone is linked yet.</Dim>}
    </Box>
  );
}

function LinkCard() {
  const act = useAct();
  const [code, setCode] = useState("");
  const [kind, setKind] = useState("hub");
  const [name, setName] = useState("");
  const [one, setOne] = useState(null);
  useLoad(async () => { const r = await home.hubCode(); setCode(r.code); return r; }, []);
  return (
    <Box title="Link the home tablet or TV" subtitle="Install Stashr Hub on the always-on tablet, or Stashr TV on the TV (Apps page), then type this code and a name. No password is needed on them.">
      <CodeBox label="Home-device code (Stashr Hub and Stashr TV)" code={code}
        onCopy={async () => { await Clipboard.setStringAsync(code); }}
        onNew={async () => { if (await ask("Make a new tablet code?", "A tablet that is already linked stays linked. Only a new tablet needs the new code.", "New code")) { const r = await act(() => home.rotateHubCode(), "New code ready."); if (r && r.code) setCode(r.code); } }}
        note="The same code every time, until you make a new one. A tablet or TV can see the home dashboard and your slideshow photos, so keep this code to yourself. It is not the code for family phones." />
      <Sub>One-time code instead (15 minutes, works once)</Sub>
      <Pick options={[["hub", "Home tablet"], ["phone", "Phone running Stashr Hub"]]} value={kind} onChange={setKind} />
      <Row wrap={false}>
        <Input value={name} onChangeText={setName} placeholder="Name" maxLength={60} autoCapitalize="words" style={{ flex: 1 }} />
        <Btn label="Make a code" onPress={async () => { const r = await act(() => home.pairCode(kind, name.trim())); if (r && r.code) setOne(r); }} />
      </Row>
      {one ? <Txt bold>Type this in Stashr Hub: <Txt bold style={{ fontFamily: "monospace", fontSize: 18 }}>{one.code}</Txt></Txt> : null}
    </Box>
  );
}

const when = (s) => (s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`);

function LiveMapCard() {
  const [on, setOn] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  usePoll(async () => { try { setData(await home.live()); setErr(""); } catch (e) { setErr(e.message); } }, 5000, on);
  return (
    <Box title="Live map" subtitle="Where everyone is right now and the road home. While this is open, phones that are out send their location every few seconds (it takes a minute or two to start).">
      <Btn label={on ? "Stop live view" : "Start live view"} kind={on ? "quiet" : "primary"} onPress={() => { setOn(!on); setData(null); }} />
      {err ? <Bad>{err}</Bad> : null}
      {on && data && !data.ok ? <Bad>{data.error}</Bad> : null}
      {on && data?.ok && !data.home ? <Bad>Set the home location first (Automations → Home location).</Bad> : null}
      {!on ? <Dim>Not running, so phones keep their battery-saving pace.</Dim> : null}
      {on && data?.ok ? (
        <>
          <FamilyMap home={data.home} devices={data.devices} />
          {data.devices.length ? data.devices.map((d) => (
            <View key={d.id} style={{ gap: 2 }}>
              <Txt bold>{d.state === "coming" ? "🚗" : d.state === "away" ? "📍" : "🏠"} {d.name}</Txt>
              <Dim>{d.state === "coming" || d.state === "away" ? `${d.etaMinutes ? `About ${d.etaMinutes} min` : "—"} to home · ${d.km ?? "?"} km${d.traffic ? " · live traffic" : ""}` : "At home"}{d.speedKmh != null ? ` · ${d.speedKmh} km/h` : ""} · {d.live ? "live" : "waiting for live updates"} · updated {when(d.ageSec)} · accuracy ±{d.acc} m</Dim>
            </View>
          )) : <Dim>No linked phone has sent a location yet.</Dim>}
        </>
      ) : null}
    </Box>
  );
}

export default function Devices({ ctx }) {
  const { devices, people, settings, save, reload } = ctx;
  const phones = devices.filter((d) => d.kind === "phone");
  return (
    <>
      <Boundary name="Who is home"><PeopleCard people={people} /></Boundary>
      {devices.length === 0 ? <Box><Dim>Nothing connected yet. Install Stashr Hub on the always-on tablet and type a code from “Link the home tablet or TV” below. Your TV joins once Stashr TV is open.</Dim></Box> : null}
      {devices.filter((d) => d.kind !== "phone").map((d) => (
        <Boundary key={d.id} name={d.name}>{d.kind === "tv" ? <TvCard device={d} reload={reload} /> : <HubCard device={d} reload={reload} />}</Boundary>
      ))}
      <Boundary name="Family locations"><LocationsCard settings={settings} save={save} /></Boundary>
      <Boundary name="Live map"><LiveMapCard /></Boundary>
      <Boundary name="Family phones"><PhonesCard phones={phones} reload={reload} /></Boundary>
      <Boundary name="Link"><LinkCard /></Boundary>
    </>
  );
}
