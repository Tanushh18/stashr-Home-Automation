import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
  makeHomePairCode, getHomeSettings, saveHomeSettings, saveHomeSchedules, saveHomePlaces, testHomePlace, getHomeDashboard, getHomeInsights, saveHomeHistory, deleteHomeHistory, saveHomeSpots, getLocationCode, rotateLocationCode, getHubCode, rotateHubCode, getHomeWhere, locateNow, saveHomeScenes, runHomeScene,
  getHomeShare, saveHomeShare, getHomePlaceTrail, getHomeUsage, getHomeSpeed, getHomeMedia, getHomeMediaBlob, deleteHomeMedia, getHomeLiveFrame, testHomeBrief, setHomePhonePerson, removeHomeDevice, mergeHomeDevice, setHomeSyncPaused
} from "../../api/client";
import { Section, useConfirm } from "../Render/RenderUi";
import { usePolling } from "../Render/renderHooks";
import { errorMessage } from "../Render/renderUtils";
import { ago, fmtBytes, fmtMinutes, daysLabel, stepLabel, STEP_CHOICES } from "../../lib/smartHome";
import { TvTimeChart, SpeedChart, CommuteChart, PlaceTrailChart } from "./HomeCharts";
import { MapPicker, PlaceMap } from "./HomeMap";
import { parseCoords, batteryOf, healthItems, healthReport } from "../../lib/smartHome";

/** The settings every card here edits, loaded once. */
export function useHomeSettings() {
  const [settings, setSettings] = useState(null);
  const load = useCallback(async () => { try { setSettings(await getHomeSettings()); } catch { /* cards stay hidden */ } }, []);
  useEffect(() => { load(); }, [load]);
  const save = useCallback(async (body, done = "Saved.") => {
    try { setSettings(await saveHomeSettings(body)); toast.success(done); return true; }
    catch (e) { toast.error(errorMessage(e, "Could not save.")); return false; }
  }, []);
  return { settings, setSettings, save, reload: load };
}

/* ───────── add a tablet or a family phone ───────── */

const KIND_LABEL = { hub: "Home tablet", tv: "TV", phone: "Family phone" };

export function PairCard({ devices = [], onChanged = () => {} }) {
  const [code, setCode] = useState("");
  const [old, setOld] = useState({ kind: "hub", name: "", code: null });
  const { ask, dialog } = useConfirm();
  const [merging, setMerging] = useState({ id: "", into: "" });
  const linked = devices.filter((d) => d.kind === "hub" || d.kind === "tv" || d.kind === "phone");
  useEffect(() => { getHubCode().then((r) => setCode(r.code)).catch(() => {}); }, []);
  const copy = async () => { try { await navigator.clipboard.writeText(code); toast.success("Code copied."); } catch { toast.error("Could not copy. Select the code and copy it."); } };
  const renew = async () => {
    if (!(await ask({ title: "Make a new tablet code?", message: "A tablet that is already linked stays linked. Only a new tablet needs the new code.", confirmLabel: "New code" }))) return;
    try { setCode((await rotateHubCode()).code); toast.success("New code ready."); } catch (e) { toast.error(errorMessage(e, "Could not make a new code.")); }
  };
  const disconnect = async (d) => {
    if (!(await ask({ title: `Disconnect ${d.name || "this device"}?`, message: d.kind === "phone" ? "This phone stops sharing its location and leaves the family list. To bring it back, link it again in Stashr Location with a new code." : "It stops syncing with Stashr. To bring it back, type the home-device code on it again.", confirmLabel: "Disconnect", danger: true }))) return;
    try { await removeHomeDevice(d.id); toast.success("Disconnected."); onChanged(); } catch (e) { toast.error(errorMessage(e, "Could not disconnect.")); }
  };
  const merge = async (d) => {
    const keep = linked.find((x) => x.id === merging.into);
    if (!keep) return;
    if (!(await ask({ title: `Merge "${d.name || "this device"}" into "${keep.name || "the other one"}"?`, message: `Everything recorded for "${d.name || "this device"}" (history, places, trail, room samples) moves to "${keep.name || "the other one"}", which keeps its own name. Then "${d.name || "this device"}" is removed. This cannot be undone.`, confirmLabel: "Merge", danger: true }))) return;
    try { await mergeHomeDevice(d.id, keep.id); toast.success("Merged."); setMerging({ id: "", into: "" }); onChanged(); } catch (e) { toast.error(errorMessage(e, "Could not merge.")); }
  };
  const togglePause = async (d) => {
    const pause = !d.syncPaused;
    if (pause && !(await ask({ title: `Pause syncing with ${d.name || "the tablet"}?`, message: "The tablet stays linked but is treated as disconnected: no Wi-Fi scan results, no camera or messages, and WhatsApp place messages will not be sent. Resume any time.", confirmLabel: "Pause syncing" }))) return;
    try { await setHomeSyncPaused(d.id, pause); toast.success(pause ? "Syncing paused. The tablet picks this up within a couple of minutes." : "Syncing is back on."); onChanged(); } catch (e) { toast.error(errorMessage(e, "Could not change syncing.")); }
  };
  const make = async (e) => {
    e.preventDefault();
    try { setOld({ ...old, code: await makeHomePairCode(old.kind, old.name.trim()) }); }
    catch (err) { toast.error(errorMessage(err, "Could not make a code.")); }
  };
  return (
    <Section title="Link the home tablet or TV" subtitle="Install Stashr Hub on the always-on tablet, or Stashr TV on the TV (Apps page), then type this code and a name. No password is needed on them.">
      <div className="sh-editor">
        <b>Home-device code (Stashr Hub and Stashr TV)</b>
        <div className="sh-row"><code className="sh-code" aria-label="Home-device code">{code || "…"}</code><button className="rd-btn rd-btn--quiet" onClick={copy} disabled={!code}>Copy</button><button className="rd-btn rd-btn--quiet" onClick={renew}>New code</button></div>
        <p className="sh-dim">The same code every time, until you make a new one. A tablet or TV can see the home dashboard and your slideshow photos, so keep this code to yourself. It is not the code for family phones (that is under Family locations).</p>
      </div>
      <div className="sh-editor">
        <b>Linked now</b>
        {linked.length ? (
          <ul className="sh-people sh-linked">{linked.map((d) => {
            const others = linked.filter((x) => x.id !== d.id && x.kind === d.kind && !x.viaHub);
            const open = merging.id === d.id;
            return (
              <li key={d.id || d.name} className={d.online ? "is-home" : ""}>
                <span className="sh-avatar" aria-hidden="true">{d.kind === "tv" ? "TV" : d.kind === "phone" ? "PH" : "TB"}</span>
                <div className="sh-linked__info"><b>{d.name || "Unnamed"}</b><span>{KIND_LABEL[d.kind] || d.kind} · {d.syncPaused ? "syncing paused" : d.online ? "online" : "offline"}{d.lastSeen ? ` · seen ${ago(d.lastSeen)}` : ""}</span></div>
                <div className="sh-linked__actions">
                  {d.kind === "hub" && !d.viaHub ? <button type="button" className="rd-btn rd-btn--quiet" onClick={() => togglePause(d)}>{d.syncPaused ? "Resume syncing" : "Pause syncing"}</button> : null}
                  {!d.viaHub && others.length ? <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setMerging(open ? { id: "", into: "" } : { id: d.id, into: "" })}>{open ? "Cancel merge" : "Merge into…"}</button> : null}
                  {!d.viaHub ? <button type="button" className="rd-btn rd-btn--quiet" onClick={() => disconnect(d)}>Disconnect</button> : null}
                </div>
                {open ? (
                  <div className="sh-linked__merge">
                    <label>Keep this one (it keeps its name; "{d.name || "this device"}" is removed):
                      <select value={merging.into} onChange={(e) => setMerging({ id: d.id, into: e.target.value })}>
                        <option value="">Choose…</option>
                        {others.map((x) => <option key={x.id} value={x.id}>{x.name || "Unnamed"} ({x.online ? "online" : "offline"})</option>)}
                      </select>
                    </label>
                    <button type="button" className="rd-btn rd-btn--primary" disabled={!merging.into} onClick={() => merge(d)}>Merge</button>
                  </div>
                ) : null}
              </li>
            );
          })}</ul>
        ) : <p className="sh-dim">Nothing is linked yet. Type the code above on the tablet or TV.</p>}
      </div>
      <details className="sh-table"><summary>One-time code instead (15 minutes, works once)</summary>
        <form className="sh-row" onSubmit={make}>
          <select value={old.kind} onChange={(e) => setOld({ ...old, kind: e.target.value })} aria-label="What are you adding">
            <option value="hub">The home tablet</option>
            <option value="phone">A family phone running Stashr Hub (battery and storage only)</option>
          </select>
          <input value={old.name} onChange={(e) => setOld({ ...old, name: e.target.value })} placeholder="Name" maxLength={60} aria-label="Name" />
          <button className="rd-btn rd-btn--primary" type="submit">Make a code</button>
        </form>
        {old.code ? <div className="sh-token" role="status"><span>Type this in Stashr Hub:</span><code className="sh-code">{old.code.code}</code></div> : null}
      </details>
      {dialog}
    </Section>
  );
}

/* ───────── who is home ───────── */

