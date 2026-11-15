import React, { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Aurora from "../components/Aurora";
import Icon from "../components/Icon";
import { useToast } from "../components/Toast";
import { Badge, Bounce, Card, Chip, FadeIn, GhostButton, GradientButton, IconButton } from "../components/ui";
import { useTheme, alpha } from "../lib/theme";
import { useVault } from "../lib/vault";
import { STATUS_LABEL, STATUSES } from "../lib/projectItems";
import { flattenProject, searchProjects } from "../lib/projectTree";
import ProjectTree, { TreeLeaf, statusColors } from "../components/ProjectTree";

function ProjectCard({ item, colors }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const fields = flattenProject(item).length;
  const go = () => router.push({ pathname: "/project", params: { id: item.id } });
  return (
    <Card style={{ marginBottom: 12 }}>
      <Pressable onPress={go} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 16 }} numberOfLines={1}>
            {item.name || "Untitled project"}
          </Text>
          {item.description ? (
            <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, marginTop: 3 }} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}
        </View>
        <IconButton name="pencil" size={34} iconSize={15} onPress={() => router.push({ pathname: "/project-editor", params: { id: item.id } })} />
      </Pressable>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        <Badge text={STATUS_LABEL[item.status] || item.status} color={colors[item.status]} />
        {item.hostingProvider ? <Badge text={item.hostingProvider} color={theme.textMuted} icon="globe" /> : null}
        {item.databases?.length ? <Badge text={`${item.databases.length} DB`} color={theme.textMuted} /> : null}
        {item.envVars?.length ? <Badge text={`${item.envVars.length} env`} color={theme.textMuted} /> : null}
      </View>
      <View style={[styles.cardFoot, { borderColor: theme.line }]}>
        <Pressable onPress={() => setOpen((v) => !v)} hitSlop={8}>
          <Text style={{ color: theme.accent, fontFamily: theme.font.bodySemi, fontSize: 13 }}>
            {open ? "Hide structure" : `Show structure · ${fields} field${fields === 1 ? "" : "s"}`}
          </Text>
        </Pressable>
        <Pressable onPress={go} hitSlop={8}>
          <Text style={{ color: theme.textMuted, fontFamily: theme.font.bodySemi, fontSize: 13 }}>Open →</Text>
        </Pressable>
      </View>
      {open ? <View style={{ marginTop: 6 }}><ProjectTree project={item} /></View> : null}
    </Card>
  );
}

