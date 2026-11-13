import React, { useState } from "react";
import { View } from "react-native";
import { home } from "../../lib/homeApi";
import { Bad, Boundary, Box, Btn, Dim, Input, Row, Sub, Toggle, Txt, ask, useAct, useLoad } from "./h";
import { CommuteChart } from "./Charts";
import Maps from "./Maps";

const tripTime = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

function InsightsCard() {
  const act = useAct();
  const { data: d, reload } = useLoad(() => home.insights(), []);
  const [names, setNames] = useState({});
  const [limit, setLimit] = useState("");
  if (!d) return null;
  const lim = limit === "" ? String(d.speedKmh) : limit;
  const nameIt = async (c) => {
    const name = (names[c.id] || "").trim();
    if (!name) return;
    if (await act(() => home.saveSpots([...d.spots, { name, lat: c.lat, lon: c.lon, radius: 150 }]), "Saved.")) { setNames({}); reload(); }
  };
  return (
    <Box title="Family insights" subtitle="Places, trips, the usual way home and a driving report, worked out from the phones’ locations. Shown only here, on the website and on the home tablet’s screen, never on a phone or the TV.">
      <Toggle label="Keep a location history (60 days)" hint="Off until you turn it on. When on, Stashr keeps a location about every 2 minutes or 150 m for each family phone (phones send one every 1–30 minutes, so everything below is approximate). Hard braking cannot be measured." value={d.enabled}
        onChange={async (v) => { if (await act(() => home.saveHistory({ enabled: v }), v ? "Keeping a location history from now on." : "Stopped keeping the history.")) reload(); }} />
      <Row wrap={false}>
        <Dim>Speed to flag (km/h)</Dim>
        <Input value={lim} onChangeText={setLimit} keyboardType="number-pad" style={{ width: 80, flexGrow: 0 }} />
        <Btn label="Save" onPress={async () => { if (await act(() => home.saveHistory({ speedKmh: Number(lim) }), "Saved.")) reload(); }} />
      </Row>
      <Btn label="Delete the history" kind="danger" onPress={async () => { if (await ask("Delete the whole location history?", "Every stored location is erased. Named places stay.", "Delete it", true)) { const r = await act(() => home.deleteHistory()); if (r) reload(); } }} />
      {!d.homeSet ? <Bad>Set the home location first (Automations → Home location).</Bad> : null}
      {d.candidates.length ? (
        <View style={{ gap: 8 }}>
          <Sub>Places Stashr found</Sub>
          <Dim>Spots where a phone stayed 20+ minutes on 3 or more different days. Name them (Office, School, Market…) to get trips and the usual commute.</Dim>
          {d.candidates.map((c) => (
            <View key={c.id} style={{ gap: 4 }}>
              <Txt bold>{c.guess}</Txt>
              <Dim>{c.days} days · {c.visits} visits · about {c.avgHours} h each · {c.lat.toFixed(4)}, {c.lon.toFixed(4)}</Dim>
              <Row wrap={false}><Input value={names[c.id] || ""} onChangeText={(v) => setNames({ ...names, [c.id]: v })} placeholder="Name, e.g. Office" maxLength={30} autoCapitalize="words" style={{ flex: 1 }} /><Btn label="Save" disabled={!(names[c.id] || "").trim()} onPress={() => nameIt(c)} /></Row>
            </View>
          ))}
        </View>
      ) : null}
      {d.spots.length ? <Row>{d.spots.map((x) => <Btn key={x.id} label={`${x.name} ×`} onPress={async () => { if (await act(() => home.saveSpots(d.spots.filter((y) => y.id !== x.id)), "Removed.")) reload(); }} />)}</Row> : null}
      {d.enabled && !d.people.length ? <Dim>Nothing yet: places and trips appear after a few days of locations.</Dim> : null}
      {d.people.map((p) => (
        <View key={p.id} style={{ gap: 6 }}>
          <Sub>{p.name}</Sub>
          {p.commute.map((c) => (
            <View key={c.place} style={{ gap: 4 }}>
              <Txt><Txt bold>{c.place} → Home</Txt>: usually leaves around <Txt bold>{c.usualLeave}</Txt>, the way takes about <Txt bold>{c.usualMinutes} min</Txt> ({c.trips} trips).</Txt>
              <CommuteChart series={c.series} usual={c.usualMinutes} />
            </View>
          ))}
          <Txt><Txt bold>Last 7 days of driving</Txt>: {p.driving.trips} trips · {p.driving.km} km · highest speed seen {p.driving.maxKmh} km/h · {p.driving.over} trip{p.driving.over === 1 ? "" : "s"} over {p.driving.limit} km/h</Txt>
          <Dim>{p.driving.note}</Dim>
          {p.trips.slice(0, 12).map((t) => <Dim key={t.from}>{tripTime(t.from)} · {t.fromName || "somewhere"} → {t.toName || "somewhere"} · {t.minutes} min · {t.km} km · avg {t.avgKmh} · top seen {t.maxKmh || "—"}</Dim>)}
        </View>
      ))}
    </Box>
  );
}

export default function Insights() {
  return (
    <View style={{ gap: 14 }}>
      <Maps />
      <Boundary name="Family insights"><InsightsCard /></Boundary>
    </View>
  );
}