export function PeopleCard({ people }) {
  return (
    <Section title="Who is home" subtitle="From the Wi-Fi: give a device a person in its Name / room, or pair that person's phone.">
      {people && people.length ? (
        <ul className="sh-people">{people.map((p) => (
          <li key={p.person} className={p.home ? "is-home" : ""}>
            <span className="sh-avatar" aria-hidden="true">{p.person.slice(0, 1).toUpperCase()}</span>
            <div><b>{p.person}</b><span>{p.home ? "Home" : p.stale ? "Location not updating" : "Out"}{p.by ? ` (${p.by === "wifi+gps" ? "Wi-Fi + location" : p.by === "gps" ? "location" : p.by === "last" ? "last known location, not updating" : "Wi-Fi"})` : ""}{!p.home && p.distanceKm !== undefined ? ` · ${p.distanceKm} km away` : ""}{p.fixAgeMin !== undefined ? ` · location ${p.fixAgeMin < 1 ? "just now" : p.fixAgeMin + " min ago"}` : p.lastSeen ? ` · seen ${ago(p.lastSeen)}` : ""} · {p.devices.join(", ")}</span></div>
          </li>
        ))}</ul>
      ) : <p className="sh-dim">Nobody is set up yet. Open a Wi-Fi device's Name / room and type whose it is.</p>}
    </Section>
  );
}

/* ───────── family phones ───────── */

const pct = (s) => (s && s.total ? Math.round(100 * (1 - s.free / s.total)) : null);

export function PhonesCard({ phones, onChanged }) {
  const confirm = useConfirm();
  if (!phones.length) return null;
  const rename = async (p) => {
    const who = window.prompt("Whose phone is this?", p.person || p.name);
    if (who === null) return;
    try { await setHomePhonePerson(p.id, who.trim()); onChanged(); } catch (e) { toast.error(errorMessage(e, "Could not save.")); }
  };
  const remove = async (p) => {
    if (!(await confirm.ask({ title: `Remove ${p.name}?`, message: "The phone stops reporting. Pair it again with a new code to bring it back.", confirmLabel: "Remove", danger: true }))) return;
    try { await removeHomeDevice(p.id); onChanged(); } catch (e) { toast.error(errorMessage(e, "Could not remove it.")); }
  };
  return (
    <Section title="Family phones" subtitle="Each phone with Stashr Hub reports its health about every 15 minutes, and when it joins the Wi-Fi.">
      {confirm.dialog}
      <ul className="sh-phones">{phones.map((p) => {
        const s = p.status || {}, used = pct(s.storage), bat = batteryOf(s);
        return (
          <li key={p.id}>
            <div className="sh-lan__main">
              <b>{p.name}{p.person && p.person !== p.name ? ` · ${p.person}` : ""}</b>
              <span>{s.agent === "stashr-where" ? "Stashr Location" : (s.model || "Phone")}{s.android ? ` · Android ${s.android}` : ""} · {p.online ? `reported ${ago(p.lastSeen)}` : `last report ${ago(p.lastSeen)}`}{s.wifi ? ` · on Wi-Fi (${s.ip || "?"})` : s.network ? ` · on ${s.network}` : ""}</span>
            </div>
            <div className="sh-chips">
              {bat ? <span className={bat.pct <= 15 && !bat.charging ? "is-bad" : ""}>🔋 {bat.pct}%{bat.charging ? " charging" : ""}{s.batteryTemp ? ` · ${s.batteryTemp}°C` : ""}</span> : null}
              {used != null ? <span className={used >= 90 ? "is-bad" : ""}>💾 {used}% full · {fmtBytes(s.storage.free)} free</span> : null}
              {s.ram && s.ram.total ? <span>RAM {Math.round(100 * (1 - s.ram.free / s.ram.total))}% used</span> : null}
              {s.batteryHealth ? <span>Battery health: {s.batteryHealth}</span> : null}
              {s.uptimeH != null ? <span>Up {s.uptimeH} h</span> : null}
            </div>
            <div className="sh-row">
              <button className="rd-btn rd-btn--quiet" onClick={() => rename(p)}>Person</button>
              <button className="rd-btn rd-btn--danger-quiet" onClick={() => remove(p)}>Remove</button>
            </div>
          </li>
        );
      })}</ul>
    </Section>
  );
}

/* ───────── alerts, briefs, time zone ───────── */

function Toggle({ checked, onChange, children }) {
  return <label className="sh-switch"><input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />{children}</label>;
}

export function AlertsCard({ home }) {
  const { settings: s, save } = home;
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (s) setCity(s.weather.city || ""); }, [s]);
  if (!s) return null;
  const a = s.alerts;
  const setA = (k, v) => save({ alerts: { [k]: v } });
  const test = async (which) => {
    setBusy(true);
    try { const r = await testHomeBrief(which); toast[r.sent ? "success" : "info"](r.sent ? "Sent to your Telegram." : "Connect Telegram in Settings to get it there. Here it is:\n" + r.text.replace(/<[^>]+>/g, "")); }
    catch (e) { toast.error(errorMessage(e, "Could not make it.")); } finally { setBusy(false); }
  };
  return (
    <Section title="Alerts and daily briefs" subtitle="Sent to your Telegram bot (connect it in Settings). Everything is also in “What happened”.">
      <div className="sh-grid2">
        <div className="sh-controls">
          <h4 className="sh-h">Tell me when</h4>
          <Toggle checked={a.everything !== false} onChange={(v) => setA("everything", v)}>Anything changes at home (every update goes to Telegram at once)</Toggle>
          <Toggle checked={a.newDevice} onChange={(v) => setA("newDevice", v)}>A new device joins the Wi-Fi</Toggle>
          <Toggle checked={a.night} onChange={(v) => setA("night", v)}>An unknown device joins at night</Toggle>
          <div className="sh-row sh-indent">
            <span className="sh-dim">Night is</span>
            <input type="time" value={a.nightFrom} onChange={(e) => setA("nightFrom", e.target.value)} aria-label="Night starts" />
            <span className="sh-dim">to</span>
            <input type="time" value={a.nightTo} onChange={(e) => setA("nightTo", e.target.value)} aria-label="Night ends" />
          </div>
          <Toggle checked={s.rain !== false} onChange={(v) => save({ rain: v }, v ? "People who leave home when rain is likely get a “take an umbrella” message." : "Umbrella reminders are off.")}>Remind someone to take an umbrella when they leave and rain is likely</Toggle>
          <Toggle checked={a.presence} onChange={(v) => setA("presence", v)}>Someone comes home or leaves</Toggle>
          <Toggle checked={a.emptyHomeTv} onChange={(v) => setA("emptyHomeTv", v)}>Nobody is home but the TV is on</Toggle>
          <Toggle checked={a.camera} onChange={(v) => setA("camera", v)}>The tablet camera sees someone (with the photo)</Toggle>
        </div>
        <div className="sh-controls">
          <h4 className="sh-h">Briefs</h4>
          <Toggle checked={s.brief.enabled} onChange={(v) => save({ brief: { enabled: v } })}>Morning brief: weather, who is home, TV, Wi-Fi, internet</Toggle>
          <div className="sh-row sh-indent">
            <span className="sh-dim">at</span>
            <input type="time" value={s.brief.time} onChange={(e) => save({ brief: { time: e.target.value } })} aria-label="Brief time" />
            <button className="rd-btn rd-btn--quiet" disabled={busy} onClick={() => test("brief")}>Send one now</button>
          </div>
          <Toggle checked={s.weekly.enabled} onChange={(v) => save({ weekly: { enabled: v } })}>Weekly report, Sundays at 20:00</Toggle>
          <div className="sh-row sh-indent"><button className="rd-btn rd-btn--quiet" disabled={busy} onClick={() => test("weekly")}>Send one now</button></div>
          <form className="sh-row" onSubmit={(e) => { e.preventDefault(); save({ weatherCity: city }, "Weather place saved."); }}>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Your city, for the weather" aria-label="City" maxLength={80} />
            <button className="rd-btn rd-btn--quiet" type="submit">Save</button>
          </form>
          <h4 className="sh-h">News on the TV</h4>
          <Toggle checked={s.news?.enabled !== false} onChange={(v) => save({ news: { enabled: v } })}>Morning headlines on the TV launcher</Toggle>
          <div className="sh-row sh-indent">
            <select value={s.news?.lang || "en"} onChange={(e) => save({ news: { lang: e.target.value } })} aria-label="News language">
              <option value="en">English</option><option value="hi">हिन्दी</option><option value="both">English and Hindi</option>
            </select>
            <select value={s.news?.count || 6} onChange={(e) => save({ news: { count: Number(e.target.value) } })} aria-label="How many headlines">
              {[3, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} headlines</option>)}
            </select>
          </div>
          <p className="sh-dim">Headlines come from the public Google News (India) feed. The first time the TV shows its home screen each morning, it shows the weather and the top headlines for half a minute.</p>
          <p className="sh-dim">Times are in {s.timezone}.</p>
        </div>
      </div>
    </Section>
  );
}

/* ───────── TV time and the daily limit ───────── */

export function TvTimeCard({ home }) {
  const { settings: s, save } = home;
  const [data, setData] = useState(null);
  const [mins, setMins] = useState("");
  const load = useCallback(async () => { try { setData(await getHomeUsage(14)); } catch { /* hidden */ } }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 60000);
  useEffect(() => { if (s) setMins(String(s.tvLimit.minutes || "")); }, [s]);
  if (!data || !s) return null;
  const today = data.days[data.days.length - 1];
  const week = data.days.slice(-7).reduce((a, d) => a + d.minutes, 0);
  return (
    <Section title="TV time and daily limit" subtitle={`Today ${fmtMinutes(today.minutes)} · this week ${fmtMinutes(week)} (${fmtMinutes(week / 7)} a day)`}>
      <TvTimeChart days={data.days} limit={s.tvLimit.minutes} />
      <form className="sh-row" onSubmit={(e) => { e.preventDefault(); save({ tvLimit: { minutes: Number(mins) || 0 } }, Number(mins) ? "Daily TV limit saved." : "No TV limit."); }}>
        <span className="sh-dim">Daily limit</span>
        <input type="number" min="0" max="1440" step="15" value={mins} onChange={(e) => setMins(e.target.value)} placeholder="minutes, 0 = none" aria-label="Daily TV limit in minutes" style={{ width: "9rem" }} />
        <select value={s.tvLimit.action} onChange={(e) => save({ tvLimit: { action: e.target.value } })} aria-label="When the limit is reached">
          <option value="home">then pause and go to the home screen</option>
          <option value="pause">then pause</option>
          <option value="notify">just tell me</option>
        </select>
        <button className="rd-btn rd-btn--primary" type="submit">Save</button>
      </form>
      <Toggle checked={s.tvLimit.lateNight} onChange={(v) => save({ tvLimit: { lateNight: v } })}>Tell me when the TV is still on between 1 and 5 at night</Toggle>
      <p className="sh-dim">The TV app cannot switch the TV off by itself yet, so the limit pauses it and sends it home, again every 15 minutes, and tells you.</p>
    </Section>
  );
}