export default function Projects() {
  const { theme } = useTheme();
  const { projects, projectsBroken, syncing, refresh } = useVault();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("__all");
  const [view, setView] = useState("all"); // all | values | projects (while searching)
  const colors = statusColors(theme);

  const results = useMemo(() => {
    const r = searchProjects(projects.filter((p) => status === "__all" || p.status === status), query);
    const recent = (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    return { projects: [...r.projects].sort(recent), values: r.values };
  }, [projects, query, status]);

  const searching = query.trim().length > 0;
  const list = searching && view === "values" ? [] : results.projects;
  const showValues = searching && view !== "projects" && results.values.length > 0;

  const header = (
    <View>
      <FadeIn style={styles.top}>
        <IconButton name="back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 26, letterSpacing: -0.4 }}>Projects</Text>
          <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 }}>
            {projects.length} project{projects.length === 1 ? "" : "s"} · encrypted
          </Text>
        </View>
        <GhostButton small title="Create & deploy" onPress={() => router.push("/deploy-new")} />
      </FadeIn>

      {projectsBroken ? (
        <View style={[styles.banner, { backgroundColor: alpha(theme.danger, 0.1), borderColor: alpha(theme.danger, 0.4) }]}>
          <Icon name="alert" size={16} color={theme.danger} />
          <Text style={{ flex: 1, color: theme.danger, fontFamily: theme.font.bodyMedium, fontSize: 13 }}>
            {projectsBroken} project{projectsBroken === 1 ? "" : "s"} couldn't be decrypted and {projectsBroken === 1 ? "is" : "are"} hidden.
          </Text>
        </View>
      ) : null}

      <FadeIn delay={120} style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <Icon name="search" size={18} color={theme.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search projects, variables, values…"
          placeholderTextColor={theme.textFaint}
          style={{ flex: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 15, height: "100%" }}
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={theme.accent}
        />
        {query ? <IconButton name="close" size={30} iconSize={14} onPress={() => setQuery("")} /> : null}
      </FadeIn>

      <FadeIn delay={160}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {searching ? (
            <>
              <Chip label="All results" active={view === "all"} onPress={() => setView("all")} />
              <Chip label="Values" active={view === "values"} onPress={() => setView("values")} count={results.values.length} />
              <Chip label="Projects" active={view === "projects"} onPress={() => setView("projects")} count={results.projects.length} />
              <View style={{ width: 1, backgroundColor: theme.line, marginHorizontal: 2 }} />
            </>
          ) : null}
          <Chip label="All" active={status === "__all"} onPress={() => setStatus("__all")} count={projects.length} />
          {STATUSES.map((s) => {
            const count = projects.filter((p) => p.status === s).length;
            if (!count) return null;
            return <Chip key={s} label={STATUS_LABEL[s]} active={status === s} onPress={() => setStatus(s)} count={count} color={colors[s]} />;
          })}
        </ScrollView>
      </FadeIn>

      {showValues ? (
        <Card style={{ marginBottom: 14, paddingVertical: 10 }}>
          <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 14, marginBottom: 4 }}>
            Values matching “{query.trim()}”
          </Text>
          {results.values.slice(0, 40).map((hit, i) => (
            <View key={`${hit.project.id}-${i}`} style={i ? { borderTopWidth: 1, borderColor: theme.line, paddingTop: 4 } : null}>
              <Pressable onPress={() => router.push({ pathname: "/project", params: { id: hit.project.id } })} hitSlop={4}>
                <Text style={{ color: theme.accent, fontFamily: theme.font.bodySemi, fontSize: 12, paddingLeft: 6, paddingTop: 4 }}>{hit.project.name}</Text>
              </Pressable>
              <TreeLeaf node={hit.field} path={hit.field.path.join(" › ")} reveal />
            </View>
          ))}
        </Card>
      ) : null}
      {searching && list.length ? (
        <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 14, marginBottom: 8 }}>Projects</Text>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Aurora stars={false} intensity={0.8} />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <ProjectCard item={item} colors={colors} />}
          ListHeaderComponent={header}
          ListEmptyComponent={
            showValues || (searching && view === "values") ? null : (
            <FadeIn delay={200}>
              <Card style={{ alignItems: "center", paddingVertical: 34, gap: 10 }}>
                <View style={[styles.emptyIcon, { backgroundColor: alpha(theme.accent, 0.15) }]}>
                  <Icon name={projects.length ? "search" : "globe"} size={28} color={theme.accentSoft} />
                </View>
                <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 19, textAlign: "center" }}>
                  {projects.length ? "Nothing here" : "No projects yet"}
                </Text>
                <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, textAlign: "center", marginBottom: 8 }}>
                  {projects.length ? "Try another search or clear the filters." : "Add hosting, databases and env vars for a project — encrypted the same way as a password."}
                </Text>
                {projects.length ? (
                  <Chip label="Show everything" active onPress={() => { setQuery(""); setStatus("__all"); }} />
                ) : (
                  <GradientButton title="Add a project" icon="plus" small onPress={() => router.push("/project-editor")} />
                )}
              </Card>
            </FadeIn>
            )
          }
          contentContainerStyle={{ padding: 18, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl
              refreshing={syncing}
              onRefresh={() => refresh().catch((e) => toast(e.message, "error"))}
              tintColor={theme.accent}
              colors={[theme.accent, theme.accent]}
              progressBackgroundColor={theme.surfaceSolid}
            />
          }
          keyboardShouldPersistTaps="handled"
        />
        {projects.length ? (
          <View style={styles.fabWrap}>
            <Bounce onPress={() => router.push("/project-editor")} scaleTo={0.9}>
              <View style={[styles.fab, { backgroundColor: theme.accent, shadowColor: theme.accent }]}>
                <Icon name="plus" size={24} color={theme.onAccent} strokeWidth={2.4} />
              </View>
            </Bounce>
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", marginBottom: 16, marginTop: 6 },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, height: 52, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, marginBottom: 12 },
  chips: { gap: 8, paddingBottom: 10 },
  cardFoot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, marginTop: 12, paddingTop: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  fabWrap: { position: "absolute", right: 20, bottom: 26 },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 0,
  },
});
