import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, View, useWindowDimensions } from "react-native";
import Svg, { Circle, G, Image as SvgImage, Polygon, Polyline, Rect, Text as SText } from "react-native-svg";
import { home } from "../../lib/homeApi";
import { useTheme, alpha } from "../../lib/theme";
import { shapes, awayLine } from "../../lib/homeMap";
import { colourFor, pointsSince, itemsSince, coordKey, placeLabel, mapsLink, kmOf } from "../../lib/trailView";
import { confusionRows, thinRooms, liveRows, headline, autoLine } from "../../lib/roomLab";
import { Bad, Boundary, Box, Btn, Dim, Good, Input, Row, Toggle, Txt, ask, useAct, useLoad, usePoll } from "./h";

/* The house map, Room Lab and the 24-hour trail: the same cards as the website's Insights tab, drawn with react-native-svg. */

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`);

/* ───────── the house map (2D and isometric 3D, from what Stashr learned about the Wi-Fi) ───────── */

function HouseMapCard() {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const { data: map, reload } = useLoad(() => home.map(), []);
  const [mode, setMode] = useState("2d");
  usePoll(() => reload(), 30000);
  const view = useMemo(() => (map ? shapes(map, mode, true) : null), [map, mode]);
  if (!map || !view) return null;
  const avail = Math.max(240, width - 64);
  const scale = Math.min(1, avail / view.width);
  const fills = { zone: alpha(theme.accent, 0.14), label: "transparent" };
  const polyFill = (cls) => {
    const base = cls.startsWith("label") ? 0.06 : 0.2;
    return alpha(theme.accent, cls.endsWith("-top") ? base * 0.8 : cls.endsWith("-right") ? base * 2 : base * 1.5);
  };
  const dotColor = { hub: theme.accent, "device-up": theme.ok, "device-down": theme.textFaint, person: theme.warn };
  const away = awayLine(map);
  return (
    <Box title="Ghar ka map" subtitle="Stashr learns the zones of the house by itself from the Wi-Fi access points each device is seen on. It is a diagram of zones, not a floor plan."
      right={<Btn label={mode === "2d" ? "3D" : "2D"} onPress={() => setMode(mode === "2d" ? "3d" : "2d")} />}>
      <Svg width={view.width * scale} height={view.height * scale} viewBox={`0 0 ${view.width} ${view.height}`}>
        {view.items.map((it, i) => {
          if (it.type === "plan") return <SvgImage key={i} href={{ uri: it.href }} x={it.x} y={it.y} width={it.w} height={it.h} opacity={0.45} preserveAspectRatio="xMidYMid slice" />;
          if (it.type === "rect") return <Rect key={i} x={it.x} y={it.y} width={it.w} height={it.h} rx={8} fill={it.cls === "label" ? fills.label : it.plan ? alpha(theme.accent, 0.08) : fills.zone} stroke={alpha(theme.accent, 0.6)} strokeWidth={1.5} strokeDasharray={it.cls === "label" ? "5 4" : undefined} />;
          if (it.type === "poly") return <Polygon key={i} points={it.points} fill={polyFill(it.cls)} stroke={alpha(theme.accent, 0.6)} strokeWidth={1} />;
          if (it.type === "dot") return <Circle key={i} cx={it.x} cy={it.y} r={it.r} fill={dotColor[it.kind] || theme.textFaint} />;
          if (it.type === "text") {
            const big = it.cls === "title" || it.cls === "title-c";
            return <SText key={i} x={it.x} y={it.y} fontSize={big ? 15 : 11} fontWeight={big ? "700" : "400"} fill={big ? theme.heading : theme.textMuted} textAnchor={it.cls === "title-c" || it.cls === "person" ? "middle" : "start"}>{it.text}</SText>;
          }
          return null;
        })}
      </Svg>
      <Row gap={12}>
        <Row gap={4}><Svg width={12} height={12}><Circle cx={6} cy={6} r={5} fill={theme.accent} /></Svg><Dim>Tablet</Dim></Row>
        <Row gap={4}><Svg width={12} height={12}><Circle cx={6} cy={6} r={5} fill={theme.ok} /></Svg><Dim>On the Wi-Fi</Dim></Row>
        <Row gap={4}><Svg width={12} height={12}><Circle cx={6} cy={6} r={5} fill={theme.warn} /></Svg><Dim>Person</Dim></Row>
      </Row>
      {away ? <Dim>{away}</Dim> : null}
      {!map.zones.length ? <Dim>No zones yet. They appear after the tablet has seen devices on the Wi-Fi for a while.</Dim> : null}
      <Dim>Editing the layout and the imported 3-D model are on the website.</Dim>
    </Box>
  );
}

/* ───────── Room Lab: which room each phone is in, and how well the model does ───────── */

function LivePhone({ p }) {
  const cur = p.current, top = cur && cur.ranking.length ? Math.max(...cur.ranking.map((r) => r.p)) : 0;
  return (
    <View style={{ gap: 4, paddingVertical: 6 }}>
      <Row><Txt bold>{p.person}</Txt>{p.on ? <Good>ON</Good> : <Dim>OFF</Dim>}<Dim>{p.total} samples · {p.trainedRooms} rooms trained</Dim></Row>
      <Txt>{`> ${headline(p)}`}</Txt>
      {cur ? cur.ranking.map((r) => <Dim key={r.room}>{`${r.p === top ? "● " : "○ "}${r.room}  ${Math.round(r.p * 100)}%`}</Dim>) : null}
      {cur && !cur.sure && cur.why ? <Bad>{cur.why}</Bad> : null}
      {!p.trained ? <Bad>Train at least 2 rooms in Stashr Location → Room Lab on the phone.</Bad> : null}
      {p.auto ? (p.auto.paused ? <Bad>Auto-improve: {autoLine(p)}</Bad> : <Dim>Auto-improve: {autoLine(p)}</Dim>) : null}
      {liveRows(p).map(([k, v]) => <Dim key={k}>{k}: {v}</Dim>)}
      {p.cv.verdict ? <Dim>{p.cv.verdict}</Dim> : null}
    </View>
  );
}

function RoomLabCard() {
  const act = useAct();
  const { data: live, setData: setLive, reload: loadLive } = useLoad(() => home.roomLive(), []);
  const { data: d, reload: loadRooms } = useLoad(() => home.rooms(), []);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  usePoll(() => loadLive(), 6000);
  usePoll(() => loadRooms(), 30000);
  if (!live || !d) return null;
  const list = d.rooms;
  const toggle = async () => {
    const r = await act(() => home.roomModel(!live.running));
    if (r) { setLive(r.live); setNote(r.blocked && r.blocked.length ? r.blocked.map((b) => `${b.person}: ${b.why}`).join("\n") : ""); }
  };
  // a new room is saved at once; ✕ deletes a room at once (after asking), everywhere: every phone's training, the map
  const add = async () => {
    const n = name.trim();
    if (n.length < 2 || list.some((r) => r.toLowerCase() === n.toLowerCase()) || list.length >= d.max) return;
    if (await act(() => home.saveRooms([...list, n]), `${n} added.`)) { setName(""); loadRooms(); loadLive(); }
  };
  const remove = async (room) => {
    const scans = d.phones.reduce((t, p) => t + ((p.counts || {})[room] || 0) + ((p.autoCounts || {})[room] || 0), 0);
    if (!(await ask(`Delete ${room}?`, `The room goes from the list and the house map, with every phone's training for it (${scans} scans). It cannot be undone.`, "Delete room", true))) return;
    if (await act(() => home.deleteRoom(room), `${room} deleted.`)) { loadRooms(); loadLive(); }
  };
  const tuneNow = async () => { const r = await act(() => home.roomMaintain(), "Tuned."); if (r) setLive(r.live); };
  const s = live.summary;
  return (
    <Box title={`Room model · ${live.running ? "running" : "stopped"}`} subtitle="Room location: each phone hears Wi-Fi and Bluetooth signal strengths, and Stashr says which room it is in.">
      <Row>
        <Btn kind={live.running ? "danger" : "primary"} label={live.running ? "Stop model" : "Start model"} onPress={toggle} />
        <Btn label="Refresh" onPress={() => { loadLive(); loadRooms(); }} />
        <Btn label="Tune now" onPress={tuneNow} />
      </Row>
      <Dim>{s.on}/{s.phones} phones on · {s.trained} trained{s.cvAccuracy !== null ? ` · accuracy ${s.cvAccuracy}%` : ""}{s.fieldAccuracy !== null ? ` · real ${s.fieldAccuracy}%` : ""}{s.autoOn !== undefined ? ` · auto-improving: ${s.autoOn} phones, ${s.autoSamples} scans` : ""} · every 5 seconds</Dim>
      {note ? <Bad>{note}</Bad> : null}
      {!live.phones.length ? <Dim>No Stashr Location phone is linked.</Dim> : live.phones.map((p) => <LivePhone key={p.id} p={p} />)}

      <Txt bold>Rooms</Txt>
      <Row>{list.map((r) => <Btn key={r} label={`${r} ✕`} onPress={() => remove(r)} />)}{!list.length ? <Dim>No room yet.</Dim> : null}</Row>
      <Row wrap={false}>
        <Input value={name} onChangeText={setName} placeholder="Room, e.g. Bedroom" maxLength={24} autoCapitalize="words" style={{ flex: 1 }} onSubmitEditing={add} />
        <Btn kind="primary" label="Add" onPress={add} disabled={name.trim().length < 2 || list.length >= d.max} />
      </Row>
      <Dim>Tap ✕ to delete a room everywhere (it asks first).</Dim>

      {d.phones.map((p) => {
        const t = confusionRows(p.report), thin = thinRooms(d.rooms, p.counts);
        return (
          <View key={p.id} style={{ gap: 4, paddingTop: 8 }}>
            <Toggle label={`${p.person}: room location`} value={p.on} onChange={async () => { if (await act(() => home.roomPhone(p.id, !p.on))) { loadRooms(); loadLive(); } }} />
            <Toggle label={`${p.person}: auto-improve`} value={Boolean(p.auto && p.auto.on)} onChange={async () => { if (await act(() => home.roomAuto(p.id, !(p.auto && p.auto.on)))) { loadRooms(); loadLive(); } }} />
            <Dim>Training: {d.rooms.map((r) => `${r} ${p.counts[r] || 0}${(p.autoCounts || {})[r] ? ` (+${p.autoCounts[r]} auto)` : ""}`).join(" · ") || "none"}</Dim>
            {thin.length ? <Bad>Needs more training: {thin.join(", ")} (at least 5 scans, from 4-5 different spots)</Bad> : null}
            {t.rows.map((r) => <Dim key={r.room}>{`${r.room} (${r.n} scans): ${r.accuracy}% right`}</Dim>)}
            <Row><Btn kind="danger" label="Delete this phone's training" onPress={async () => { if (await ask(`Delete ${p.person}'s training?`, "All room samples of this phone are deleted.", "Delete", true) && await act(() => home.deleteRoomSamples({ phone: p.id }), "Deleted.")) { loadRooms(); loadLive(); } }} /></Row>
          </View>
        );
      })}
    </Box>
  );
}