/* ───────── scenes and schedules ───────── */

function StepPicker({ steps, setSteps }) {
  const [pick, setPick] = useState("0");
  return (
    <div className="sh-steps">
      <ol>{steps.map((st, i) => <li key={i}>{stepLabel(st)} <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label="Remove step">✕</button></li>)}</ol>
      <div className="sh-row">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add a step">{STEP_CHOICES.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}</select>
        <button type="button" className="rd-btn rd-btn--quiet" disabled={steps.length >= 10} onClick={() => setSteps([...steps, STEP_CHOICES[Number(pick)].step])}>Add step</button>
      </div>
    </div>
  );
}

export function ScenesCard({ home }) {
  const { settings: s, setSettings } = home;
  const [draft, setDraft] = useState(null);
  if (!s) return null;
  const run = async (sc) => { try { const r = await runHomeScene(sc.id); toast.success(r.sent ? `${sc.name}: sent ${r.sent} command${r.sent > 1 ? "s" : ""}.` : `${sc.name}: no device is ready for it.`); } catch (e) { toast.error(errorMessage(e, "Could not run it.")); } };
  const store = async (scenes) => {
    try { const r = await saveHomeScenes(scenes); setSettings({ ...s, scenes: r.scenes }); setDraft(null); toast.success("Scenes saved."); }
    catch (e) { toast.error(errorMessage(e, "Could not save.")); }
  };
  return (
    <Section title="Scenes" subtitle="One tap (or say its name to Ask Stashr or the tablet) runs several commands.">
      <div className="sh-row">{s.scenes.map((sc) => <button key={sc.id} className="rd-btn rd-btn--primary" onClick={() => run(sc)} title={sc.steps.map(stepLabel).join(" → ")}>{sc.name}</button>)}</div>
      {draft ? (
        <form className="sh-editor" onSubmit={(e) => { e.preventDefault(); store(draft.index === -1 ? [...s.scenes, draft.scene] : s.scenes.map((x, i) => (i === draft.index ? draft.scene : x))); }}>
          <input value={draft.scene.name} onChange={(e) => setDraft({ ...draft, scene: { ...draft.scene, name: e.target.value } })} placeholder="Scene name, e.g. Movie night" maxLength={40} aria-label="Scene name" />
          <StepPicker steps={draft.scene.steps} setSteps={(steps) => setDraft({ ...draft, scene: { ...draft.scene, steps } })} />
          <div className="sh-row">
            <button className="rd-btn rd-btn--primary" type="submit" disabled={!draft.scene.name.trim() || !draft.scene.steps.length}>Save scene</button>
            {draft.index >= 0 ? <button type="button" className="rd-btn rd-btn--danger-quiet" onClick={() => store(s.scenes.filter((_, i) => i !== draft.index))}>Delete</button> : null}
            <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="sh-row">
          <select defaultValue="" onChange={(e) => { const i = Number(e.target.value); if (e.target.value !== "") setDraft({ index: i, scene: JSON.parse(JSON.stringify(s.scenes[i])) }); e.target.value = ""; }} aria-label="Edit a scene">
            <option value="">Edit a scene…</option>{s.scenes.map((sc, i) => <option key={sc.id} value={i}>{sc.name}</option>)}
          </select>
          <button className="rd-btn rd-btn--quiet" disabled={s.scenes.length >= 12} onClick={() => setDraft({ index: -1, scene: { name: "", steps: [] } })}>New scene</button>
        </div>
      )}
    </Section>
  );
}

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SchedulesCard({ home }) {
  const { settings: s, setSettings } = home;
  const [draft, setDraft] = useState(null);
  if (!s) return null;
  const store = async (schedules) => {
    try { const r = await saveHomeSchedules(schedules); setSettings({ ...s, schedules: r.schedules }); setDraft(null); toast.success("Schedules saved."); }
    catch (e) { toast.error(errorMessage(e, "Could not save.")); }
  };
  const blank = { name: "", time: "23:00", days: [], steps: [STEP_CHOICES[0].step, STEP_CHOICES[1].step], enabled: true };
  return (
    <Section title="Schedules" subtitle={`Commands at a time of day, in ${s.timezone}. E.g. 23:00 pause the TV, 07:30 open the news.`}>
      {s.schedules.length ? (
        <ul className="sh-lan">{s.schedules.map((sc, i) => (
          <li key={sc.id}>
            <div className="sh-lan__main"><b>{sc.time} · {sc.name}</b><span>{daysLabel(sc.days)} · {sc.steps.map(stepLabel).join(" → ")}</span></div>
            <label className="sh-switch"><input type="checkbox" checked={sc.enabled !== false} onChange={(e) => store(s.schedules.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />On</label>
            <button className="rd-btn rd-btn--quiet" onClick={() => setDraft({ index: i, sc: JSON.parse(JSON.stringify(sc)) })}>Edit</button>
          </li>
        ))}</ul>
      ) : <p className="sh-dim">No schedules yet.</p>}
      {draft ? (
        <form className="sh-editor" onSubmit={(e) => { e.preventDefault(); store(draft.index === -1 ? [...s.schedules, draft.sc] : s.schedules.map((x, i) => (i === draft.index ? draft.sc : x))); }}>
          <div className="sh-row">
            <input type="time" value={draft.sc.time} onChange={(e) => setDraft({ ...draft, sc: { ...draft.sc, time: e.target.value } })} aria-label="Time" required />
            <input value={draft.sc.name} onChange={(e) => setDraft({ ...draft, sc: { ...draft.sc, name: e.target.value } })} placeholder="Name, e.g. Bedtime" maxLength={60} aria-label="Schedule name" />
          </div>
          <div className="sh-row sh-days" role="group" aria-label="Days">
            {WEEK.map((d, i) => <label key={d} className={draft.sc.days.includes(i) ? "is-on" : ""}><input type="checkbox" checked={draft.sc.days.includes(i)} onChange={(e) => setDraft({ ...draft, sc: { ...draft.sc, days: e.target.checked ? [...draft.sc.days, i] : draft.sc.days.filter((x) => x !== i) } })} />{d}</label>)}
            <span className="sh-dim">{daysLabel(draft.sc.days)}</span>
          </div>
          <StepPicker steps={draft.sc.steps} setSteps={(steps) => setDraft({ ...draft, sc: { ...draft.sc, steps } })} />
          <div className="sh-row">
            <button className="rd-btn rd-btn--primary" type="submit" disabled={!draft.sc.steps.length}>Save schedule</button>
            {draft.index >= 0 ? <button type="button" className="rd-btn rd-btn--danger-quiet" onClick={() => store(s.schedules.filter((_, i) => i !== draft.index))}>Delete</button> : null}
            <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : <div className="sh-row"><button className="rd-btn rd-btn--quiet" disabled={s.schedules.length >= 20} onClick={() => setDraft({ index: -1, sc: blank })}>New schedule</button></div>}
    </Section>
  );
}

/* ───────── home location + arrival time ───────── */

function HomeSpotBlock({ home }) {
  const { settings: s, save } = home;
  const spot = s.homeSpot, eta = s.eta || {};
  const [lat, setLat] = useState(spot ? String(spot.lat) : "");
  const [lon, setLon] = useState(spot ? String(spot.lon) : "");
  const [busy, setBusy] = useState(false);
  const here = () => {
    if (!navigator.geolocation) { toast.error("This browser cannot give your location."); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(String(Number(pos.coords.latitude.toFixed(6)))); setLon(String(Number(pos.coords.longitude.toFixed(6)))); setBusy(false); },
      () => { toast.error("Could not get this device’s location. Allow it, or type the numbers."); setBusy(false); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };
  return (
    <div className="sh-editor">
      <b>Home location · arrival time</b>
      <p className="sh-dim">With a home location, the tablet and this page show “Papa 10 minute mein aa rahe hain” for family phones that share their location and are heading home. With “real roads” on, Stashr asks the free OpenStreetMap routing service (OSRM) for the driving time and sends it only two points: the phone’s position and your home. With a Mapbox token set on the server it is the driving time for right now including live traffic; without one it is the normal driving time. Off, or if the service does not answer, it falls back to a straight-line estimate, good to a few minutes.</p>
      <MapPicker lat={Number(lat) || null} lon={Number(lon) || null} radius={spot?.radius || 200} onPick={(p) => { setLat(String(p.lat)); setLon(String(p.lon)); }} />
      <div className="sh-row">
        <input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Home latitude" aria-label="Home latitude" />
        <input type="number" step="any" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="Home longitude" aria-label="Home longitude" />
        <button type="button" className="rd-btn rd-btn--quiet" onClick={here} disabled={busy}>{busy ? "Locating…" : "Use this device’s location"}</button>
        <button type="button" className="rd-btn rd-btn--primary" disabled={!lat || !lon} onClick={() => save({ homeSpot: { lat, lon, radius: spot?.radius || 200 } }, "Home location saved.")}>Save home</button>
        <input value="" onChange={(e) => { const p = parseCoords(e.target.value); if (p) { setLat(String(p.lat)); setLon(String(p.lon)); } }} placeholder="…or paste coordinates / Google Maps link" aria-label="Paste coordinates or a map link" onPaste={(e) => { const p = parseCoords(e.clipboardData.getData("text")); if (p) { e.preventDefault(); setLat(String(p.lat)); setLon(String(p.lon)); } }} />
      </div>
      <div className="sh-row">
        <label className="sh-switch"><input type="checkbox" checked={eta.enabled !== false} onChange={(e) => save({ eta: { enabled: e.target.checked } })} />Show who is on the way home</label>
        <label className="sh-switch"><input type="checkbox" checked={eta.routing !== false} onChange={(e) => save({ eta: { routing: e.target.checked } }, e.target.checked ? "Arrival times now follow real roads." : "Arrival times use the straight line.")} />Use real roads for the arrival time</label>
        <label className="sh-dim">Tell me when within <input type="number" min="1" max="120" value={eta.notifyMinutes || 15} onChange={(e) => save({ eta: { notifyMinutes: Number(e.target.value) } })} style={{ width: 64 }} aria-label="Minutes" /> min (Telegram)</label>
      </div>
    </div>
  );
}

/* ───────── places: arrive / leave messages on WhatsApp ───────── */

export function PlacesCard({ home, phones, hasSmartHub }) {
  const { settings: s, setSettings } = home;
  const [draft, setDraft] = useState(null);
  const [locating, setLocating] = useState(false);
  if (!s) return null;
  const places = s.places || [];
  const store = async (list) => {
    try { const r = await saveHomePlaces(list); setSettings({ ...s, places: r.places }); setDraft(null); toast.success("Places saved."); }
    catch (e) { toast.error(errorMessage(e, "Could not save.")); }
  };
  const blank = { name: "Office", lat: "", lon: "", radius: 150, phone: phones[0]?.id || "", group: "", arriveText: "Reached office", leaveText: "Leaving office", arriveFrom: "", arriveTo: "", leaveFrom: "", leaveTo: "", strictWindow: false, enabled: true, tgLeave: true, tgArrive: true };
  const set = (patch) => setDraft({ ...draft, p: { ...draft.p, ...patch } });
  const here = () => {
    if (!navigator.geolocation) { toast.error("This browser cannot give your location."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { set({ lat: Number(pos.coords.latitude.toFixed(6)), lon: Number(pos.coords.longitude.toFixed(6)) }); setLocating(false); },
      () => { toast.error("Could not get this device's location. Allow it, or type the numbers."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };
  const phoneFix = () => {
    const l = phones.find((p) => p.id === draft.p.phone)?.status?.location;
    if (!l || !Number.isFinite(Number(l.lat))) { toast.error("This phone has not sent a location yet."); return; }
    set({ lat: Number(Number(l.lat).toFixed(6)), lon: Number(Number(l.lon).toFixed(6)) });
    toast.success("Set to where this phone is right now. Check the circle, then save.");
  };
  const test = async (pl) => {
    try { await testHomePlace(pl.id, pl.arriveText); toast.success("Sent to the tablet: WhatsApp should open and send."); }
    catch (e) { toast.error(errorMessage(e, "Could not send.")); }
  };
  const phoneName = (id) => phones.find((p) => p.id === id)?.name || "phone";
  return (
    <Section title="Places: work, school and more" subtitle="Pick a person's phone and a place (their office, school…). Stashr can tell you on Telegram when they leave or reach it, and the tablet can also send a WhatsApp message to a group. You can ask Telegram “Papa office se nikle ya nahi?” any time.">
      <HomeSpotBlock home={home} />
      {!phones.length ? <p className="sh-dim">Link a family phone first (Family locations card on the Devices tab).</p> : null}
      {!hasSmartHub ? <p className="sh-dim">The tablet needs Stashr Hub, with its Accessibility switch on (the WhatsApp card on the tablet’s dashboard).</p> : null}
      {places.length ? (
        <ul className="sh-lan">{places.map((pl, i) => (
          <li key={pl.id}>
            <div className="sh-lan__main"><b>{pl.name} · {phoneName(pl.phone)}</b><span>{pl.tgLeave || pl.tgArrive ? `Telegram: ${pl.tgLeave && pl.tgArrive ? "leave + arrive" : pl.tgLeave ? "leave" : "arrive"} · ` : ""}{pl.group || "no WhatsApp group"} · “{pl.arriveText || "—"}” on arrive{pl.arriveFrom ? ` ${pl.arriveFrom}–${pl.arriveTo}` : ""} · “{pl.leaveText || "—"}” on leave{pl.leaveFrom ? ` ${pl.leaveFrom}–${pl.leaveTo}` : ""} · {pl.radius} m · now {pl.state === "in" ? "there" : pl.state === "out" ? "away" : "unknown"} · {pl.strictWindow ? "only inside these times" : "times are a guide"}</span></div>
            <label className="sh-switch"><input type="checkbox" checked={pl.enabled !== false} onChange={(e) => store(places.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />On</label>
            <button className="rd-btn rd-btn--quiet" onClick={() => test(pl)} disabled={!pl.group}>Send test</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => setDraft({ index: i, p: { ...pl } })}>Edit</button>
            <div className="pl-trail"><PlaceTrail place={pl} /></div>
          </li>
        ))}</ul>
      ) : <p className="sh-dim">No places yet.</p>}
      {draft ? (
        <form className="sh-editor" onSubmit={(e) => { e.preventDefault(); store(draft.index === -1 ? [...places, draft.p] : places.map((x, i) => (i === draft.index ? draft.p : x))); }}>
          <div className="sh-row">
            <input value={draft.p.name} onChange={(e) => set({ name: e.target.value })} placeholder="Place, e.g. Office" maxLength={40} aria-label="Place name" required />
            <select value={draft.p.phone} onChange={(e) => set({ phone: e.target.value })} aria-label="Whose phone">{phones.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </div>
          <div className="sh-row">
            <input type="number" step="any" value={draft.p.lat} onChange={(e) => set({ lat: e.target.value })} placeholder="Latitude" aria-label="Latitude" required />
            <input type="number" step="any" value={draft.p.lon} onChange={(e) => set({ lon: e.target.value })} placeholder="Longitude" aria-label="Longitude" required />
            <button type="button" className="rd-btn rd-btn--quiet" onClick={phoneFix}>Use this phone’s location now</button>
            <button type="button" className="rd-btn rd-btn--quiet" onClick={here} disabled={locating}>{locating ? "Locating…" : "Use this device’s location"}</button>
          </div>
          <label className="sh-dim">Circle radius: {draft.p.radius} m<input type="range" min="50" max="1000" step="10" value={draft.p.radius} onChange={(e) => set({ radius: Number(e.target.value) })} aria-label="Radius in metres" /></label>
          <div className="sh-row">
            <label className="sh-switch"><input type="checkbox" checked={draft.p.tgLeave === true} onChange={(e) => set({ tgLeave: e.target.checked })} />Telegram: tell me when they leave</label>
            <label className="sh-switch"><input type="checkbox" checked={draft.p.tgArrive === true} onChange={(e) => set({ tgArrive: e.target.checked })} />Telegram: tell me when they reach</label>
          </div>
          <input value={draft.p.group} onChange={(e) => set({ group: e.target.value })} placeholder={draft.p.tgLeave || draft.p.tgArrive ? "WhatsApp group name (optional: only if the tablet should also send a message)" : "WhatsApp group name, exactly as in WhatsApp"} maxLength={80} aria-label="WhatsApp group" required={!draft.p.tgLeave && !draft.p.tgArrive} />
          <div className="sh-row"><input value={draft.p.arriveText} onChange={(e) => set({ arriveText: e.target.value })} placeholder="Message on arriving" maxLength={500} aria-label="Arrive message" />
            <span className="sh-dim">around</span><input type="time" value={draft.p.arriveFrom} onChange={(e) => set({ arriveFrom: e.target.value })} aria-label="Arrive from" /><input type="time" value={draft.p.arriveTo} onChange={(e) => set({ arriveTo: e.target.value })} aria-label="Arrive to" /></div>
          <div className="sh-row"><input value={draft.p.leaveText} onChange={(e) => set({ leaveText: e.target.value })} placeholder="Message on leaving" maxLength={500} aria-label="Leave message" />
            <span className="sh-dim">around</span><input type="time" value={draft.p.leaveFrom} onChange={(e) => set({ leaveFrom: e.target.value })} aria-label="Leave from" /><input type="time" value={draft.p.leaveTo} onChange={(e) => set({ leaveTo: e.target.value })} aria-label="Leave to" /></div>
          <label className="sh-switch"><input type="checkbox" checked={draft.p.strictWindow === true} onChange={(e) => set({ strictWindow: e.target.checked })} />Send only inside these times</label>
          <p className="sh-dim">The times are a guide: around them the phone looks closer (a real position every 3 minutes). The message goes whenever the phone leaves or reaches the circle, also before or after them, unless you tick the box above. Leave a message empty to send nothing for that event.</p>
          <div className="sh-row">
            <button className="rd-btn rd-btn--primary" type="submit">Save place</button>
            {draft.index >= 0 ? <button type="button" className="rd-btn rd-btn--danger-quiet" onClick={() => store(places.filter((_, i) => i !== draft.index))}>Delete</button> : null}
            <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : <div className="sh-row"><button className="rd-btn rd-btn--quiet" disabled={!phones.length || places.length >= 10} onClick={() => setDraft({ index: -1, p: blank })}>New place</button></div>}
    </Section>
  );
}

/* ───────── where the phone of a place is now, and the last 24 hours ───────── */

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const beyondText = (m) => (m > 0 ? `${m} m outside the circle` : `${-m} m inside the circle`);
const STATE_TEXT = { in: "counts as there", between: "just outside the circle, not yet counted as left", out: "counts as left" };

/** One place: the phone's position now, how far past the edge of the circle, the map, the whole day, and what Stashr decided. */
function PlaceTrail({ place }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await getHomePlaceTrail(place.id)); setError(""); } catch (e) { setError(errorMessage(e, "Could not load the position.")); }
  }, [place.id]);
  useEffect(() => { if (open) load(); }, [open, load]);
  usePolling(load, 30000, open);
  const n = data && data.now;
  const day = data && data.summary;
  return (
    <div className="pl">
      <button type="button" className="rd-btn rd-btn--quiet" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Where is the phone? Today’s positions"}</button>
      {open ? (
        <div className="pl__body">
          {error ? <p className="mn-bad" role="alert">{error}</p> : null}
          {!data && !error ? <p className="sh-dim">Loading…</p> : null}
          {data && !data.phone ? <p className="sh-bad">No phone is linked to this place any more. Edit the place and pick one.</p> : null}
          {data && data.phone && !n ? <p className="sh-dim">{data.phone.name}’s phone has not sent a position yet.</p> : null}
          {n ? (
            <>
              <p className="pl-status"><b>{data.phone.name}: {beyondText(n.beyondM)}</b>
                <span> · {n.distanceM} m from the centre of {data.place.name} · ±{n.acc} m · {STATE_TEXT[n.state]}</span>
                <span> · position from {n.ageSec < 90 ? "a moment" : ago(n.at)} ago{data.phone.battery != null ? ` · battery ${data.phone.battery}%` : ""}</span></p>
              {n.ageSec > 900 ? <p className="sh-warn">The last position is {ago(n.at)} old. {data.checkInEverySec ? `This phone has been reporting about every ${Math.max(1, Math.round(data.checkInEverySec / 60))} min. ` : ""}Close to a place, the updated Stashr Location app asks for a real position every 3 to 5 minutes; an older app, or a phone with location switched off or the app stopped, reports much less often, and then leaving is noticed late.</p> : null}
              <p className="sh-dim">The circle is {data.rule.radius} m. It counts as <b>left</b> from {data.rule.outBeyondM} m from the centre (the circle plus a margin of at least {data.rule.minMarginM} m, more when the phone’s own position is poor), confirmed by a second position unless the phone is far away. {data.rule.strictWindow ? `The message is sent only inside ${[data.rule.arrive && `arrive ${data.rule.arrive}`, data.rule.leave && `leave ${data.rule.leave}`].filter(Boolean).join(" and ") || "the times you set"}.` : "The message is sent whenever this happens, also outside the times you set."}</p>
              {day && day.farthest ? <p className="sh-dim">Today: {day.points} position{day.points === 1 ? "" : "s"}; farthest {day.farthest.distanceM} m from the centre ({beyondText(day.farthest.beyondM)}) at {clock(day.farthest.at)}{day.lastInside ? `; last inside the circle at ${clock(day.lastInside)}` : ""}.</p> : null}
            </>
          ) : null}
          {data ? <PlaceMap place={data.place} now={n} trail={data.trail} outBeyondM={data.rule.outBeyondM} /> : null}
          {data ? <p className="sh-dim">Blue circle: the place ({data.rule.radius} m). Orange dashed ring: where it counts as left ({data.rule.outBeyondM} m). Dots: the last 24 hours (green inside, orange in between, red left). The small orange circle around “Now” is how accurate the position is.</p> : null}
          {data ? <PlaceTrailChart points={data.trail} radius={data.rule.radius} outBeyondM={data.rule.outBeyondM} /> : null}
          {data && data.events.length ? (
            <>
              <h4 className="sh-sub">What Stashr decided (last 24 hours)</h4>
              <ul className="sh-events">{data.events.slice(0, 12).map((e) => <li key={e.at + e.kind}><b>{clock(e.at)}</b> {e.text}</li>)}</ul>
            </>
          ) : data ? <p className="sh-dim">No crossing of the circle in the last 24 hours.</p> : null}
          {data && data.trail.length ? (
            <details className="sh-table">
              <summary>All positions of the last 24 hours with coordinates ({data.trail.length})</summary>
              <table className="pl-table">
                <thead><tr><th>Time</th><th>Latitude, longitude</th><th>From centre</th><th>Circle</th><th>±</th></tr></thead>
                <tbody>{[...data.trail].reverse().slice(0, 120).map((p) => (
                  <tr key={p.at} className={`is-${p.state}`}>
                    <td>{clock(p.at)}{p.same ? " (check-in)" : ""}</td>
                    <td>{p.lat.toFixed(6)}, {p.lon.toFixed(6)}</td>
                    <td>{p.distanceM} m</td>
                    <td>{beyondText(p.beyondM)}</td>
                    <td>{p.acc} m</td>
                  </tr>
                ))}</tbody>
              </table>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ───────── internet speed ───────── */

export function SpeedCard({ hasSmartHub, send, hubId }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const load = useCallback(async () => { try { setData(await getHomeSpeed(days)); } catch { /* hidden */ } }, [days]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 120000);
  if (!hasSmartHub && !(data && data.samples.length)) return null;
  const avg = data && data.samples.length ? Math.round(data.samples.reduce((a, x) => a + x.down, 0) / data.samples.length) : null;
  return (
    <Section title="Internet speed" subtitle={avg != null ? `Average ${avg} Mbit/s down over ${days} days. Useful proof when the connection is slow.` : "The tablet tests the internet every hour."}
      actions={<div className="sh-row">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period"><option value={1}>Today</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select>
        {hubId ? <button className="rd-btn rd-btn--quiet" onClick={() => send(hubId, "speed_test", {}, "Speed test started. The result shows up in a minute.")}>Test now</button> : null}
      </div>}>
      {data ? <SpeedChart samples={data.samples} /> : null}
    </Section>
  );
}

/* ───────── the tablet camera ───────── */

function MediaThumb({ item, onDelete }) {
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true, made = "";
    getHomeMediaBlob(item.id).then((b) => { if (alive) { made = URL.createObjectURL(b); setUrl(made); } }).catch(() => {});
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [item.id]);
  return (
    <li>
      <button className="sh-thumb" onClick={() => setOpen(!open)} aria-label={`Open ${item.kind} from ${ago(item.at)}`}>
        {url ? (item.kind === "video" ? <video src={url} muted playsInline preload="metadata" /> : <img src={url} alt="" />) : <span className="sh-dim">…</span>}
        <span className="sh-thumb__tag">{item.kind === "video" ? "▶ " : ""}{item.reason === "motion" ? "Movement" : item.kind === "video" ? "Clip" : "Photo"} · {ago(item.at)}</span>
      </button>
      {open && url ? (
        <div className="sh-viewer">
          {item.kind === "video" ? <video src={url} controls autoPlay playsInline /> : <img src={url} alt={`Camera photo from ${ago(item.at)}`} />}
          <div className="sh-row"><a className="rd-btn rd-btn--quiet" href={url} download={`stashr-${item.kind}-${item.id}.${item.kind === "video" ? "mp4" : "jpg"}`}>Download</a><button className="rd-btn rd-btn--danger-quiet" onClick={() => onDelete(item)}>Delete</button><button className="rd-btn rd-btn--quiet" onClick={() => setOpen(false)}>Close</button></div>
        </div>
      ) : null}
    </li>
  );
}

/** The live view: asks the tablet for 2 minutes of frames and shows the newest one about every 1.5 s. */
function LiveView({ hub, send, onClose }) {
  const [url, setUrl] = useState("");
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    let alive = true, last = "", timer = null, ask = null;
    const start = () => send(hub.id, "camera", { action: "live" }, "Live view starting… the first picture takes a few seconds.");
    start();
    ask = window.setInterval(start, 110 * 1000); // keep it going while the page is open
    const tick = async () => {
      try {
        const b = await getHomeLiveFrame();
        if (alive && b) { const u = URL.createObjectURL(b); setUrl(u); setWaiting(false); if (last) URL.revokeObjectURL(last); last = u; }
      } catch { /* try again */ }
      if (alive) timer = window.setTimeout(tick, 1500);
    };
    tick();
    return () => { alive = false; window.clearTimeout(timer); window.clearInterval(ask); if (last) URL.revokeObjectURL(last); };
  }, [hub.id, send]);
  return (
    <div className="sh-live">
      {url ? <img src={url} alt="Live view from the tablet camera" /> : <div className="sh-live__wait">{waiting ? "Connecting to the tablet camera…" : "No picture"}</div>}
      <div className="sh-row"><span className="sh-live__badge">● LIVE</span><span className="sh-dim">About one picture every 1–2 seconds. Stops 2 minutes after you close it.</span><button className="rd-btn rd-btn--quiet" onClick={onClose}>Close live view</button></div>
    </div>
  );
}

export function CameraCard({ hub, send, home }) {
  const [list, setList] = useState(null);
  const [live, setLive] = useState(false);
  const load = useCallback(async () => { try { setList((await getHomeMedia()).media); } catch { /* hidden */ } }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 30000);
  const { settings: s, save } = home;
  if (!hub && !(list && list.length)) return null;
  const cam = (hub && hub.status && hub.status.camera) || {};
  const remove = async (item) => { try { await deleteHomeMedia(item.id); load(); } catch (e) { toast.error(errorMessage(e, "Could not delete.")); } };
  return (
    <Section title="Security camera" subtitle={hub ? `${hub.name} · ${cam.armed ? "🔴 guarding: records and alerts on movement" : "off: the camera is closed"}${cam.lastMotion ? ` · last movement ${ago(cam.lastMotion)}` : ""}` : "Photos and clips from the tablet"}
      actions={hub ? (cam.armed
        ? <button className="rd-btn rd-btn--danger-quiet" onClick={() => send(hub.id, "camera", { action: "disarm" }, "Security camera stopped.")}>Stop security camera</button>
        : <button className="rd-btn rd-btn--primary" onClick={() => send(hub.id, "camera", { action: "arm" }, "Security camera started. You get a photo and a clip on Telegram when someone moves in view.")}>Start security camera</button>) : null}>
      {hub ? (
        <>
          {cam.error ? <p className="sh-bad" role="alert">The tablet camera has a problem: {cam.error}. Live view and photos will not work until it is fixed on the tablet (Hub → Health check).</p> : null}
          <p className="sh-dim">While it is on, the tablet watches its camera. When someone moves in view it sends a photo at once, then records while the movement lasts (up to a minute) and sends the clip. Everything is kept here for 14 days. The camera stays closed while it is off.</p>
          <div className="sh-row">
            <button className="rd-btn rd-btn--quiet" onClick={() => setLive(!live)} aria-pressed={live}>{live ? "Hide live view" : "👁 Live view"}</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => send(hub.id, "camera", { action: "snapshot" }, "Taking a photo…")}>Take a photo</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => send(hub.id, "camera", { action: "clip" }, "Recording 10 seconds…")}>Record a clip</button>
            {s ? <>
              <span className="sh-dim">Sensitivity</span>
              <input type="range" min="1" max="10" value={s.camera.sensitivity} onChange={(e) => save({ camera: { sensitivity: Number(e.target.value) } }, "Sensitivity saved.")} aria-label="Camera sensitivity" />
              <label className="sh-switch"><input type="checkbox" checked={s.camera.video} onChange={(e) => save({ camera: { video: e.target.checked } })} />Record clips on movement</label>
              <label className="sh-switch"><input type="checkbox" checked={Boolean(s.camera.auto)} onChange={(e) => save({ camera: { auto: e.target.checked } }, e.target.checked ? "The camera will turn on when everyone is out and off when someone is back." : "Automatic camera is off.")} />Turn on by itself when everyone is out, off when someone is home</label>
            </> : null}
          </div>
          {live ? <LiveView hub={hub} send={send} onClose={() => setLive(false)} /> : null}
        </>
      ) : null}
      {cam.error ? <p className="sh-bad">{cam.error}</p> : null}
      {list && list.length ? <ul className="sh-gallery">{list.map((m) => <MediaThumb key={m.id} item={m} onDelete={remove} />)}</ul> : <p className="sh-dim">No recordings yet.</p>}
      {s ? <p className="sh-dim">Tip: add “Tablet: security camera on” to a schedule (e.g. 23:00) or to an “Away” scene to start guarding automatically.</p> : null}
    </Section>
  );
}

/* ───────── slideshow ───────── */

export function SlideshowCard({ home, hub, send }) {
  const { settings: s, save } = home;
  const [folder, setFolder] = useState("");
  useEffect(() => { if (s) setFolder(s.slideshowFolder ? "https://drive.google.com/drive/folders/" + s.slideshowFolder : ""); }, [s]);
  if (!s || !hub) return null;
  return (
    <Section title="Photo frame (tablet slideshow)" subtitle="Photos from a Google Drive folder, through the Google account connected in Photo Cloud.">
      <form className="sh-row" onSubmit={(e) => { e.preventDefault(); save({ slideshowFolder: folder }, "Slideshow folder saved."); }}>
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Paste the Drive folder link" aria-label="Slideshow folder" style={{ flex: "1 1 18rem" }} />
        <button className="rd-btn rd-btn--quiet" type="submit">Save</button>
        <button type="button" className="rd-btn rd-btn--primary" disabled={!s.slideshowFolder} onClick={() => send(hub.id, "slideshow", { action: "start" }, "Slideshow starting on the tablet.")}>Start on the tablet</button>
      </form>
      <p className="sh-dim">The tablet also starts the slideshow by itself after 10 idle minutes on its dashboard, when a folder is set. Leave the folder empty to keep the photo frame off.</p>
      <p className="sh-dim">Only a Google Drive folder works. Google no longer lets apps read a whole Google Photos library, so photos that live only in Google Photos can’t be shown here: copy the ones you want into a Drive folder (Google Photos → select → Save to Drive), or use the photos backed up by the Stashr app.</p>
    </Section>
  );
}


/* ───────── a copy of the tablet's home screen ───────── */

export function HomeScreenCard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => { try { setD(await getHomeDashboard()); setErr(""); } catch (e) { setErr(errorMessage(e, "Could not load.")); } }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 20000);
  if (!d) return err ? <p className="sh-bad" role="alert">{err}</p> : null;
  const w = d.weather;
  const comingText = (c) => (c.minutes <= 1 ? `${c.person} bas pahunchne wale hain` : `${c.person} ${c.minutes} minute mein aa rahe hain`);
  return (
    <Section title="Home screen" subtitle="The same things the tablet shows, live.">
      {(d.coming || []).map((c) => <p key={c.person} className="sh-ok" role="status">🚗 <b>{comingText(c)}</b> <span className="sh-dim">· {c.km} km door</span></p>)}
      <p><b>{new Date(d.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b> · {w ? `${String(w.city || "").split(",")[0]} ${w.temp}°C · ${w.text} · ${w.min}–${w.max}°C${w.rainChance != null ? ` · ${w.rainChance}% rain` : ""}` : <span className="sh-dim">Set your city under Alerts and daily briefs to see the weather.</span>}</p>
      <div className="sh-row" role="list" aria-label="Who is home">
        {d.people.length ? d.people.map((p) => <span key={p.person} role="listitem" className={"sh-chip" + (p.home ? " is-on" : "")}>{p.home ? "● " : "○ "}{p.person} · {p.home ? "home" : "out"}</span>) : <span className="sh-dim">Give a Wi-Fi device a person, or pair a family phone.</span>}
      </div>
      <ul className="sh-lan">
        {d.tvs.map((t) => <li key={t.name}><div className="sh-lan__main"><b>📺 {t.name}</b><span>{!t.online ? "off or not connected" : t.screen === "off" ? "standby" : `on${t.app ? ` · ${t.app}` : ""}${t.title ? ` · ${t.title}` : ""}`}</span></div></li>)}
        <li><div className="sh-lan__main"><b>⏱ TV today</b><span>{fmtMinutes(d.tvMinutesToday || 0)}</span></div></li>
        {d.speed ? <li><div className="sh-lan__main"><b>🚀 Internet</b><span>{d.speed.down} Mbit/s down · {d.speed.up} up · {d.speed.ping} ms · {ago(d.speed.at)}</span></div></li> : null}
      </ul>
      {d.events.length ? <ul className="sh-events">{d.events.slice(0, 6).map((e, i) => <li key={i}><span>{ago(e.at)}</span><b>{e.text}</b></li>)}</ul> : null}
    </Section>
  );
}

/* ───────── what is switched on ───────── */

export function FeaturesCard({ home, devices, goTo }) {
  const s = home.settings;
  if (!s) return null;
  const hub = devices.find((d) => d.kind === "hub" && d.status?.agent === "stashr-hub");
  const phones = devices.filter((d) => d.kind === "phone");
  const sharing = phones.filter((p) => p.status?.location && Date.now() - Number(p.status.location.at) < 45 * 60 * 1000);
  const a = s.alerts || {};
  const rows = [
    ["Devices", [
      ["Home tablet (Stashr Hub)", hub ? (hub.online ? "on" : "offline") : "off", hub ? "" : "Pair it under Devices", "devices"],
      ["Family phones", phones.length ? "on" : "off", phones.length ? `${phones.length} paired` : "None paired yet", "devices"],
      ["Phone locations (Stashr Location)", sharing.length ? "on" : "off", sharing.length ? `${sharing.length} sharing` : "Link phones with the Stashr Location app (Devices tab)", "devices"],
      ["Voice “Hey Stashr”", hub?.status?.voice?.listening ? "on" : "off", hub ? "Turn on in the tablet app" : "", "devices"]
    ]],
    ["Camera and alerts", [
      ["Security camera", hub?.status?.camera?.armed ? "on" : "off", "Start it on the Camera & alerts tab", "security"],
      ["Camera on when everyone is out", s.camera?.auto ? "on" : "off", "", "security"],
      ["Movement alerts (photo and clip)", a.camera !== false ? "on" : "off", "", "security"],
      ["New device on the Wi-Fi", a.newDevice !== false ? "on" : "off", "", "security"],
      ["Unknown device at night", a.night !== false ? "on" : "off", `${a.nightFrom || "00:00"}–${a.nightTo || "05:00"}`, "security"],
      ["Every update to Telegram", a.everything !== false ? "on" : "off", "", "security"],
      ["Someone came home or left", a.presence ? "on" : "off", "", "security"],
      ["Nobody home but the TV is on", a.emptyHomeTv !== false ? "on" : "off", "", "security"],
      ["Morning brief", s.brief?.enabled ? "on" : "off", s.brief?.enabled ? `at ${s.brief.time}` : "", "security"],
      ["Weekly report", s.weekly?.enabled ? "on" : "off", "Sunday 20:00", "security"]
    ]],
    ["Automations", [
      ["Scenes", (s.scenes || []).length ? "on" : "off", `${(s.scenes || []).length} ready`, "automations"],
      ["Schedules", (s.schedules || []).some((x) => x.enabled !== false) ? "on" : "off", `${(s.schedules || []).filter((x) => x.enabled !== false).length} running`, "automations"],
      ["Daily TV limit", s.tvLimit?.minutes ? "on" : "off", s.tvLimit?.minutes ? `${fmtMinutes(s.tvLimit.minutes)}, then ${s.tvLimit.action}` : "", "automations"],
      ["Late-night TV warning", s.tvLimit?.lateNight !== false ? "on" : "off", "", "automations"],
      ["Places and WhatsApp messages", (s.places || []).some((x) => x.enabled !== false) ? "on" : "off", `${(s.places || []).length} places`, "automations"],
      ["Who is on the way home", s.homeSpot && s.eta?.enabled !== false ? "on" : "off", s.homeSpot ? "" : "Set your home location under Places", "automations"],
      ["Location history and insights", s.history?.enabled ? "on" : "off", "Off until you turn it on", "insights"]
    ]],
    ["Media and network", [
      ["Weather", s.weather?.city ? "on" : "off", s.weather?.city || "Set a city under Alerts and daily briefs", "security"],
      ["Morning headlines on the TV", s.news?.enabled !== false ? "on" : "off", "", "security"],
      ["Umbrella reminder when leaving", s.rain !== false ? "on" : "off", "Needs the weather city", "security"],
      ["Internet speed tests", hub?.status?.speed ? "on" : "off", "Every hour from the tablet", "media"],
      ["Photo frame (slideshow)", s.slideshowFolder ? "on" : "off", "", "media"]
    ]]
  ];
  return (
    <Section title="What is switched on" subtitle="Everything you can turn on, and whether it is on right now.">
      {rows.map(([group, items]) => (
        <div key={group} className="sh-feat">
          <h3>{group}</h3>
          <ul className="sh-lan">{items.map(([name, state, note, tab]) => (
            <li key={name}>
              <div className="sh-lan__main"><b>{name}</b>{note ? <span>{note}</span> : null}</div>
              <span className={"sh-chip" + (state === "on" ? " is-on" : "")}>{state === "on" ? "On" : state === "offline" ? "Offline" : "Off"}</span>
              <button className="rd-btn rd-btn--quiet" onClick={() => goTo(tab)}>Open</button>
            </li>
          ))}</ul>
        </div>
      ))}
    </Section>
  );
}


/* ───────── family locations: Stashr Location app ───────── */

const whereText = (p) => {
  if (p.stale && (p.state === "home" || p.state === "away" || p.state === "coming")) {
    const m = Math.round((p.ageSec || 0) / 60);
    const low = p.battery?.pct != null && p.battery.pct <= 20 && !p.battery.charging;
    return `${low ? "Location stopped (battery low)" : "Location not updating"} · last seen ${p.state === "home" ? "at home" : `${p.distanceKm} km from home`}, ${m < 60 ? `${m} min` : `${Math.round(m / 60)} h`} ago`;
  }
  if (p.state === "home") return "At home";
  if (p.state === "coming") return `${p.etaMinutes <= 1 ? "Almost home" : `About ${p.etaMinutes} min away`} · ${p.distanceKm} km · heading home${p.traffic ? " · live traffic" : ""}`;
  if (p.state === "away") return `${p.distanceKm} km from home${p.etaMinutes ? ` · about ${p.etaMinutes} min if they head home now${p.traffic ? " (live traffic)" : ""}` : ""}`;
  if (p.state === "unset") return "Set your home location (Automations → Places) to see the distance";
  return "Waiting for the first location";
};

/* The secret link that shows the chosen phones live on a map, no login. */
function LiveLinkCard({ people }) {
  const [sh, setSh] = useState(null);
  const confirm = useConfirm();
  useEffect(() => { getHomeShare().then(setSh).catch(() => {}); }, []);
  const save = async (body, ok) => { try { setSh(await saveHomeShare(body)); if (ok) toast.success(ok); } catch (e) { toast.error(errorMessage(e, "Could not save.")); } };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast.success("Copied."); } catch { toast.error("Could not copy. Select the link and copy it."); } };
  const toggle = (id) => { const cur = new Set(sh.phones); if (cur.has(id)) cur.delete(id); else cur.add(id); save({ phones: [...cur] }); };
  const renew = async () => {
    if (!(await confirm.ask({ title: "Make a new live link?", message: "The old link stops working at once. Send the new one only to people you trust.", confirmLabel: "New link", danger: true }))) return;
    save({ rotate: true, enabled: true }, "New link ready.");
  };
  if (!sh) return null;
  return (
    <div className="sh-editor">
      <b>Live location link (no login)</b>
      <label className="sh-switch"><input type="checkbox" checked={sh.enabled} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? "The live link is on." : "The live link is off.")} />Anyone with the link can see where the chosen phones are, live, on a map</label>
      {sh.enabled ? (
        <>
          <div className="sh-row"><code className="sh-code" aria-label="Live page link">{sh.page}</code></div>
          <div className="sh-row">
            <a className="rd-btn rd-btn--quiet" href={sh.page} target="_blank" rel="noopener noreferrer">Open live map</a>
            <button className="rd-btn rd-btn--quiet" onClick={() => copy(sh.page)}>Copy link</button>
            <button className="rd-btn rd-btn--quiet" onClick={() => copy(sh.api)}>Copy API (JSON)</button>
            <button className="rd-btn rd-btn--quiet" onClick={renew}>New link</button>
          </div>
          <p className="sh-dim">Phones shown ({sh.phones.length ? "only the ticked ones" : "all linked phones, since none is ticked"}):</p>
          <div className="sh-row">{(people || []).map((p) => <label key={p.id} className="sh-switch"><input type="checkbox" checked={sh.phones.includes(p.id)} onChange={() => toggle(p.id)} />{p.name}</label>)}</div>
          <p className="sh-dim">{sh.lastViewAt ? `Last opened ${ago(new Date(sh.lastViewAt).getTime())}. ` : "Not opened yet. "}While the page is open, phones that are away report every few seconds. The link is a long secret address: nobody can guess it, but anyone you give it to can see these phones until you switch it off or make a new link.</p>
        </>
      ) : <p className="sh-dim">Off. Turn it on to get a link you can open anywhere, or share with family, to see where the phones are right now.</p>}
      {confirm.dialog}
    </div>
  );
}

export function LocationsCard() {
  const [code, setCode] = useState("");
  const [data, setData] = useState(null);
  const confirm = useConfirm();
  const load = useCallback(async () => { try { setData(await getHomeWhere()); } catch { /* keeps the last list */ } }, []);
  useEffect(() => { load(); getLocationCode().then((r) => setCode(r.code)).catch(() => {}); }, [load]);
  usePolling(load, 30000);
  const copy = async () => { try { await navigator.clipboard.writeText(code); toast.success("Code copied."); } catch { toast.error("Could not copy. Select the code and copy it."); } };
  const renew = async () => {
    if (!(await confirm.ask({ title: "Make a new link code?", message: "Phones that are already linked stay linked. Only new phones need the new code.", confirmLabel: "New code" }))) return;
    try { setCode((await rotateLocationCode()).code); toast.success("New code ready."); } catch (e) { toast.error(errorMessage(e, "Could not make a new code.")); }
  };
  const drop = async (p) => {
    if (!(await confirm.ask({ title: `Disconnect ${p.name}?`, message: "Their phone stops being tracked here. They can link again with the code.", confirmLabel: "Disconnect", danger: true }))) return;
    try { await removeHomeDevice(p.id); load(); } catch (e) { toast.error(errorMessage(e, "Could not disconnect.")); }
  };
  const [asking, setAsking] = useState(false);
  const refresh = async () => {
    if (asking) return;
    setAsking(true);
    try {
      const r = await locateNow();
      toast.info(r.phones ? "Asking the phones for their location…" : "No Stashr Location phone is linked yet.");
      const started = Number(r.asked) || Date.now();
      for (let i = 0; r.phones && i < 25; i++) {
        await new Promise((res) => setTimeout(res, 4000));
        const d = await getHomeWhere();
        setData(d);
        const phones = d.people.filter((p) => p.app === "Stashr Location");
        if (phones.length && phones.every((p) => p.fixAt && p.fixAt >= started - 2000)) { toast.success("Locations are fresh."); setAsking(false); return; }
      }
      if (r.phones) toast.info("Some phones have not answered yet. A phone that is saving its battery answers within a few minutes; this page keeps updating.");
    } catch (e) { toast.error(errorMessage(e, "Could not refresh the locations.")); }
    setAsking(false);
  };
  const { settings: st, save: saveSettings } = useHomeSettings();
  return (
    <Section title="Family locations" subtitle="Who is where, how far from home and when they will arrive. Phones run the separate Stashr Location app (it never sees your passwords).">
      <div className="sh-editor">
        <b>Link code for Stashr Location</b>
        <div className="sh-row"><code className="sh-code" aria-label="Link code">{code || "…"}</code><button className="rd-btn rd-btn--quiet" onClick={copy} disabled={!code}>Copy</button><button className="rd-btn rd-btn--quiet" onClick={renew}>New code</button></div>
        <p className="sh-dim">Install Stashr Location from the Apps page on the family phone, type this code and the person’s name. It stays linked until you disconnect it here or they press Disconnect in the app.</p>
      </div>
      <div className="sh-row">
        <button className="rd-btn rd-btn--primary" onClick={refresh} disabled={asking}>{asking ? "Asking the phones…" : "🔄 Refresh location"}</button>
        <span className="sh-dim">Asks every family phone for a fresh location now. Phones with a high battery answer within a minute or two.</span>
      </div>
      <LiveLinkCard people={data ? data.people : []} />
      {st ? <label className="sh-switch"><input type="checkbox" checked={st.tvLive?.enabled !== false} onChange={(e) => saveSettings({ tvLive: { enabled: e.target.checked } }, e.target.checked ? "The TV can show the live map." : "The live map on the TV is off.")} />Allow the live map on the TV (phones that are out then update every few seconds while it is open)</label> : null}
      {data && !data.homeSet ? <p className="sh-bad">Home location is not set yet. Set it under Automations → Places so distances and arrival times can be worked out.</p> : null}
      {data && data.people.length ? (
        <ul className="sh-lan">{data.people.map((p) => (
          <li key={p.id}>
            <div className="sh-lan__main"><b>{p.state === "coming" ? "🚗" : p.state === "home" ? "🏠" : "📍"} {p.name}</b><span>{whereText(p)}{p.battery?.pct != null ? ` · battery ${p.battery.pct}%${p.battery.charging ? " (charging)" : ""}` : ""}{p.lastSeen ? ` · updated ${ago(p.lastSeen)}` : ""}{p.app === "Stashr Hub" ? " · via Stashr Hub" : ""}</span></div>
            <button className="rd-btn rd-btn--danger-quiet" onClick={() => drop(p)}>Disconnect</button>
          </li>
        ))}</ul>
      ) : <p className="sh-dim">No phone is linked yet.</p>}
      {confirm.dialog}
    </Section>
  );
}


/* ───────── family insights: places, trips, commute, driving ───────── */

const tripTime = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

export function InsightsCard() {
  const [d, setD] = useState(null);
  const [names, setNames] = useState({});
  const [limit, setLimit] = useState(80);
  const confirm = useConfirm();
  const load = useCallback(async () => { try { const r = await getHomeInsights(); setD(r); setLimit(r.speedKmh); } catch (e) { toast.error(errorMessage(e, "Could not load.")); } }, []);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const toggle = async (enabled) => { try { await saveHomeHistory({ enabled }); toast.success(enabled ? "Keeping a location history from now on." : "Stopped keeping the history."); load(); } catch (e) { toast.error(errorMessage(e, "Could not save.")); } };
  const wipe = async () => {
    if (!(await confirm.ask({ title: "Delete the whole location history?", message: "Every stored location is erased. Named places stay.", confirmLabel: "Delete it", danger: true }))) return;
    try { const r = await deleteHomeHistory(); toast.success(`Deleted ${r.deleted} locations.`); load(); } catch (e) { toast.error(errorMessage(e, "Could not delete.")); }
  };
  const nameIt = async (c) => {
    const name = (names[c.id] || "").trim();
    if (!name) return;
    try { await saveHomeSpots([...d.spots, { name, lat: c.lat, lon: c.lon, radius: 150 }]); setNames({}); load(); } catch (e) { toast.error(errorMessage(e, "Could not save.")); }
  };
  const dropSpot = async (id) => { try { await saveHomeSpots(d.spots.filter((x) => x.id !== id)); load(); } catch (e) { toast.error(errorMessage(e, "Could not save.")); } };
  return (
    <Section title="Family insights" subtitle="Places, trips, the usual way home and a driving report, worked out from the phones’ locations. Shown only here and on the home tablet’s screen, never on a phone or the TV.">
      <div className="sh-editor">
        <label className="sh-switch"><input type="checkbox" checked={d.enabled} onChange={(e) => toggle(e.target.checked)} />Keep a location history (60 days)</label>
        <p className="sh-dim">Off until you turn it on. When on, Stashr keeps a location about every 2 minutes or 150 m for each family phone (the phones send one every 1–30 minutes, so everything below is approximate). Hard braking cannot be measured. The Stashr Location app tells each person that their Stashr owner can turn a history on.</p>
        <div className="sh-row">
          <label className="sh-dim">Speed to flag <input type="number" min="30" max="200" value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ width: 72 }} aria-label="Speed limit in km/h" /> km/h</label>
          <button className="rd-btn rd-btn--quiet" onClick={async () => { try { await saveHomeHistory({ speedKmh: limit }); toast.success("Saved."); load(); } catch (e) { toast.error(errorMessage(e, "Could not save.")); } }}>Save</button>
          <button className="rd-btn rd-btn--danger-quiet" onClick={wipe}>Delete the history</button>
        </div>
      </div>
      {!d.homeSet ? <p className="sh-bad">Set the home location first (Automations → Places → Home location).</p> : null}
      {d.candidates.length ? (
        <div className="sh-editor">
          <b>Places Stashr found</b>
          <p className="sh-dim">Spots where a phone stayed 20+ minutes on 3 or more different days. Name them (Office, School, Market…) to get trips and the usual commute.</p>
          <ul className="sh-lan">{d.candidates.map((c) => (
            <li key={c.id}>
              <div className="sh-lan__main"><b>{c.guess}</b><span>{c.days} days · {c.visits} visits · about {c.avgHours} h each · <a href={`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=17/${c.lat}/${c.lon}`} target="_blank" rel="noreferrer">see on a map</a></span></div>
              <input value={names[c.id] || ""} onChange={(e) => setNames({ ...names, [c.id]: e.target.value })} placeholder="Name, e.g. Office" maxLength={30} aria-label="Name this place" />
              <button className="rd-btn rd-btn--quiet" onClick={() => nameIt(c)} disabled={!(names[c.id] || "").trim()}>Save</button>
            </li>
          ))}</ul>
        </div>
      ) : null}
      {d.spots.length ? <p className="sh-dim">Named places: {d.spots.map((x) => <span key={x.id} className="sh-chip">{x.name} <button className="rd-btn rd-btn--quiet" aria-label={`Remove ${x.name}`} onClick={() => dropSpot(x.id)}>×</button></span>)}</p> : null}
      {d.enabled && !d.people.length ? <p className="sh-dim">Nothing yet: places and trips appear after a few days of locations.</p> : null}
      {d.people.map((p) => (
        <div key={p.id} className="sh-feat">
          <h3>{p.name}</h3>
          {p.commute.map((c) => (
            <div key={c.place}>
              <p><b>{c.place} → Home</b>: usually leaves around <b>{c.usualLeave}</b>, the way takes about <b>{c.usualMinutes} min</b> ({c.trips} trips).</p>
              <CommuteChart series={c.series} usual={c.usualMinutes} />
            </div>
          ))}
          <p><b>Last 7 days of driving</b>: {p.driving.trips} trips · {p.driving.km} km · highest speed seen {p.driving.maxKmh} km/h · {p.driving.over} trip{p.driving.over === 1 ? "" : "s"} over {p.driving.limit} km/h</p>
          <p className="sh-dim">{p.driving.note}</p>
          {p.trips.length ? (
            <details className="sh-table"><summary>Recent trips</summary>
              <table><thead><tr><th>When</th><th>From → to</th><th>Time</th><th>Km</th><th>Avg</th><th>Top seen</th></tr></thead>
                <tbody>{p.trips.slice(0, 15).map((t) => <tr key={t.from}><td>{tripTime(t.from)}</td><td>{t.fromName || "somewhere"} → {t.toName || "somewhere"}</td><td>{t.minutes} min</td><td>{t.km}</td><td>{t.avgKmh}</td><td>{t.maxKmh || "—"}</td></tr>)}</tbody></table>
            </details>
          ) : null}
        </div>
      ))}
      {confirm.dialog}
    </Section>
  );
}


/* ───────── health check: is every device set up properly? ───────── */

const DOT = { ok: "🟢", bad: "🔴", warn: "🟡", unknown: "⚪" };

/** Counts of red and amber items over all devices, for the banner on the Overview tab. */
export function healthCounts(devices) {
  let bad = 0, warn = 0;
  for (const d of devices) for (const i of healthItems(d)) { if (i.state === "bad") bad++; else if (i.state === "warn") warn++; }
  return { bad, warn };
}

export function HealthCard({ devices }) {
  const list = devices.filter((d) => d.kind === "tv" || d.kind === "hub" || d.kind === "phone");
  const { bad, warn } = healthCounts(list);
  const copy = async () => { try { await navigator.clipboard.writeText(healthReport(list)); toast.success("Report copied. Paste it in the chat."); } catch { toast.error("Could not copy."); } };
  return (
    <Section title="Health check" subtitle="Every device tells Stashr what it is allowed to do and its last error. Red stops a feature, yellow works but worse, grey means the app is too old to say.">
      <p className={bad ? "sh-bad" : "sh-ok"} role="status">{bad ? `${bad} thing${bad > 1 ? "s" : ""} need${bad > 1 ? "" : "s"} fixing${warn ? `, ${warn} could be better` : ""}.` : warn ? `Nothing is broken; ${warn} thing${warn > 1 ? "s" : ""} could be better.` : list.length ? "Everything looks fine." : "No devices yet."}</p>
      <div className="sh-row"><button className="rd-btn rd-btn--quiet" onClick={copy} disabled={!list.length}>Copy a report (to paste in the chat)</button></div>
      {list.map((d) => {
        const items = healthItems(d), h = (d.status || {}).health || {};
        return (
          <div key={d.id} className="sh-feat">
            <h3>{d.kind === "tv" ? "📺" : d.kind === "hub" ? "🧩" : "📱"} {d.name} <span className="sh-dim">· {h.appVersion ? `app ${h.appVersion}` : "app version unknown"}{h.sdk ? ` · Android API ${h.sdk}` : ""}{h.model ? ` · ${h.model}` : ""}</span></h3>
            <ul className="sh-lan">{items.map((i) => (
              <li key={i.id}>
                <div className="sh-lan__main"><b>{DOT[i.state]} {i.label}</b>{i.state !== "ok" && i.fix ? <span>{i.fix}</span> : null}</div>
              </li>
            ))}</ul>
          </div>
        );
      })}
    </Section>
  );
}
