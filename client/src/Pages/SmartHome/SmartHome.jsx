import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
  getHomeDevices, removeHomeDevice, renameHomeDevice, sendHomeCommand, labelHomeLan, mergeHomeLan, forgetHomeLan,
  getHomeEvents, askHomeAssistant, getHomeMovies, saveHomeMovies, startHomeMoviesGoogle
} from "../../api/client";
import { Section, Skeleton, Empty, useConfirm } from "../Render/RenderUi";
import { usePolling } from "../Render/renderHooks";
import { errorMessage } from "../Render/renderUtils";
import { stateOf, STATE_LABEL, fmtBytes, ago, fmtSpeed, fmtDuration, fmtClock, downloadRows, DOWNLOAD_LABEL, nowPlaying, signalWord, groupByRoom, lanName, splitStale, TAG_LABEL, batteryOf } from "../../lib/smartHome";
import { LiveMapCard } from "./HomeMap";
import { HouseMapCard } from "./HouseMap";
import { RoomLabCard } from "./RoomLab";
import { TrailCard } from "./TrailMap";
import { TelegramCheckCard } from "./TelegramCheck";
import { HealthCard, healthCounts, InsightsCard, LocationsCard, HomeScreenCard, FeaturesCard, PairCard, PeopleCard, PhonesCard, AlertsCard, TvTimeCard, ScenesCard, SchedulesCard, PlacesCard, SpeedCard, CameraCard, SlideshowCard, useHomeSettings } from "./HomeExtras";
import "../Render/RenderDashboard.css";
import "./SmartHome.css";

const APPS = [
  ["Netflix", "com.netflix.ninja"], ["Prime Video", "com.amazon.amazonvideo.livingroom"], ["JioHotstar", "in.startv.hotstar"],
  ["YouTube", "com.google.android.youtube.tv"], ["MX Player", "com.mxtech.videoplayer.television"], ["Zee5", "com.graymatrix.did"]
];

/** Sends one command and tells you what happened. */
function useSend(reload) {
  return useCallback(async (id, type, args, doneText) => {
    try {
      await sendHomeCommand(id, type, args);
      toast.success(doneText || "Sent. The device picks it up within a minute.");
      reload();
    } catch (e) { toast.error(errorMessage(e, "Could not send that.")); }
  }, [reload]);
}

function Dot({ state }) { return <span className={"sh-dot is-" + state} aria-hidden="true" />; }

