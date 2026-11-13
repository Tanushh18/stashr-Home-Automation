import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import * as DocumentPicker from "expo-document-picker";
import { Page, Loading, Note, Heading } from "../components/kit";
import { Box, Btn, Dim, Good, Bad, Txt, Row, Input, Toggle, Boundary, ask, usePoll, useAct } from "../components/home/h";
import { wa, peopleFromLines, textsToBox, boxToTexts, nextText, STEP_MARK, WHO } from "../lib/waApi";
import { contactsFromFile } from "../lib/waContacts";
import { STARTER_QUOTES } from "../lib/waStarter";
import { useTheme } from "../lib/theme";

const when = (t) => { const s = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 1000)); return s < 45 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

/** WhatsApp sender: turn sending on, see when the next message goes, manage sheets (messages, pictures, people) and read every step of each message. */
export default function WhatsApp() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const act = useAct();
  const load = useCallback(async () => { try { setData(await wa.overview()); setError(""); } catch (e) { setError(e.message || "Could not load the sender."); } }, []);
  usePoll(load, 8000);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const set = async (body, done) => { if (await act(() => wa.saveSettings(body), done)) load(); };

  return (
    <Page title="WhatsApp sender" subtitle="Messages go out from the tablet through WhatsApp Business, one at a time, inside your limits." onRefresh={refresh} refreshing={refreshing}>
      {error ? <Note tone="bad">{error}</Note> : null}
      {!data && !error ? <Loading /> : null}
      {data ? (
        <View style={{ gap: 14 }}>
          <Boundary name="Sending"><Sending data={data} set={set} /></Boundary>
          <Boundary name="Limits"><Limits settings={data.settings} set={set} act={act} reload={load} /></Boundary>
          <Boundary name="Test"><TestSend sheets={data.sheets} reload={load} /></Boundary>
          <Heading>Sheets</Heading>
          {data.sheets.length === 0 ? <Dim>No sheets yet. Make one on the website (WhatsApp sender), or here below.</Dim> : null}
          {data.sheets.map((s) => <Boundary key={s._id} name={s.name}><SheetCard sheet={s} all={data.sheets} reload={load} /></Boundary>)}
          <NewSheet reload={load} />
          <Boundary name="We Three"><ThreeLink reload={load} /></Boundary>
          <Boundary name="Contacts group"><ContactsGroup reload={load} /></Boundary>
          <Boundary name="Latest messages"><Latest rows={data.recent} /></Boundary>
        </View>
      ) : null}
    </Page>
  );
}

function Sending({ data, set }) {
  const s = data.settings;
  const sheetName = data.next && data.next.sheet ? (data.sheets.find((x) => x._id === data.next.sheet) || {}).name : "";
  return (
    <Box title={s.enabled ? "Sending is on" : "Sending is off"} subtitle={s.status || (s.enabled ? "Waiting for the next turn" : "Nothing will be sent")}
      right={null}>
      <Toggle label="Sending" value={s.enabled} onChange={(v) => set({ enabled: v }, v ? "Sending is on." : "Sending is off.")} />
      <Row gap={14}>
        <Txt bold>{data.sentToday} sent today of {s.dailyLimit}</Txt>
        {data.tablet ? <Good>Tablet online</Good> : <Bad>Tablet offline</Bad>}
      </Row>
      {!data.tablet ? <Bad>The tablet is offline, so nothing can be sent. Check that Stashr Hub is open, on charge and on Wi-Fi.</Bad> : null}
      {s.testMode ? <Bad>Test mode is on: the time window, the gap and the daily limit are ignored. Turn it off before real sending.</Bad> : null}
      {data.next ? <Txt>{`Next message: ${nextText(data.next, sheetName)}`}</Txt> : null}
    </Box>
  );
}

