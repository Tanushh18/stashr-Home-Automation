import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Modal, Pressable, SectionList, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import Icon from "../../components/Icon";
import { Empty, Loading, Note } from "../../components/kit";
import { useToast } from "../../components/Toast";
import { Chip, GhostButton, GradientButton, IconButton } from "../../components/ui";
import { api, mediaSource } from "../../lib/api";
import { WEBSITE } from "../../lib/config";
import { dropMedia, monthLabel, patchAlbum, patchMedia, setViewerList, usePhotoData } from "../../lib/photoData";
import { counts, getState, loadState, subscribe } from "../../lib/photoSync";
import { useLocalMedia } from "../../lib/localMedia";
import { alpha, useTheme } from "../../lib/theme";

const FILTERS = [["all", "All"], ["photo", "Photos"], ["video", "Videos"], ["screenshot", "Screenshots"], ["favorites", "Favourites"], ["archived", "Archived"]];
const GAP = 3;

function AlbumPicker({ visible, albums, onPick, onClose, title = "Add to album", placeholder = "New album name", canCreate = true, clearLabel }) {
  const { theme } = useTheme();
  const [name, setName] = useState("");
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surfaceSolid, borderColor: theme.line }]} onPress={() => {}}>
          <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 16, marginBottom: 8 }}>{title}</Text>
          {clearLabel ? <Pressable onPress={() => onPick("__none")} style={[styles.pickRow, { borderColor: theme.line }]}><Text style={{ color: theme.accent, fontFamily: theme.font.body, fontSize: 15 }}>{clearLabel}</Text></Pressable> : null}
          {(albums || []).map((a) => (
            <Pressable key={a.id} onPress={() => onPick(a.id)} style={[styles.pickRow, { borderColor: theme.line }]}>
              <Text style={{ color: theme.text, fontFamily: theme.font.body, fontSize: 15 }}>{a.name}</Text>
              <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 }}>{(a.mediaIds || []).length}</Text>
            </Pressable>
          ))}
          {canCreate ? (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <TextInput value={name} onChangeText={setName} placeholder={placeholder} placeholderTextColor={theme.textFaint} style={[styles.input, { color: theme.text, borderColor: theme.lineStrong }]} />
              <GradientButton title="Create" small disabled={!name.trim()} onPress={() => onPick(null, name.trim())} />
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function Photos() {
  const { theme } = useTheme();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams();
  const { data, loading, error, reload } = usePhotoData();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [album, setAlbum] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [pickAlbum, setPickAlbum] = useState(false);
  const [pickFolder, setPickFolder] = useState(false);
  const [folder, setFolder] = useState(null);
  const local = useLocalMedia();
  const [queue, setQueue] = useState(counts());
  const cell = (width - 36 - GAP * 2) / 3;

  useEffect(() => { loadState().then(() => setQueue(counts())); return subscribe(() => setQueue(counts())); }, []);
  useEffect(() => { if (params.folder) { setFolder(String(params.folder)); setFilter("all"); router.setParams({ folder: undefined }); } }, [params.folder]);
  useEffect(() => {
    if (!params.google) return;
    if (params.google === "connected") {
      toast("Google account connected. Indexing your files…");
      api.photoDashboard().then((d) => Promise.all((d.connections || []).filter((c) => c.oauthMode === "connected" && !c.lastScan).map((c) => api.photoSync(c.id)))).then(reload).catch(() => {});
    } else if (params.google === "cancelled") toast("Google sign-in was cancelled.", "info");
    else toast("Could not connect that Google account.", "error");
    router.setParams({ google: undefined });
  }, [params.google]);

  const albums = data?.albums || [];
  const selecting = picked.size > 0;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inAlbum = album ? new Set((albums.find((a) => a.id === album) || {}).mediaIds || []) : null;
    const cloud = data?.media || [];
    const have = new Set(cloud.map((m) => String(m.filename || "").toLowerCase()));
    const onPhone = folder || album ? [] : local.items.filter((m) => !have.has(String(m.filename || "").toLowerCase()));
    return [...cloud, ...onPhone]
      .filter((m) => (filter === "archived" ? m.archived : !m.archived))
      .filter((m) => filter === "all" || filter === "archived" || (filter === "favorites" ? m.favorite : m.type === filter))
      .filter((m) => !inAlbum || inAlbum.has(m.id))
      .filter((m) => !folder || m.folderId === folder)
      .filter((m) => !q || [m.filename, m.account, m.type, m.tag].join(" ").toLowerCase().includes(q))
      .sort((a, b) => new Date(b.takenAt || 0) - new Date(a.takenAt || 0));
  }, [data, local.items, query, filter, album, albums, folder]);

  const sections = useMemo(() => {
    const months = new Map();
    visible.forEach((m) => { const k = monthLabel(m.takenAt); months.set(k, [...(months.get(k) || []), m]); });
    return [...months].map(([title, items]) => {
      const rows = [];
      for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3));
      return { title, count: items.length, data: rows };
    });
  }, [visible]);

  const open = (item) => {
    if (selecting) return toggle(item.id);
    setViewerList(visible.map((m) => m.id));
    router.push({ pathname: "/photo-viewer", params: { id: item.id } });
  };
  const toggle = (id) => id.startsWith("local:") ? null : setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clear = () => setPicked(new Set());

  const connect = async () => {
    try { const r = await api.photoGoogleStart("Google account"); await Linking.openURL(r.url); }
    catch (e) { toast(e.message || "Google sign-in is not set up on the server yet.", "error"); }
  };

  const favourite = async () => {
    const ids = [...picked];
    const makeFav = !(data.media.filter((m) => picked.has(m.id)).every((m) => m.favorite));
    ids.forEach((id) => patchMedia(id, { favorite: makeFav }));
    clear();
    await Promise.all(ids.map((id) => api.photoMediaUpdate(id, { favorite: makeFav }))).catch(() => { toast("Some changes were not saved.", "error"); reload(); });
  };
  const archive = async () => {
    const ids = [...picked];
    const archived = filter !== "archived";
    ids.forEach((id) => patchMedia(id, { archived }));
    clear();
    await Promise.all(ids.map((id) => api.photoMediaUpdate(id, { archived }))).catch(() => { toast("Some changes were not saved.", "error"); reload(); });
  };
  const addToAlbum = async (albumId, newName) => {
    setPickAlbum(false);
    try {
      let id = albumId;
      if (!id) { const created = await api.albumCreate(newName); patchAlbum(created.album); id = created.album.id; }
      const res = await api.albumAdd(id, [...picked]);
      patchAlbum(res.album);
      toast("Added to album");
      clear();
    } catch (e) { toast(e.message, "error"); }
  };
  const moveToFolder = async (folderId, newName) => {
    setPickFolder(false);
    try {
      let target = folderId === "__none" ? null : folderId;
      if (!target && newName) target = (await api.folderCreate(newName, null)).folder.id;
      const ids = [...picked];
      const results = await Promise.all(ids.map((id) => api.photoMediaUpdate(id, { folderId: target }).catch(() => null)));
      ids.forEach((id) => patchMedia(id, { folderId: target }));
      const driveMoved = results.filter((r) => r && r.driveMoved).length;
      clear(); reload();
      toast(driveMoved === ids.length ? "Moved, in Google Drive too" : "Moved in Stashr. Files not uploaded by Stashr stay in their Drive folder.");
    } catch (e) { toast(e.message, "error"); }
  };
  const shareLink = async () => {
    try {
      const res = await api.photoShare({ mediaIds: [...picked], title: "Shared photos", expiresInDays: 7, allowDownload: false });
      clear();
      await Share.share({ message: `${WEBSITE}/share/photos/${res.token}` });
    } catch (e) { toast(e.message, "error"); }
  };
  const remove = () => {
    const ids = [...picked];
    Alert.alert(`Remove ${ids.length} item${ids.length === 1 ? "" : "s"}?`, "Choose what to remove. Nothing is permanently deleted from Google Drive here.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove from Stashr only", onPress: () => run("index") },
      { text: "Move to Drive trash", style: "destructive", onPress: () => run("cloud") },
    ]);
    const run = async (scope) => {
      const failed = [];
      for (const id of ids) { try { await api.photoMediaRemove(id, scope); } catch (e) { failed.push(e.message); } }
      clear(); await reload();
      toast(failed.length ? failed[0] : scope === "cloud" ? "Moved to the Drive trash" : "Removed from Stashr", failed.length ? "error" : "ok");
    };
  };

  const header = (
    <View style={{ gap: 12, paddingBottom: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 26 }}>Photos</Text>
          <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 }}>{(data?.media || []).length} items · {data?.totals ? `${data.totals.usedGb} of ${data.totals.limitGb} GB used across ${data.totals.accounts} account${data.totals.accounts === 1 ? "" : "s"}` : "loading storage"}</Text>
        </View>
        <IconButton name="grid" onPress={() => router.push("/photo-folders")} />
        <IconButton name="folder" onPress={() => router.push("/albums")} />
        <IconButton name="cloud" onPress={() => router.push("/photo-backup")} />
      </View>

      {data && !(data.connections || []).some((c) => c.status === "connected") ? (
        <View style={{ gap: 10 }}>
          <Note>Photos are stored in your own Google Drive. Connect an account to see what is already there and to back up this phone. Stashr never sees your Google password.</Note>
          <GradientButton title="Connect a Google account" icon="cloud" onPress={connect} />
        </View>
      ) : null}

      {queue.queued + queue.uploading + queue.failed > 0 ? (
        <Pressable onPress={() => router.push("/photo-backup")} style={[styles.queue, { borderColor: theme.line, backgroundColor: theme.surface }]}>
          <Icon name="upload" size={16} color={theme.textMuted} />
          <Text style={{ flex: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 13 }}>
            Backup: {queue.uploading + queue.queued} waiting{queue.failed ? `, ${queue.failed} failed` : ""}
          </Text>
          <Icon name="arrow" size={14} color={theme.textFaint} />
        </Pressable>
      ) : null}

      <View style={[styles.search, { borderColor: theme.line, backgroundColor: theme.surface }]}>
        <Icon name="search" size={17} color={theme.textFaint} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search by name, account or type" placeholderTextColor={theme.textFaint} style={{ flex: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 14 }} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {FILTERS.map(([id, label]) => <Chip key={id} label={label} active={filter === id} onPress={() => setFilter(id)} />)}
      </View>
      {folder ? <Chip label={`Folder: ${(data?.folders || []).find((f) => f.id === folder)?.name || ""}  ✕`} active onPress={() => setFolder(null)} /> : null}
      {album ? <Chip label={`Album: ${albums.find((a) => a.id === album)?.name || ""}  ✕`} active onPress={() => setAlbum(null)} /> : null}
      {local.needsPermission ? <Pressable onPress={() => local.refresh(true)}><Note>Allow access to photos to see the pictures and videos on this phone here. Tap to allow.</Note></Pressable> : null}
      {error ? <Note tone="bad">{error}</Note> : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <SectionList
          sections={sections}
          keyExtractor={(row) => row[0].id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: selecting ? 190 : 130 }}
          onRefresh={reload}
          refreshing={loading}
          ListHeaderComponent={header}
          ListEmptyComponent={loading || !data ? <Loading /> : <Empty title="No photos here">{data?.media?.length ? "Nothing matches this filter." : "Connect an account and pull to refresh, or turn on backup to upload from this phone."}</Empty>}
          renderSectionHeader={({ section }) => (
            <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 14, marginTop: 14, marginBottom: 8 }}>{section.title} <Text style={{ color: theme.textFaint, fontFamily: theme.font.body }}>· {section.count}</Text></Text>
          )}
          renderItem={({ item: row }) => (
            <View style={{ flexDirection: "row", gap: GAP, marginBottom: GAP }}>
              {row.map((m) => {
                const on = picked.has(m.id);
                const gone = m.availabilityState !== "available";
                return (
                  <Pressable key={m.id} onPress={() => open(m)} onLongPress={() => toggle(m.id)} style={{ width: cell, height: cell, backgroundColor: theme.surfaceRaised, borderRadius: 4, overflow: "hidden" }}>
                    {!gone && m.hasThumbnail ? <Image source={m.local ? { uri: m.localUri } : mediaSource(m.id)} recyclingKey={m.id} contentFit="cover" cachePolicy="memory-disk" style={{ width: cell, height: cell }} /> : (
                      <View style={styles.noThumb}><Text style={{ color: theme.textFaint, fontFamily: theme.font.bodyMedium, fontSize: 11, textAlign: "center" }}>{gone ? "Source\nunavailable" : m.type}</Text></View>
                    )}
                    {m.type === "video" ? <View style={styles.tag}><Icon name="clock" size={11} color="#fff" /></View> : null}
                    {m.favorite ? <View style={styles.fav}><Icon name="starFill" size={13} color="#fff" /></View> : null}
                    {selecting ? <View style={[styles.check, { borderColor: "#fff", backgroundColor: on ? theme.accent : "rgba(0,0,0,.35)" }]}>{on ? <Icon name="check" size={12} color={theme.onAccent} strokeWidth={3} /> : null}</View> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        />
      </SafeAreaView>

      {selecting ? (
        <View style={[styles.bar, { backgroundColor: theme.surfaceSolid, borderColor: theme.line }]}>
          <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 14 }}>{picked.size} selected</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, flex: 1, justifyContent: "flex-end" }}>
            <GhostButton small title="Favourite" onPress={favourite} />
            <GhostButton small title={filter === "archived" ? "Unarchive" : "Archive"} onPress={archive} />
            <GhostButton small title="Album" onPress={() => setPickAlbum(true)} />
            <GhostButton small title="Folder" onPress={() => setPickFolder(true)} />
            <GhostButton small title="Link" onPress={shareLink} />
            <GhostButton small title="Remove" color={theme.danger} onPress={remove} />
            <GhostButton small title="Cancel" onPress={clear} />
          </View>
        </View>
      ) : null}
      <AlbumPicker visible={pickFolder} title="Move to folder" placeholder="New folder name" clearLabel="Move out of folders" albums={(data?.folders || []).map((f) => ({ id: f.id, name: f.name, mediaIds: { length: f.count } }))} onPick={moveToFolder} onClose={() => setPickFolder(false)} />
      <AlbumPicker visible={pickAlbum} albums={albums} onPick={addToAlbum} onClose={() => setPickAlbum(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 44 },
  queue: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 44 },
  noThumb: { flex: 1, alignItems: "center", justifyContent: "center", padding: 4 },
  tag: { position: "absolute", left: 5, bottom: 5, backgroundColor: "rgba(0,0,0,.55)", borderRadius: 4, padding: 3 },
  fav: { position: "absolute", right: 5, bottom: 5 },
  check: { position: "absolute", right: 5, top: 5, width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 78, borderTopWidth: 1, gap: 10 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,.5)", justifyContent: "flex-end" },
  sheet: { borderTopWidth: 1, borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 18, paddingBottom: 30 },
  pickRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 14 },
});
