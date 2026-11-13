import React, { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { Image } from "expo-image";
import * as DocumentPicker from "expo-document-picker";
import { Page, Loading, Note } from "../components/kit";
import { Box, Btn, Dim, Good, Bad, Txt, Row, Input, Pick, Toggle, Boundary, ask, useAct } from "../components/home/h";
import { shine, STAGES, uploadToCloudinary, kindOf } from "../lib/shineApi";
import { useTheme } from "../lib/theme";

/** ShineOne Estate Manager: photos and videos shown on the ShineOne Estate website, per sector or area (administrators). */
export default function Media() {
  const [projects, setProjects] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [site, setSite] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const act = useAct();

  const load = useCallback(async () => {
    try { const d = await shine.projects(); setProjects(d.projects); setConfigured(d.configured); setError(""); } catch (e) { setError(e.message || "Could not load the photos."); }
    shine.site().then(setSite).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const isVisible = (key) => { const p = site && site.projects.find((x) => x.key === key); return !p || p.visible !== false; };
  const toggleVisible = async (key) => {
    const live = isVisible(key);
    const r = await act(() => shine.update(key, { visible: !live }), live ? "Hidden from the website." : "Shown on the website.");
    if (r && r !== true) setSite(r);
  };
  const addSector = async () => {
    const r = await act(() => shine.addProject(newName.trim()), "Added. Now add its photos.");
    if (r && r.key) { setNewName(""); await load(); setOpen(r.key); }
  };

  const upload = async () => {
    if (!open) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["image/*", "video/*"], multiple: true, copyToCacheDirectory: true });
      if (res.canceled || !res.assets || !res.assets.length) return;
      let done = 0, failed = "";
      for (let i = 0; i < res.assets.length; i++) {
        const a = res.assets[i], kind = kindOf(a);
        try {
          setBusy(`Uploading ${i + 1} of ${res.assets.length}…`);
          const sig = await shine.sign(open, kind);
          await uploadToCloudinary(sig, a, kind);
          done++;
        } catch (e) { failed = failed || e.message; }
      }
      setBusy("");
      if (done) { await shine.uploaded().catch(() => {}); await load(); await act(async () => true, `${done} file${done === 1 ? "" : "s"} added.`); }
      if (failed) await act(async () => { throw new Error(failed); });
    } catch (e) { setBusy(""); await act(async () => { throw e; }); }
  };
  const remove = async (item) => { if (await ask(`Remove this ${item.kind} from the website?`, "It disappears from the ShineOne Estate website.", "Remove", true) && await act(() => shine.remove(item), "Removed.")) load(); };

  const current = projects && projects.find((p) => p.key === open);
  return (
    <Page title="ShineOne Estate Manager" subtitle="Photos and videos you add here appear on the ShineOne Estate website, per sector or area. Same folders as the Tasks app." onRefresh={refresh} refreshing={refreshing}>
      {error ? <Note tone="bad">{error}</Note> : null}
      {!projects && !error ? <Loading /> : null}
      {projects && !configured ? <Note tone="bad">The website photo service is not set up on the server yet (CLOUDINARY_*_shine variables).</Note> : null}
      {projects ? (
        <View style={{ gap: 14 }}>
          <Box title="Add a sector or area">
            <Input value={newName} onChangeText={setNewName} placeholder="e.g. Sector 12" maxLength={40} autoCapitalize="words" />
            <Btn kind="primary" label="Add sector / area" onPress={addSector} disabled={!newName.trim()} />
          </Box>
          {projects.map((p) => {
            const live = isVisible(p.key), cover = p.items[0];
            return (
              <Boundary key={p.key} name={p.label}>
                <Box title={p.label} subtitle={`${p.items.filter((i) => i.kind === "image").length} photos · ${p.items.filter((i) => i.kind === "video").length} videos`}>
                  {cover ? <Image source={{ uri: cover.thumb }} style={{ width: "100%", height: 120, borderRadius: 10 }} contentFit="cover" /> : <Dim>No photos yet.</Dim>}
                  <Toggle label={live ? "Shown on website" : "Hidden from website"} value={live} onChange={() => toggleVisible(p.key)} />
                  <Row><Btn label={open === p.key ? "Close" : "Open files"} onPress={() => setOpen(open === p.key ? "" : p.key)} /></Row>
                </Box>
              </Boundary>
            );
          })}
          {current ? (
            <Boundary name="Files">
              <Box title={current.label} subtitle="Add photos and videos, or remove one.">
                <Btn kind="primary" label={busy || "Add photos / videos"} onPress={upload} disabled={Boolean(busy) || !configured} loading={Boolean(busy)} />
                {site && site.projects.find((p) => p.key === current.key) ? <StatusEditor key={current.key} project={site.projects.find((p) => p.key === current.key)} onSaved={setSite} /> : null}
                {current.items.length === 0 ? <Dim>Nothing here yet.</Dim> : null}
                <Row gap={8}>{current.items.map((item) => <Thumb key={item.publicId} item={item} onRemove={() => remove(item)} />)}</Row>
              </Box>
            </Boundary>
          ) : null}
        </View>
      ) : null}
    </Page>
  );
}

function Thumb({ item, onRemove }) {
  const { theme } = useTheme();
  return (
    <View style={{ width: 100, gap: 4 }}>
      <Pressable onPress={() => Linking.openURL(item.url).catch(() => {})} style={{ width: 100, height: 80, borderRadius: 8, overflow: "hidden", backgroundColor: theme.line }}>
        <Image source={{ uri: item.thumb }} style={{ width: 100, height: 80 }} contentFit="cover" />
      </Pressable>
      <Dim>{item.kind === "video" ? "Video" : "Photo"}</Dim>
      <Btn kind="danger" label="Remove" onPress={onRemove} />
    </View>
  );
}

/** Progress %, stage and ETA the website shows for one sector / project. */
function StatusEditor({ project, onSaved }) {
  const [form, setForm] = useState({ status: project.status, area: project.area || "", progress: String(project.progress ?? 0), stage: project.stage || "", eta: project.eta || "" });
  const act = useAct();
  const completed = form.status === "Completed";
  const save = async () => { const r = await act(() => shine.update(project.key, { ...form, progress: Number(form.progress) || 0 }), "Website status saved."); if (r && r !== true) onSaved(r); };
  return (
    <View style={{ gap: 8 }}>
      <Txt bold>Website status</Txt>
      <Pick options={[["Ongoing", "Ongoing"], ["Completed", "Completed"]]} value={form.status} onChange={(v) => setForm({ ...form, status: v })} />
      <Input value={form.area} onChangeText={(v) => setForm({ ...form, area: v })} placeholder="Area" maxLength={60} autoCapitalize="words" />
      {!completed ? <Input value={form.progress} onChangeText={(v) => setForm({ ...form, progress: v })} placeholder="Progress %" keyboardType="number-pad" /> : <Good>Progress 100%</Good>}
      {!completed ? <Pick options={STAGES.map((s) => [s, s || "Automatic"])} value={form.stage} onChange={(v) => setForm({ ...form, stage: v })} /> : null}
      <Input value={form.eta} onChangeText={(v) => setForm({ ...form, eta: v })} placeholder="ETA, e.g. June 2027" maxLength={60} />
      <Row><Btn label="Save status" onPress={save} /></Row>
    </View>
  );
}