function Limits({ settings: s, set, act, reload }) {
  const [f, setF] = useState({ dailyLimit: String(s.dailyLimit), from: s.from, to: s.to, gapMin: String(s.gapMin), gapMax: String(s.gapMax) });
  const [nums, setNums] = useState((s.reportNumbers || []).map((n) => `+${n}`).join(", "));
  const num = (v) => Number(v) || 0;
  const save = () => set({ dailyLimit: num(f.dailyLimit), from: f.from.trim(), to: f.to.trim(), gapMin: num(f.gapMin), gapMax: num(f.gapMax) }, "Limits saved.");
  const field = (k, label, kb) => (
    <View style={{ flex: 1, minWidth: 110, gap: 3 }}><Dim>{label}</Dim><Input value={f[k]} onChangeText={(v) => setF({ ...f, [k]: v })} keyboardType={kb} /></View>
  );
  return (
    <Box title="Limits" subtitle="The daily limit is spread over the sending window with a random gap each time.">
      <Row>{field("dailyLimit", "Messages a day", "number-pad")}{field("from", "From (10:00)")}{field("to", "To (19:00)")}</Row>
      <Row>{field("gapMin", "Shortest gap (min)", "number-pad")}{field("gapMax", "Longest gap (min)", "number-pad")}</Row>
      <Btn kind="primary" label="Save limits" onPress={save} />
      <Toggle label="Test mode (ignores the limits)" value={s.testMode} onChange={(v) => set({ testMode: v }, v ? "Test mode is on." : "Test mode is off.")} />
      <Toggle label="Nightly report" hint="When the day's sending is done these numbers get a WhatsApp report." value={s.reportEnabled} onChange={(v) => set({ reportEnabled: v }, v ? "Report on." : "Report off.")} />
      <Input value={nums} onChangeText={setNums} placeholder="Report numbers, comma separated" keyboardType="phone-pad" />
      <Row>
        <Btn label="Save numbers" onPress={() => set({ reportNumbers: nums }, "Numbers saved.")} />
        <Btn label="Send the report now" onPress={async () => { if (await act(() => wa.reportNow(), "The report goes out in a minute.")) reload(); }} />
      </Row>
    </Box>
  );
}

function TestSend({ sheets, reload }) {
  const [phone, setPhone] = useState("");
  const [sheet, setSheet] = useState("");
  const [note, setNote] = useState("");
  const timer = useRef(null);
  const act = useAct();
  const follow = (id, tries = 0) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await wa.send(id);
        if (r.status === "sent") { setNote(`Sent to +${r.phone}.`); reload(); return; }
        if (r.status === "failed") { setNote(`Failed: ${r.result || "no reason given"}`); reload(); return; }
      } catch (e) { /* try again */ }
      if (tries < 60) follow(id, tries + 1); else setNote("No answer from the tablet yet.");
    }, 2500);
  };
  const go = async (withNumber) => {
    setNote("Queued on the tablet…");
    const r = await act(() => wa.test(withNumber ? { phone, sheetId: sheet || undefined } : { sheetId: sheet || undefined }));
    if (r && r.id) follow(r.id); else setNote("");
  };
  return (
    <Box title="Test the full flow" subtitle="Sends through the same path as a real message: the server queues it, the tablet sends it, the answer comes back here.">
      <Input value={phone} onChangeText={setPhone} placeholder="Number, e.g. 98100 12345" keyboardType="phone-pad" />
      <Row>
        <Btn kind="primary" label="Send a test to this number" onPress={() => go(true)} disabled={!phone.trim()} />
        <Btn label="Send to the next person now" onPress={async () => { if (await ask("Send to the next person?", "This messages the next real person in line right now, ignoring the window and the gap.", "Send")) go(false); }} />
      </Row>
      {sheets.length > 1 ? <Row>{sheets.map((s) => <Btn key={s._id} label={`${sheet === s._id ? "✓ " : ""}${s.name}`} onPress={() => setSheet(sheet === s._id ? "" : s._id)} />)}</Row> : null}
      {note ? <Dim>{note}</Dim> : null}
    </Box>
  );
}

