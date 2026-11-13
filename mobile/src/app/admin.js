import React, { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { Page, Loading, Note } from "../components/kit";
import { Box, Btn, Dim, Txt, Row, Input, Toggle, Boundary, ask, useAct } from "../components/home/h";
import { admin } from "../lib/adminApi";

/** Admin panel: which parts of Stashr each person sees, and deleting an account (administrators only). */
export default function Admin() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const act = useAct();
  const load = useCallback(async (query) => { try { setData(await admin.users(query)); setError(""); } catch (e) { setError(e.message || "Could not load users."); } }, []);
  useEffect(() => { const t = setTimeout(() => load(q), 300); return () => clearTimeout(t); }, [q, load]);
  const refresh = async () => { setRefreshing(true); await load(q); setRefreshing(false); };
  const toggleable = (data?.features || []).filter((f) => !f.locked);

  const setFeature = async (user, feature, enabled) => {
    const res = await act(() => admin.setFeature(user.id, feature.key, enabled));
    if (res && res.user) setData((d) => ({ ...d, users: d.users.map((u) => (u.id === user.id ? res.user : u)) }));
  };
  const remove = (user) => {
    // Android has no typed prompt in Alert, so the email is confirmed in two steps instead.
    Alert.alert(`Delete ${user.email}?`, "This permanently deletes the account and every record of theirs: passwords, projects, connected accounts, photos data and sign-ins.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        if (!(await ask("Really delete?", `${user.email} and everything of theirs will be gone for good.`, "Delete for good", true))) return;
        if (await act(() => admin.deleteUser(user.id, user.email), `${user.email} was deleted.`)) setData((d) => ({ ...d, users: d.users.filter((u) => u.id !== user.id), total: Math.max(0, (d.total || 1) - 1) }));
      } },
    ]);
  };
  return (
    <Page title="Admin" subtitle="Choose which parts of Stashr each person sees." onRefresh={refresh} refreshing={refreshing}>
      {error ? <Note tone="bad">{error}</Note> : null}
      {!data && !error ? <Loading /> : null}
      {data ? (
        <View style={{ gap: 14 }}>
          <Input value={q} onChangeText={setQ} placeholder="Search by email" />
          <Dim>{`${(data.users || []).length} of ${data.total ?? 0} users`}</Dim>
          {(data.users || []).map((u) => (
            <Boundary key={u.id} name={u.email}>
              <Box title={u.email} subtitle={`${u.name || "No name"}${u.isAdmin ? " · admin" : ""}${u.createdAt ? ` · joined ${new Date(u.createdAt).toLocaleDateString()}` : ""}`}>
                {toggleable.map((f) => {
                  const custom = typeof u.overrides?.[f.key] === "boolean";
                  return (
                    <View key={f.key}>
                      <Toggle label={f.label} hint={f.description + (custom ? " · changed from the default" : "")} value={Boolean(u.features[f.key])} onChange={(v) => setFeature(u, f, v)} />
                      {custom ? <Row><Btn label={`Reset ${f.label} to default`} onPress={() => setFeature(u, f, null)} /></Row> : null}
                    </View>
                  );
                })}
                {u.isAdmin ? <Txt>Administrator</Txt> : <Row><Btn kind="danger" label="Delete this account" onPress={() => remove(u)} /></Row>}
              </Box>
            </Boundary>
          ))}
          {(data.users || []).length === 0 ? <Dim>No users match.</Dim> : null}
        </View>
      ) : null}
    </Page>
  );
}