function Pending({ commands }) {
  const list = (commands || []).slice(0, 4);
  if (!list.length) return null;
  return (
    <ul className="sh-cmds" aria-label="Recent commands">
      {list.map((c) => (
        <li key={c.id} className={"is-" + c.status}>
          <b>{c.type.replace(/_/g, " ")}{c.args?.name ? ` · ${c.args.name}` : ""}</b>
          <span>{c.status === "done" ? "done" : c.status === "failed" ? "failed" : "waiting"}{c.result ? ` · ${c.result}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function TvCard({ device, send, onChanged }) {
  const confirm = useConfirm();
  const s = device.status || {};
  const state = stateOf(device);
  const usb = s.usb || {};
  const movies = s.movies || [];
  const cmd = (type, args, text) => send(device.id, type, args, text);
  const usedPct = usb.total ? Math.round(100 * (1 - usb.free / usb.total)) : 0;
  return (
    <Section title={device.name} subtitle={`${STATE_LABEL[state]} · seen ${ago(device.lastSeen)}`}
      actions={<><Dot state={state} /><DeviceMenu device={device} onChanged={onChanged} /></>}>
      {confirm.dialog}
      <div className="sh-now">
        <strong>{state === "on" ? nowPlaying(s) : state === "standby" ? "Screen is off" : "Not connected"}</strong>
        <div className="sh-chips">
          {s.wifi?.rssi ? <span>Wi-Fi {signalWord(s.wifi.rssi)} ({s.wifi.rssi} dBm)</span> : null}
          {s.volume?.max ? <span>Volume {s.volume.level}/{s.volume.max}</span> : null}
          {s.uptimeSec ? <span>Up {Math.round(s.uptimeSec / 3600)} h</span> : null}
          {s.version ? <span>App {s.version}</span> : null}
        </div>
      </div>

      {state !== "off" && (
        <div className="sh-controls">
          <div className="sh-row">
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("media", { action: "previous" })} aria-label="Previous">⏮</button>
            <button className="rd-btn rd-btn--primary" onClick={() => cmd("media", { action: "play_pause" })} aria-label="Play or pause">⏯ Play / Pause</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("media", { action: "next" })} aria-label="Next">⏭</button>
            <span className="sh-sep" />
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("volume", { action: "down" })}>Vol −</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("volume", { action: "up" })}>Vol +</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("volume", { action: "mute" })}>Mute</button>
            <span className="sh-sep" />
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("key", { key: "HOME" })}>Home</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => cmd("key", { key: "BACK" })}>Back</button>
          </div>
          <div className="sh-row">
            {APPS.map(([label, pkg]) => <button key={pkg} className="rd-btn rd-btn--quiet" onClick={() => cmd("launch_app", { package: pkg }, `Opening ${label}…`)}>{label}</button>)}
          </div>
        </div>
      )}

      <div className="sh-block">
        <h4>USB drive</h4>
        {usb.present === false ? <p className="sh-dim">No USB drive is plugged in.</p> : usb.total ? (
          <>
            <div className="sh-bar" role="img" aria-label={`${usedPct}% used`}><i style={{ width: usedPct + "%" }} /></div>
            <p className="sh-dim">{fmtBytes(usb.free)} free of {fmtBytes(usb.total)}{usb.fs === "vfat" ? " · FAT32 (files must be under 4 GB)" : ""}</p>
          </>
        ) : <p className="sh-dim">No details yet.</p>}
        {state !== "off" && usb.present !== false && s.wifi?.ip ? (
          <p className="sh-dim">
            Fastest way to add a movie: on your home Wi-Fi, open{" "}
            <a href={`http://${s.wifi.ip}:${s.wifi.uploadPort || 8765}`} target="_blank" rel="noreferrer noopener">the TV's upload page</a>
            {" "}and drop the file in (the PIN is on the TV, on the USB tile). It goes straight to the USB drive, with nothing in between.
          </p>
        ) : null}
        {s.upload?.active ? (
          <div className="sh-up">
            <b>Receiving {s.upload.name}</b>
            <div className="sh-bar"><i style={{ width: Math.round(100 * (s.upload.done || 0) / Math.max(1, s.upload.size || 1)) + "%" }} /></div>
          </div>
        ) : null}
        {s.sync?.line ? <p className="sh-dim">{s.sync.line}</p> : null}
        {s.sync?.error ? <p className="sh-bad">Sync: {s.sync.error}</p> : null}
        {movies.length ? (
          <ul className="sh-movies">
            {movies.map((m) => (
              <li key={m.name}>
                <div><b>{m.name}</b><span>{fmtBytes(m.size)}</span></div>
                <div className="sh-row">
                  {state === "on" && <button className="rd-btn rd-btn--quiet" onClick={() => cmd("play_movie", { name: m.name }, `Playing ${m.name}…`)}>Play on TV</button>}
                  <button className="rd-btn rd-btn--danger-quiet" onClick={async () => {
                    if (await confirm.ask({ title: "Remove from the USB drive?", message: `“${m.name}” will be deleted from the TV’s USB drive. This cannot be undone.`, confirmLabel: "Remove", danger: true })) cmd("remove_movie", { name: m.name }, "Removal sent.");
                  }}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="sh-dim">No movies on the USB drive.</p>}
        <div className="sh-row"><button className="rd-btn rd-btn--quiet" onClick={() => cmd("sync_now", {}, "Asking the TV to sync…")}>Sync now</button></div>
      </div>
      <Pending commands={device.commands} />
    </Section>
  );
}

function LanRow({ device, row, rows, onChanged, send }) {
  const confirm = useConfirm();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ label: row.label || "", room: row.room || "", person: row.person || "", tag: row.tag || "", mac: row.wakeMac || "" });
  const [into, setInto] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try { await labelHomeLan(device.id, row.key, f); setEdit(false); onChanged(); }
    catch (e) { toast.error(errorMessage(e, "Could not save.")); }
  };
  const merge = async () => {
    if (!into) return;
    try { await mergeHomeLan(device.id, row.key, into); setEdit(false); onChanged(); toast.success("Merged into one device."); }
    catch (e) { toast.error(errorMessage(e, "Could not merge.")); }
  };
  const forget = async () => {
    if (!(await confirm.ask({ title: `Forget ${lanName(row)}?`, message: "It disappears from the list and its name is deleted. If it comes back on the Wi-Fi, it shows up as a new device.", confirmLabel: "Forget", danger: true }))) return;
    try { await forgetHomeLan(device.id, row.key); onChanged(); } catch (e) { toast.error(errorMessage(e, "Could not remove it.")); }
  };
  const ph = row.phone;
  return (
    <li className={(row.up ? "" : "is-down") + (row.tag === "unknown" || (!row.tag && !row.label) ? " is-unknown" : "")}>
      {confirm.dialog}
      <Dot state={row.up ? "on" : "off"} />
      <div className="sh-lan__main">
        <b>{ph && !row.label ? ph.name : lanName(row)}{row.tag ? <em className={"sh-tag is-" + row.tag}>{TAG_LABEL[row.tag]}</em> : !row.label ? <em className="sh-tag is-new">Not named</em> : null}{row.person ? <em className="sh-tag">{row.person}</em> : null}</b>
        <span>{row.ip}{row.name && row.name !== lanName(row) ? " · " + row.name : ""}{row.vendor ? " · " + row.vendor : ""}{row.wakeMac ? " · " + row.wakeMac : ""}</span>
        <span>{row.up ? (row.pingMs ? `answers in ${row.pingMs} ms` : "online") : `last seen ${ago(row.lastSeen)}`} · first seen {ago(row.firstSeen)}{row.ports && row.ports.length ? ` · open ports ${row.ports.join(", ")}` : ""}</span>
        {ph ? <span className="sh-health">📱 {ph.name}: 🔋 {ph.battery ?? "?"}%{ph.charging ? " charging" : ""}{ph.storage && ph.storage.total ? ` · 💾 ${Math.round(100 * (1 - ph.storage.free / ph.storage.total))}% full` : ""} · reported {ago(ph.lastSeen)}</span> : null}
        {(row.risks || []).map((r) => <span key={r.port} className="sh-bad">⚠ Port {r.port} is open: {r.why}. Turn it off in that device's settings if you did not mean it.</span>)}
      </div>
      {edit ? (
        <div className="sh-lan__edit">
          <div className="sh-row">
            <input value={f.label} onChange={set("label")} placeholder="Name" maxLength={60} aria-label="Device name" />
            <input value={f.room} onChange={set("room")} placeholder="Room" maxLength={60} aria-label="Room" />
            <input value={f.person} onChange={set("person")} placeholder="Whose? (for who is home)" maxLength={40} aria-label="Person" />
            <select value={f.tag} onChange={set("tag")} aria-label="Kind of device">
              <option value="">Not sorted</option><option value="mine">Mine</option><option value="family">Family</option><option value="guest">Guest</option><option value="unknown">Unknown</option>
            </select>
            <input value={f.mac} onChange={set("mac")} placeholder="MAC, for wake-up (optional)" maxLength={17} aria-label="MAC address" />
          </div>
          <div className="sh-row">
            <button className="rd-btn rd-btn--primary" onClick={save}>Save</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => setEdit(false)}>Cancel</button>
            <span className="sh-sep" />
            <select value={into} onChange={(e) => setInto(e.target.value)} aria-label="Same device as">
              <option value="">Same device as…</option>
              {rows.filter((r) => r.key !== row.key).map((r) => <option key={r.key} value={r.key}>{lanName(r)} ({r.ip})</option>)}
            </select>
            <button className="rd-btn rd-btn--quiet" disabled={!into} onClick={merge}>Merge</button>
            <button className="rd-btn rd-btn--danger-quiet" onClick={forget}>Forget</button>
          </div>
        </div>
      ) : (
        <div className="sh-row">
          {row.wakeMac && !row.up && send ? <button className="rd-btn rd-btn--quiet" onClick={() => send(device.id, "wake", { mac: row.wakeMac }, `Waking ${lanName(row)}…`)}>Wake</button> : null}
          <button className="rd-btn rd-btn--quiet" onClick={() => setEdit(true)}>Name / room</button>
        </div>
      )}
    </li>
  );
}

function HubCard({ device, send, onChanged }) {
  const s = device.status || {};
  const state = stateOf(device);
  const [showOld, setShowOld] = useState(false);
  const smart = s.agent === "stashr-hub";
  const { fresh, old } = splitStale(device.lan);
  const groups = groupByRoom(fresh);
  const up = (device.lan || []).filter((d) => d.up).length;
  const unnamed = fresh.filter((d) => !d.label && !d.tag).length;
  const sendHub = smart ? send : null;
  return (
    <Section title={device.name} subtitle={`${STATE_LABEL[state]} · seen ${ago(device.lastSeen)} · ${up} of ${fresh.length} devices answering${unnamed ? ` · ${unnamed} not named yet` : ""}`}
      actions={<><Dot state={state} /><DeviceMenu device={device} onChanged={onChanged} /></>}>
      <div className="sh-chips">
        {batteryOf(s) ? <span>Battery {batteryOf(s).pct}%{batteryOf(s).charging ? " · charging" : ""}</span> : null}
        {s.wifi?.rssi ? <span>Wi-Fi {signalWord(s.wifi.rssi)} ({s.wifi.rssi} dBm)</span> : null}
        {s.scan?.at ? <span>Last scan {ago(s.scan.at)}{s.scan.ms ? ` (${Math.round(s.scan.ms / 1000)} s)` : ""}</span> : null}
        {s.scan?.subnet ? <span>{s.scan.subnet}</span> : null}
        {s.version ? <span>Stashr Hub {s.version}{s.updateWaiting ? " · update waiting for a tap on the tablet" : ""}</span> : null}
        {s.voice ? <span>🎤 “Hey Stashr” {s.voice === "on" ? "listening" : s.voice}</span> : null}
      </div>
      <p className="sh-dim">{smart
        ? "The tablet finds each device's own name where the device shares it (router, Bonjour, Windows), so a phone keeps its row and your label when its IP changes. It cannot read battery or storage of a phone; pair that phone with Stashr Hub for those."
        : "This tablet runs the older hub app, which only sees IP addresses. Install Stashr Hub from /apps for device names, the camera, voice and speed tests."}</p>
      <div className="sh-row">
        <button className="rd-btn rd-btn--quiet" onClick={() => send(device.id, "scan_now", {}, "Scanning the Wi-Fi…")}>Scan now</button>
        {smart ? <button className="rd-btn rd-btn--quiet" onClick={() => send(device.id, "check_update", {}, "Checking for a Stashr Hub update…")}>Check for update</button> : null}
        {smart ? <button className="rd-btn rd-btn--quiet" onClick={() => send(device.id, "screen_off", {}, "Putting the tablet screen to sleep…")}>Turn screen off</button> : null}
      </div>
      {groups.length ? groups.map(([room, rows]) => (
        <div className="sh-block" key={room}>
          <h4>{room}</h4>
          <ul className="sh-lan">{rows.map((r) => <LanRow key={r.key} device={device} row={r} rows={device.lan} onChanged={onChanged} send={sendHub} />)}</ul>
        </div>
      )) : <p className="sh-dim">No devices seen yet. The first scan takes about a minute.</p>}
      {old.length ? (
        <div className="sh-block">
          <button className="rd-btn rd-btn--quiet" onClick={() => setShowOld(!showOld)} aria-expanded={showOld}>{showOld ? "Hide" : "Show"} {old.length} device{old.length > 1 ? "s" : ""} not seen for a day</button>
          {showOld ? <ul className="sh-lan">{old.map((r) => <LanRow key={r.key} device={device} row={r} rows={device.lan} onChanged={onChanged} send={sendHub} />)}</ul> : null}
        </div>
      ) : null}
      <Pending commands={device.commands} />
    </Section>
  );
}

function DeviceMenu({ device, onChanged }) {
  const confirm = useConfirm();
  const rename = async () => {
    const name = window.prompt("Name for this device", device.name);
    if (name === null || !name.trim() || name.trim() === device.name) return;
    try { await renameHomeDevice(device.id, name.trim()); onChanged(); } catch (e) { toast.error(errorMessage(e, "Could not rename it.")); }
  };
  // A TV that reports through the tablet comes back by itself, so it cannot be removed here.
  if (device.viaHub) return <button className="rd-btn rd-btn--quiet" onClick={rename}>Rename</button>;
  const remove = async () => {
    if (!(await confirm.ask({ title: `Remove ${device.name}?`, message: "It stops reporting and its history is deleted. Sign in again on the tablet to bring it back.", confirmLabel: "Remove", danger: true }))) return;
    try { await removeHomeDevice(device.id); onChanged(); } catch (e) { toast.error(errorMessage(e, "Could not remove it.")); }
  };
  return (
    <>
      {confirm.dialog}
      <button className="rd-btn rd-btn--quiet" onClick={rename}>Rename</button>
      <button className="rd-btn rd-btn--danger-quiet" onClick={remove}>Remove</button>
    </>
  );
}

/** Movies from a Google Drive folder to the TV's USB drive, through a Google account connected right here (Photo Cloud is not needed). */
/** Every movie the TV is downloading or has downloaded lately: how much is here, the status, when it started, the speed, the time left. */
function DownloadsList({ tvs }) {
  const withRows = (tvs || []).map((tv) => ({ tv, rows: downloadRows(tv.status) })).filter((x) => x.rows.length);
  if (!withRows.length) return null;
  return withRows.map(({ tv, rows }) => (
    <div key={tv.id} className="sh-dl">
      <h4 className="sh-dl__title">Downloads on {tv.name} <span className="sh-dim">· TV seen {ago(tv.lastSeen)}</span></h4>
      <ul className="sh-movies">
        {rows.map((r) => (
          <li key={r.name} className={"sh-dl__row is-" + r.status}>
            <div className="sh-dl__main">
              <b>{r.name}</b>
              <span className={"sh-dl__state is-" + r.status}>{DOWNLOAD_LABEL[r.status]}{r.status === "downloading" || r.status === "failed" ? ` · ${r.pct}%` : ""}</span>
              {r.status !== "waiting" ? <div className="sh-bar" role="progressbar" aria-valuenow={r.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.name} ${r.pct}%`}><i style={{ width: r.pct + "%" }} /></div> : null}
              <span>
                {r.size ? `${fmtBytes(r.done)} of ${fmtBytes(r.size)}` : "Size unknown"}
                {r.startedAt ? ` · started ${fmtClock(r.startedAt)}` : ""}
                {r.speed ? ` · ${r.status === "done" ? "average " : ""}${fmtSpeed(r.speed)}` : ""}
                {r.left ? ` · about ${fmtDuration(r.left)} left` : ""}
                {r.took ? ` · took ${fmtDuration(r.took)}` : ""}
                {r.status === "done" && r.finishedAt ? ` · finished ${fmtClock(r.finishedAt)}` : ""}
              </span>
              {r.error ? <span className="sh-bad">{r.error}</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  ));
}

function MoviesCard({ tvs }) {
  const [data, setData] = useState(null);
  const [folder, setFolder] = useState("");
  const [account, setAccount] = useState("");
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fullAccess, setFullAccess] = useState(false);
  // Back from Google's consent screen: say how it went, then drop the ?google= part of the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const r = url.searchParams.get("google");
    if (!r) return;
    const say = { connected: () => toast.success("Google Drive connected. Now paste the folder link."), cancelled: () => toast.info("Google connection cancelled."), missing_scope: () => toast.error("Google did not give Drive access. Connect again and allow it."), error: () => toast.error("Could not connect Google Drive. Try again.") };
    (say[r] || say.error)();
    url.searchParams.delete("google");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }, []);
  const connectGoogle = async () => {
    if (busy) return;
    setBusy(true);
    try { const r = await startHomeMoviesGoogle(fullAccess); window.location.assign(r.url); }
    catch (err) { toast.error(errorMessage(err, "Google sign-in is not set up on this server.")); setBusy(false); }
  };
  const load = useCallback(async () => {
    try {
      const d = await getHomeMovies();
      setData(d);
      setAccount((a) => a || d.settings.connectionId || d.connections[0]?.id || "");
      setDel(d.settings.deleteAfterSync);
      setFolder((f) => f || (d.settings.folderId ? "https://drive.google.com/drive/folders/" + d.settings.folderId : ""));
    } catch { /* the card simply stays empty */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 20000);

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try { await saveHomeMovies({ connectionId: account, folder, deleteAfterSync: del }); toast.success("Saved. The TV picks up the movies within a few minutes."); await load(); }
    catch (err) { toast.error(errorMessage(err, "Could not save.")); }
    finally { setBusy(false); }
  };
  if (!data) return null;
  const chosen = data.connections.find((c) => c.id === account);
  return (
    <Section title="Movies from Google Drive" subtitle="Put a movie in the Drive folder and the TV copies it to its USB drive on its own.">
      {data.connections.length === 0 ? (
        <div className="sh-movies-form">
          <p className="sh-dim">Connect the Google account whose Drive holds your movies. Photo Cloud is not needed.</p>
          <label className="sh-switch">
            <input type="checkbox" checked={fullAccess} onChange={(e) => setFullAccess(e.target.checked)} />
            Also allow removing a movie from Drive after it reaches the TV (asks for full Drive access)
          </label>
          <div className="sh-row"><button className="rd-btn rd-btn--primary" type="button" onClick={connectGoogle} disabled={busy}>Connect Google Drive</button></div>
        </div>
      ) : (
        <form className="sh-movies-form" onSubmit={save}>
          <div className="sh-row">
            <select value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Google account">
              {data.connections.map((c) => <option key={c.id} value={c.id}>{c.label}{c.email ? ` · ${c.email}` : ""}</option>)}
            </select>
            <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Paste the Drive folder link" aria-label="Drive folder link" style={{ flex: "1 1 18rem" }} />
            <button className="rd-btn rd-btn--primary" type="submit" disabled={busy || !folder.trim()}>Save</button>
          </div>
          <label className="sh-switch" title={chosen && !chosen.canDelete ? "This Google connection can only read Drive." : ""}>
            <input type="checkbox" checked={del} disabled={chosen && !chosen.canDelete} onChange={(e) => setDel(e.target.checked)} />
            Remove a movie from Drive once the TV has it on the USB drive
          </label>
          {chosen && !chosen.canDelete ? <p className="sh-dim">Removing needs full Drive access. This Google account was connected read-only, so movies stay in Drive and the USB drive mirrors the folder. Reconnect it with full Drive access to switch on removal.</p> : null}
        </form>
      )}
      {data.error ? <p className="sh-bad" role="alert">{data.error}</p> : null}
      {data.connections.length > 0 ? (
        <div className="sh-row">
          <button className="rd-btn rd-btn--quiet" type="button" onClick={connectGoogle} disabled={busy}>{data.error && /401|reconnect|not connected/i.test(data.error) ? "Reconnect Google Drive" : "Connect another Google account"}</button>
          <label className="sh-switch"><input type="checkbox" checked={fullAccess} onChange={(e) => setFullAccess(e.target.checked)} /> Full Drive access (to remove movies after sync)</label>
        </div>
      ) : null}
      {data.lastDelete?.error ? <p className="sh-bad">Could not remove “{data.lastDelete.name}” from Drive: {data.lastDelete.error}</p> : null}
      <DownloadsList tvs={tvs} />
      {data.waiting ? (
        data.waiting.length ? (
          <ul className="sh-movies">{data.waiting.map((m) => <li key={m.name}><div><b>{m.name}</b><span>{fmtBytes(m.size)} · waiting in Drive for the TV</span></div></li>)}</ul>
        ) : <p className="sh-dim">The Drive folder has no movies waiting.</p>
      ) : null}
    </Section>
  );
}

/** Speech to text in the browser (Chrome, Edge, Android): Hindi or English, then the sentence goes to Ask Stashr. */
const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

function Assistant({ onDone }) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState(() => { try { return localStorage.getItem("sh-voice-lang") || "hi-IN"; } catch { return "hi-IN"; } });
  const ask = async (sentence) => {
    const t = (sentence ?? text).trim();
    if (!t) return;
    setBusy(true);
    try { const r = await askHomeAssistant(t); setReply(r.reply); setText(""); onDone(); }
    catch (e) { setReply(errorMessage(e, "Could not do that.")); }
    finally { setBusy(false); }
  };
  const listen = () => {
    if (!Recognition || listening) return;
    const rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (e) => {
      const said = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      setText(said);
      if (e.results[e.results.length - 1].isFinal) finalText = said;
    };
    rec.onerror = (e) => { setListening(false); if (e.error === "not-allowed") toast.error("Allow the microphone for this site to talk to Stashr."); };
    rec.onend = () => { setListening(false); if (finalText.trim()) ask(finalText); };
    setListening(true);
    rec.start();
  };
  const pickLang = (v) => { setLang(v); try { localStorage.setItem("sh-voice-lang", v); } catch { /* remembered only for now */ } };
  return (
    <Section title="Ask Stashr" subtitle="Type or tap the mic: “volume up”, “tv ki awaaz kam karo”, “arijit ke gaane chalao”, “tv par news lagao”, “movie night”, “kaun ghar par hai”, “camera on”, “speed test”">
      <form className="sh-row sh-ask" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={listening ? "Listening…" : "What should I do?"} maxLength={200} aria-label="Command" />
        {Recognition ? <>
          <button type="button" className={"rd-btn sh-mic" + (listening ? " is-live" : "")} onClick={listen} aria-label={listening ? "Listening" : "Speak a command"} aria-pressed={listening}>{listening ? "● Listening" : "🎤 Speak"}</button>
          <select value={lang} onChange={(e) => pickLang(e.target.value)} aria-label="Voice language"><option value="hi-IN">हिंदी / Hinglish</option><option value="en-IN">English</option></select>
        </> : null}
        <button className="rd-btn rd-btn--primary" type="submit" disabled={busy}>Send</button>
      </form>
      {reply ? <p className="sh-reply" role="status">{reply}</p> : null}
      {!Recognition ? <p className="sh-dim">This browser cannot listen. Chrome or Edge can, on a phone or a computer.</p> : null}
    </Section>
  );
}

/** One card that fails to draw must not take the whole page down: it shows a short note instead and the rest keeps working. */
class CardBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error("Smart home card failed:", error); } // eslint-disable-line no-console
  render() {
    if (!this.state.failed) return this.props.children;
    return <p className="sh-bad" role="alert">One card on this tab could not be shown. The rest still works; reloading the page usually fixes it.</p>;
  }
}

export default function SmartHome() {
  const [devices, setDevices] = useState(null);
  const [people, setPeople] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  const home = useHomeSettings();
  const load = useCallback(async () => {
    try {
      const [d, e] = await Promise.all([getHomeDevices(), getHomeEvents(30)]);
      setDevices(d.devices); setPeople(d.people || []); setEvents(e.events); setError("");
    } catch (e) { setError(errorMessage(e, "Could not load your devices.")); }
  }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 15000);
  const send = useSend(load);
  const list = devices || [];
  const smartHub = list.find((d) => d.kind === "hub" && d.status?.agent === "stashr-hub");
  const phones = list.filter((d) => d.kind === "phone");

  const TABS = [["overview", "Overview"], ["devices", "Devices"], ["security", "Camera & alerts"], ["automations", "Automations"], ["insights", "Insights"], ["media", "Media & network"], ["health", "Health"]];
  const [tab, setTabState] = useState(() => { try { const t = localStorage.getItem("smartHomeTab"); return TABS.some(([k]) => k === t) ? t : "overview"; } catch { return "overview"; } });
  const goTo = (t) => { setTabState(t); try { localStorage.setItem("smartHomeTab", t); } catch { /* optional */ } window.scrollTo?.({ top: 0 }); };

  return (
    <main className="sh-page">
      <header className="sh-head">
        <div><h1>Smart home</h1><p className="sh-dim">Your TV, the Wi-Fi, the family's phones and the tablet camera, from anywhere.</p></div>
      </header>
      {error ? <p className="sh-bad" role="alert">{error}</p> : null}
      <nav className="sh-tabs" aria-label="Smart home sections">
        {TABS.map(([k, label]) => <button key={k} type="button" className={"sh-tab" + (tab === k ? " is-on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => goTo(k)}>{label}</button>)}
      </nav>
      {tab === "overview" ? (<CardBoundary key="overview"><>
        {(() => { const c = healthCounts(list); return c.bad ? <p className="sh-bad" role="status">{c.bad} thing{c.bad > 1 ? "s" : ""} on your devices need{c.bad > 1 ? "" : "s"} fixing. <button type="button" className="rd-btn rd-btn--quiet" onClick={() => goTo("health")}>Open the health check</button></p> : null; })()}
        <Assistant onDone={load} />
        <HomeScreenCard />
        <FeaturesCard home={home} devices={list} goTo={goTo} />
        <Section title="What happened" subtitle="The last 60 days are kept">
          {events.length ? (
            <ul className="sh-events">{events.map((e) => <li key={e.id}><span>{ago(e.at)}</span><b>{e.text}</b></li>)}</ul>
          ) : <p className="sh-dim">Nothing yet.</p>}
        </Section>
      </></CardBoundary>) : null}
      {tab === "devices" ? (<CardBoundary key="devices"><>
        <PeopleCard people={people} />
        {devices === null ? <Skeleton lines={5} /> : list.length === 0 ? (
          <Empty icon="📺" title="Nothing connected yet">Install Stashr Hub from /apps on the always-on tablet and type a code from “Link the home tablet or TV” below. Your TV joins by itself once its Stashr app is open.</Empty>
        ) : list.filter((d) => d.kind !== "phone").map((d) => d.kind === "tv"
          ? <TvCard key={d.id} device={d} send={send} onChanged={load} />
          : <HubCard key={d.id} device={d} send={send} onChanged={load} />)}
        <LocationsCard />
        <LiveMapCard />
        <PhonesCard phones={phones} onChanged={load} />
        <PairCard devices={list} onChanged={load} />
      </></CardBoundary>) : null}
      {tab === "security" ? (<CardBoundary key="security"><>
        <CameraCard hub={smartHub} send={send} home={home} />
        <TelegramCheckCard />
        <AlertsCard home={home} />
      </></CardBoundary>) : null}
      {tab === "automations" ? (<CardBoundary key="automations"><>
        <ScenesCard home={home} />
        <SchedulesCard home={home} />
        <PlacesCard home={home} phones={phones} hasSmartHub={Boolean(smartHub)} />
        <TvTimeCard home={home} />
      </></CardBoundary>) : null}
      {tab === "health" ? (<CardBoundary key="health"><>
        <HealthCard devices={list} />
      </></CardBoundary>) : null}
      {tab === "insights" ? (<CardBoundary key="insights"><>
        <HouseMapCard />
        <RoomLabCard />
        <TrailCard />
        <InsightsCard />
      </></CardBoundary>) : null}
      {tab === "media" ? (<CardBoundary key="media"><>
        <SpeedCard hasSmartHub={Boolean(smartHub)} send={send} hubId={smartHub?.id} />
        <MoviesCard tvs={list.filter((d) => d.kind === "tv")} />
        <SlideshowCard home={home} hub={smartHub} send={send} />
      </></CardBoundary>) : null}
    </main>
  );
}