function SheetCard({ sheet, all, reload }) {
  const [texts, setTexts] = useState(textsToBox(sheet.texts));
  const [people, setPeople] = useState("");
  const [picking, setPicking] = useState(false);
  const act = useAct();
  const c = sheet.counts || {};
  const savedCount = (sheet.texts || []).length;
  const unsaved = JSON.stringify(boxToTexts(texts)) !== JSON.stringify(sheet.texts || []);
  const run = async (fn, done) => { if (await act(fn, done)) await reload(); };

  const addPicture = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["image/png", "image/jpeg", "image/webp"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const a = res.assets[0];
      if (a.size && a.size > 2 * 1024 * 1024) { await act(async () => { throw new Error("That picture is over 2 MB."); }); return; }
      const mime = a.mimeType && /^image\/(png|jpeg|webp)$/.test(a.mimeType) ? a.mimeType : /\.png$/i.test(a.name || "") ? "image/png" : /\.webp$/i.test(a.name || "") ? "image/webp" : "image/jpeg";
      const { File } = require("expo-file-system");
      const url = `data:${mime};base64,${await new File(a.uri).base64()}`;
      await run(() => wa.saveSheet(sheet._id, { addImage: url }), "Picture added.");
    } catch (e) { await act(async () => { throw e; }); }
  };
  return (
    <Box title={sheet.name} subtitle={`${sheet.source === "leads" ? "Lead sheet" : "Sheet"} · ${(c.pending || 0) + (c.queued || 0) + (c.sent || 0) + (c.failed || 0) + (c.skipped || 0)} people · ${sheet.sentToday || 0} sent today`}>
      <Toggle label="Send from this sheet" value={sheet.enabled} onChange={(v) => run(() => wa.saveSheet(sheet._id, { enabled: v }), v ? "Sheet switched on." : "Sheet switched off.")} />
      <Row gap={14}><Txt bold>{c.pending || 0} to send</Txt><Dim>{c.queued || 0} on the tablet</Dim><Good>{c.sent || 0} sent</Good>{c.failed ? <Bad>{c.failed} failed</Bad> : <Dim>0 failed</Dim>}<Dim>{c.skipped || 0} skipped</Dim></Row>
      {sheet.plan ? <Txt>{`Next message from this sheet: ${nextText(sheet.plan)}`}</Txt> : null}

      <Dim>Messages. A line with only --- separates two messages. One is picked at random for each person. {"{name}"} is the first name.</Dim>
      <Input value={texts} onChangeText={setTexts} multiline placeholder={"Happy Diwali {name}!\n---\nSecond message"} style={{ minHeight: 120, textAlignVertical: "top" }} />
      <Row>
        <Btn kind="primary" label="Save messages" onPress={() => run(() => wa.saveSheet(sheet._id, { texts: boxToTexts(texts) }), "Messages saved.")} />
        <Btn label="Use the 25 We Three quotes" onPress={async () => { if (texts.trim() && !(await ask("Replace the messages in the box?", "The box gets the 25 We Three quotes. Nothing is saved until you press Save messages.", "Replace"))) return; setTexts(textsToBox(STARTER_QUOTES)); }} />
        <Dim>{boxToTexts(texts).length} in the box</Dim>
      </Row>
      {unsaved
        ? <Bad>{`Not saved yet: the box has ${boxToTexts(texts).length}, but ${savedCount} ${savedCount === 1 ? "is" : "are"} saved on the server. Press Save messages, or they are lost when you leave.`}</Bad>
        : savedCount > 0 ? <Dim>{`Saved: ${savedCount} message${savedCount === 1 ? "" : "s"}. Every new lead from this sheet gets one of them, picked at random.`}</Dim>
          : <Bad>{`No message is saved for this sheet${sheet.imageCount > 0 ? ", so leads get only the picture" : " and it has no picture, so nothing can be sent"}.`}</Bad>}

      <Dim>{sheet.imageCount > 0 ? `${sheet.imageCount} picture${sheet.imageCount === 1 ? "" : "s"} saved (up to 5, one is picked at random).` : "No picture yet."}</Dim>
      <Row>
        <Btn label="Add a picture" onPress={addPicture} disabled={sheet.imageCount >= 5} />
        <Btn label="Use a saved picture" onPress={() => setPicking((v) => !v)} disabled={sheet.imageCount >= 5} />
        {sheet.imageCount > 0 ? <Btn kind="danger" label="Remove all" onPress={async () => { if (await ask("Remove all pictures?", "From this sheet only.", "Remove", true)) run(() => wa.saveSheet(sheet._id, { image: "" }), "Pictures removed."); }} /> : null}
      </Row>
      {picking ? <PicturePicker sheetId={sheet._id} onPick={(p) => run(() => wa.saveSheet(sheet._id, { copyImage: { sheet: p.sheet, index: p.index } }), `Picture added from ${p.sheetName}.`)} /> : null}

      <Dim>Add people, one per line: Name, 98100 12345</Dim>
      <Input value={people} onChangeText={setPeople} multiline style={{ minHeight: 70, textAlignVertical: "top" }} />
      <Row>
        <Btn label="Add people" disabled={!peopleFromLines(people).length} onPress={() => run(() => wa.addPeople(sheet._id, peopleFromLines(people)).then((r) => { setPeople(""); return r; }), "People added.")} />
        {c.failed > 0 ? <Btn label={`Retry the ${c.failed} failed`} onPress={() => run(() => wa.retrySheet(sheet._id), "Back in line.")} /> : null}
        <Btn kind="danger" label="Delete sheet" onPress={async () => { if (await ask(`Delete "${sheet.name}"?`, "Its people are removed. Messages already sent stay in the log.", "Delete", true)) run(() => wa.deleteSheet(sheet._id), "Deleted."); }} />
      </Row>
    </Box>
  );
}