/* ───────── where everyone went in the last 24 hours ───────── */

const HOURS = [1, 3, 6, 12, 24];

function TrailCard() {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const { data: d, reload } = useLoad(() => home.trail(), []);
  const [hours, setHours] = useState(24);
  const [sel, setSel] = useState(null);                  // Set of phone ids shown; null = everybody
  const [addr, setAddr] = useState({});
  const chain = useRef(Promise.resolve());
  const asked = useRef(new Set());

  /** One address at a time (the free address service allows a request a second). */
  const resolve = useCallback((lat, lon) => {
    const k = coordKey(lat, lon);
    if (asked.current.has(k)) return;
    asked.current.add(k);
    chain.current = chain.current.then(() => home.address(lat, lon)).then((r) => setAddr((a) => ({ ...a, [k]: r }))).catch(() => {});
  }, []);

  const people = d ? d.people : [];
  const shown = people.filter((p) => !sel || sel.has(p.phone));
  const now = d ? d.at : Date.now();
  useEffect(() => {
    shown.forEach((p) => itemsSince(p.timeline, hours, now).filter((e) => e.type === "stay").slice(0, 12).forEach((e) => resolve(e.lat, e.lon)));
  }, [d, sel, hours]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  if (!people.length) return <Box title="Where everyone went (last 24 hours)"><Dim>No family phone is linked yet.</Dim></Box>;

  // a sketch of the routes: no map tiles, just the points of every shown person, fitted into the box
  const all = shown.flatMap((p) => pointsSince(p.points, hours, now));
  const W = Math.max(240, width - 64), H = 240;
  let sketch = null;
  if (all.length) {
    const lat0 = all.reduce((a, x) => a + x.lat, 0) / all.length, kx = Math.cos((lat0 * Math.PI) / 180);
    const xs = all.map((x) => x.lon * kx), ys = all.map((x) => -x.lat);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 1e-5), pad = 18;
    const fit = (lat, lon) => ({ x: pad + (((lon * kx) - minX) / span) * (W - pad * 2), y: pad + ((-lat - minY) / span) * (H - pad * 2) });
    sketch = (
      <Svg width={W} height={H}>
        <Rect x={0} y={0} width={W} height={H} rx={10} fill={alpha(theme.accent, 0.06)} />
        {shown.map((p) => {
          const colour = colourFor(people.indexOf(p)), pts = pointsSince(p.points, hours, now);
          if (!pts.length) return null;
          const xy = pts.map((x) => fit(x.lat, x.lon));
          const last = xy[xy.length - 1], first = xy[0];
          return (
            <G key={p.phone}>
              {xy.length > 1 ? <Polyline points={xy.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={colour} strokeWidth={3} opacity={0.75} /> : null}
              {xy.map((q, i) => <Circle key={i} cx={q.x} cy={q.y} r={3} fill={colour} />)}
              {itemsSince(p.timeline, hours, now).filter((e) => e.type === "stay").map((e, i) => { const q = fit(e.lat, e.lon); return (<G key={`s${i}`}><Circle cx={q.x} cy={q.y} r={9} fill={colour} /><SText x={q.x} y={q.y + 4} fontSize={11} fontWeight="700" fill="#fff" textAnchor="middle">{i + 1}</SText></G>); })}
              <SText x={first.x + 6} y={first.y - 6} fontSize={10} fill={colour}>{`${p.person}: start`}</SText>
              <SText x={last.x + 6} y={last.y + 14} fontSize={10} fontWeight="700" fill={colour}>{`${p.person}: ${clock(pts[pts.length - 1].at)}`}</SText>
            </G>
          );
        })}
      </Svg>
    );
  }
  const toggle = (id) => { const next = new Set(sel || people.map((p) => p.phone)); if (next.has(id)) next.delete(id); else next.add(id); setSel(next); };
  const label = (lat, lon, n) => placeLabel({ name: n, address: (addr[coordKey(lat, lon)] || {}).address }, lat, lon);
  return (
    <Box title="Where everyone went (last 24 hours)" subtitle="The line goes through every stored location in time order. It is straight between locations: phones report every 1 to 30 minutes, so the road in between is not known."
      right={<Btn label="Refresh" onPress={reload} />}>
      <Row>{people.map((p) => <Btn key={p.phone} label={`${!sel || sel.has(p.phone) ? "● " : "○ "}${p.person} (${p.count})`} onPress={() => toggle(p.phone)} />)}</Row>
      <Row><Dim>Last</Dim>{HOURS.map((h) => <Btn key={h} label={`${hours === h ? "● " : ""}${h} h`} onPress={() => setHours(h)} />)}</Row>
      {sketch || <Dim>No location in this time yet (the phone has to report first).</Dim>}
      {shown.map((p) => {
        const pts = pointsSince(p.points, hours, now), items = itemsSince(p.timeline, hours, now);
        return (
          <View key={p.phone} style={{ gap: 3, paddingTop: 6 }}>
            <Txt bold style={{ color: colourFor(people.indexOf(p)) }}>{p.person}</Txt>
            <Dim>{pts.length ? `${pts.length} locations · ${kmOf(pts)} km${p.last ? ` · last ${clock(p.last.at)}` : ""}` : "No location in this time yet."}</Dim>
            {items.map((e, i) => (e.type === "stay"
              ? <Txt key={i} onPress={() => Linking.openURL(mapsLink(e.lat, e.lon)).catch(() => {})}>{`📍 ${clock(e.from)}–${e.here ? "now" : clock(e.to)} · ${label(e.lat, e.lon, e.name)} · ${dur(e.minutes)}`}</Txt>
              : <Dim key={i}>{`↪ ${dur(e.minutes)} on the way · ${e.km} km`}</Dim>))}
          </View>
        );
      })}
    </Box>
  );
}

export default function Maps() {
  return (
    <View style={{ gap: 14 }}>
      <Boundary name="House map"><HouseMapCard /></Boundary>
      <Boundary name="Room Lab"><RoomLabCard /></Boundary>
      <Boundary name="Trail"><TrailCard /></Boundary>
    </View>
  );
}