/** Pictures other sheets already hold: tap one to use it here too. */
function PicturePicker({ sheetId, onPick }) {
  const [list, setList] = useState(null);
  const [thumbs, setThumbs] = useState({});
  useEffect(() => {
    let alive = true;
    wa.pictures().then((r) => {
      if (!alive) return;
      const others = (r.pictures || []).filter((p) => p.sheet !== sheetId);
      setList(others);
      others.forEach((p) => wa.picture(p.sheet, p.index).then((x) => { if (alive) setThumbs((t) => ({ ...t, [`${p.sheet}:${p.index}`]: x.image })); }).catch(() => {}));
    }).catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [sheetId]);
  const { theme } = useTheme();
  if (list === null) return <Dim>Loading pictures…</Dim>;
  if (!list.length) return <Dim>No other sheet has a picture yet.</Dim>;
  return (
    <Row>
      {list.map((p) => {
        const src = thumbs[`${p.sheet}:${p.index}`];
        return (
          <View key={`${p.sheet}:${p.index}`} style={{ width: 96, gap: 4 }}>
            <View style={{ width: 96, height: 80, borderRadius: 8, overflow: "hidden", backgroundColor: theme.line }}>
              {src ? <Image source={{ uri: src }} style={{ width: 96, height: 80 }} contentFit="cover" /> : null}
            </View>
            <Btn label="Use" onPress={() => onPick(p)} disabled={!src} />
            <Dim>{p.sheetName}</Dim>
          </View>
        );
      })}
    </Row>
  );
}

function NewSheet({ reload }) {
  const [name, setName] = useState("");
  const act = useAct();
  return (
    <Box title="New sheet" subtitle="Add its messages, a picture and the people to message after making it. A new sheet sends nothing until you switch it on.">
      <Input value={name} onChangeText={setName} placeholder="Sheet name" autoCapitalize="words" />
      <Btn kind="primary" label="Create sheet" disabled={!name.trim()} onPress={async () => { if (await act(() => wa.createSheet(name.trim()), "Sheet created.")) { setName(""); reload(); } }} />
    </Box>
  );
}

/** Every message the server handed to the tablet, with the steps of each one and who stopped a failed one. */
function Latest({ rows }) {
  const [open, setOpen] = useState("");
  return (
    <Box title="Latest messages" subtitle="Tap a message to see every step: server, tablet and WhatsApp.">
      {rows.length === 0 ? <Dim>Nothing yet.</Dim> : rows.map((r) => (
        <View key={r.id} style={{ gap: 4, paddingVertical: 4 }}>
          <Row wrap={false} style={{ justifyContent: "space-between" }}>
            <Txt bold style={{ flex: 1 }} numberOfLines={1}>{r.name || `+${r.phone}`}{r.kind === "test" ? " (test)" : r.kind === "report" ? " (report)" : ""}</Txt>
            <Dim>{when(r.at)}</Dim>
          </Row>
          {r.status === "sent" ? <Good>Sent</Good> : r.status === "failed" ? <Bad>{`Failed${r.failedWhere ? ` at ${(WHO[r.failedWhere] || r.failedWhere).toLowerCase()}` : ""}: ${r.result || ""}`}</Bad> : <Dim>On the tablet…</Dim>}
          <Row><Btn label={open === r.id ? "Hide steps" : "Steps"} onPress={() => setOpen(open === r.id ? "" : r.id)} /></Row>
          {open === r.id ? <Steps row={r} /> : null}
        </View>
      ))}
    </Box>
  );
}

function Steps({ row }) {
  if (!row.steps || !row.steps.length) return <Dim>No step details were recorded for this message (it was sent before steps were tracked).</Dim>;
  return (
    <View style={{ gap: 5 }}>
      {row.steps.map((x, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8 }}>
          <Txt bold style={{ width: 16 }}>{STEP_MARK[x.state] || "•"}</Txt>
          <View style={{ flex: 1, opacity: x.state === "skipped" ? 0.5 : 1 }}>
            {x.state === "failed" ? <Bad>{x.label}</Bad> : <Txt>{x.label}</Txt>}
            {x.note ? <Dim>{x.note}</Dim> : null}
          </View>
          <Dim>{x.at && x.state !== "skipped" ? new Date(x.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}</Dim>
        </View>
      ))}
      {row.status === "queued" ? <Dim>{"… waiting for the tablet's answer"}</Dim> : null}
      {row.failedWhere ? <Txt bold>{`Stopped by: ${WHO[row.failedWhere] || row.failedWhere}`}</Txt> : null}
    </View>
  );
}

/** The We Three account: type the mobile number and MPIN once, then bring any We Three sheet in as a sheet here. */
function ThreeLink({ reload }) {
  const [link, setLink] = useState(null);
  const [mobile, setMobile] = useState("");
  const [mpin, setMpin] = useState("");
  const [origins, setOrigins] = useState(null);
  const [busy, setBusy] = useState("");
  const act = useAct();
  const loadLink = useCallback(async () => { try { setLink(await wa.link()); } catch (e) { setLink({ connected: false }); } }, []);
  const loadOrigins = useCallback(async () => {
    setBusy("origins");
    const r = await act(() => wa.origins());
    if (r && r.origins) setOrigins(r.origins);
    setBusy("");
  }, [act]);
  useEffect(() => { loadLink(); }, [loadLink]);
  useEffect(() => { if (link && link.connected) loadOrigins(); }, [link, loadOrigins]);

  const connect = async () => {
    setBusy("connect");
    const r = await act(() => wa.connectLink(mobile, mpin));
    if (r) { setMpin(""); await loadLink(); }
    setBusy("");
  };
  const importOne = async (name) => {
    setBusy(`import:${name}`);
    const r = await act(() => wa.importOrigin(name));
    if (r && r.added !== undefined) { await act(async () => `"${name}": ${r.added} people added. ${r.alreadySent} already messaged, ${r.invalid} without a valid number.`, `"${name}": ${r.added} people added. ${r.alreadySent} already messaged, ${r.invalid} without a valid number.`); await reload(); await loadOrigins(); }
    setBusy("");
  };
  return (
    <Box title="We Three sheets" subtitle="Bring the lead sheets from the We Three app in as sheets here. Each message that goes out is marked on the lead in We Three too.">
      {!link ? <Dim>Loading…</Dim> : !link.connected ? (
        <View style={{ gap: 8 }}>
          <Input value={mobile} onChangeText={setMobile} placeholder="We Three mobile number" keyboardType="phone-pad" maxLength={14} />
          <Input value={mpin} onChangeText={setMpin} placeholder="MPIN" keyboardType="number-pad" secureTextEntry maxLength={6} />
          <Btn kind="primary" label="Connect We Three" onPress={connect} loading={busy === "connect"} disabled={mobile.replace(/\D/g, "").length < 10 || mpin.length < 4} />
          <Dim>Stashr keeps only a sealed sign-in, never the MPIN.</Dim>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Good>{`Connected as ${link.name || link.mobile}`}</Good>
          <Row>
            <Btn label="Refresh" onPress={loadOrigins} disabled={busy !== ""} />
            <Btn kind="danger" label="Disconnect" onPress={async () => { if (await ask("Disconnect We Three?", "The sign-in kept for it is removed. Sheets already imported stay.", "Disconnect", true) && await act(() => wa.disconnectLink(), "Disconnected.")) { setOrigins(null); loadLink(); } }} />
          </Row>
          {!origins ? <Dim>Loading the sheets…</Dim> : origins.map((o) => (
            <View key={o.name} style={{ gap: 3, paddingVertical: 4 }}>
              <Txt bold>{o.name}</Txt>
              <Dim>{o.count} leads · {o.sent} messaged</Dim>
              <Row><Btn label={busy === `import:${o.name}` ? "Importing…" : "Import unsent leads"} onPress={() => importOne(o.name)} disabled={busy !== ""} /></Row>
            </View>
          ))}
        </View>
      )}
    </Box>
  );
}

/** A Google Contacts export (CSV or vCard) in, the people to keep ticked, a new group (sheet) out. */
function ContactsGroup({ reload }) {
  const [name, setName] = useState("");
  const [rows, setRows] = useState([]);
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const act = useAct();
  const pick = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "text/vcard", "text/x-vcard", "*/*"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const a = res.assets[0];
      const { File } = require("expo-file-system");
      const list = contactsFromFile(await new File(a.uri).text(), a.name || "");
      if (!list.length) { await act(async () => { throw new Error("No phone numbers found. Export from Google Contacts as Google CSV or vCard (.vcf)."); }); return; }
      setRows(list); setPicked(Object.fromEntries(list.map((r) => [r.phone, true])));
      if (!name) setName((a.name || "Contacts").replace(/\.(csv|vcf|vcard)$/i, "").slice(0, 60));
    } catch (e) { await act(async () => { throw e; }); }
  };
  const chosen = rows.filter((r) => picked[r.phone]);
  const create = async () => {
    setBusy(true);
    const made = await act(() => wa.createSheet(name.trim(), "contacts"));
    if (made && made.id) {
      const r = await act(() => wa.addPeople(made.id, chosen), `Group created. Now add its messages and picture.`);
      if (r) { setRows([]); setPicked({}); setName(""); await reload(); }
    }
    setBusy(false);
  };
  return (
    <Box title="Group from Google contacts" subtitle="Export your contacts from Google Contacts as CSV or vCard (.vcf), pick the people, and they become their own sheet.">
      <Row>
        <Btn label="Choose the contacts file" onPress={pick} />
        {rows.length > 0 ? <><Btn label="Tick all" onPress={() => setPicked(Object.fromEntries(rows.map((r) => [r.phone, true])))} /><Btn label="Untick all" onPress={() => setPicked({})} /><Dim>{chosen.length} of {rows.length} ticked</Dim></> : null}
      </Row>
      {rows.length > 0 ? (
        <>
          {rows.slice(0, 200).map((r) => <Toggle key={r.phone} label={r.name || "No name"} hint={`+${r.phone}`} value={Boolean(picked[r.phone])} onChange={(v) => setPicked({ ...picked, [r.phone]: v })} />)}
          {rows.length > 200 ? <Dim>Showing the first 200 of {rows.length}. Tick all still includes everyone.</Dim> : null}
          <Input value={name} onChangeText={setName} placeholder="Group name" autoCapitalize="words" maxLength={80} />
          <Btn kind="primary" label={`Create group with ${chosen.length} people`} onPress={create} loading={busy} disabled={!name.trim() || !chosen.length} />
        </>
      ) : null}
    </Box>
  );
}
