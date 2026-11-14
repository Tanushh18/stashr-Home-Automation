import { fx } from "../../lib/fx";
import React, { useMemo, useState } from "react";
import { LayoutAnimation, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Aurora from "../../components/Aurora";
import Icon from "../../components/Icon";
import HealthRing from "../../components/HealthRing";
import ItemAvatar from "../../components/ItemAvatar";
import { useToast } from "../../components/Toast";
import { Badge, Bounce, Card, Chevron, FadeIn, GhostButton, GradientText, tap } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";
import { useVault } from "../../lib/vault";
import { strengthColor } from "../../lib/strength";

export default function Health() {
  const { theme } = useTheme();
  const { health, items: vaultItems, syncing, refresh, runBreachCheck, breachChecked, breachProgress, prefs } = useVault();
  const toast = useToast();
  const insights = health;
  const [closed, setClosed] = useState({});
  const toggle = (k) => {
    tap();
    LayoutAnimation.configureNext(LayoutAnimation.create(200, "easeInEaseOut", "opacity"));
    setClosed((c) => ({ ...c, [k]: !c[k] }));
  };

  const byId = useMemo(() => {
    const m = {};
    vaultItems.forEach((p) => (m[p.id] = p));
    return m;
  }, [vaultItems]);

  const items = Object.entries(health.info).map(([id, i]) => ({ ...i, id, platform: byId[id]?.name || "Untitled", length: byId[id]?.password?.length || 0 }));
  const sections = [
    { key: "breached", title: "Found in data breaches", icon: "alert", color: theme.danger, list: items.filter((i) => i.breached), hint: "Change these first — they're on attackers' lists." },
    { key: "reused", title: "Reused passwords", icon: "repeat", color: theme.warn, list: items.filter((i) => i.reused), hint: "Give each account its own password." },
    { key: "weak", title: "Weak passwords", icon: "alert", color: theme.danger, list: items.filter((i) => i.score <= 1), hint: "Short or predictable — easy to guess." },
    { key: "old", title: "Not changed in 6+ months", icon: "clock", color: theme.accent3, list: items.filter((i) => i.old), hint: "Rotate important logins now and then." },
  ];
  const clean = items.length > 0 && sections.every((s) => s.list.length === 0);

  const check = async () => {
    try {
      const n = await runBreachCheck();
      if (n) fx.emit("boom", { big: true });
      toast(n ? `${n} password${n === 1 ? " was" : "s were"} found in breaches` : "None of your passwords appear in known breaches", n ? "error" : "success");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Aurora stars={false} intensity={0.9} />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <ScrollView
          contentContainerStyle={{ padding: 18, paddingBottom: 130 }}
          refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => refresh().catch(() => {})} tintColor={theme.accent} colors={[theme.accent]} />}
        >
          <FadeIn>
            <Text style={[styles.title, { color: theme.heading, fontFamily: theme.font.displayHeavy }]}>
              Vault <GradientText>health</GradientText>
            </Text>
            <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, marginBottom: 18 }}>
              Scored on this phone.
            </Text>
          </FadeIn>

          <FadeIn delay={80}>
            <Card glow style={{ alignItems: "center", paddingVertical: 26 }}>
              <HealthRing score={insights.score} size={190} stroke={16} />
              <View style={styles.grid}>
                <Tile n={insights?.total} label="Total" color={theme.accentSoft} />
                <Tile n={insights?.strong} label="Strong" color={theme.ok} />
                <Tile n={insights?.weak} label="Weak" color={theme.danger} />
                <Tile n={insights?.reused} label="Reused" color={theme.warn} />
              </View>
              <GhostButton
                small
                icon="shieldCheck"
                title={breachProgress ? `Checking ${breachProgress.done}/${breachProgress.total}…` : breachChecked ? `Breaches found: ${health.breached} · check again` : "Check for data breaches"}
                onPress={breachProgress ? undefined : check}
                style={{ marginTop: 16, alignSelf: "stretch" }}
              />
              <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, fontSize: 11, marginTop: 8, textAlign: "center" }}>
                Uses Have I Been Pwned with k-anonymity: only 5 characters of a hash are sent.
              </Text>
            </Card>
          </FadeIn>

          {clean ? (
            <FadeIn delay={160}>
              <Card style={{ marginTop: 16, alignItems: "center", gap: 8, paddingVertical: 26 }}>
                <Icon name="shieldCheck" size={40} color={theme.ok} />
                <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 18 }}>All clear</Text>
                <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, textAlign: "center" }}>
                  Every password is strong, unique and fresh.
                </Text>
              </Card>
            </FadeIn>
          ) : null}

          {sections.map((s, si) =>
            s.list.length ? (
              <FadeIn key={s.key} delay={160 + si * 80} style={{ marginTop: 18 }}>
                <Pressable onPress={() => toggle(s.key)} accessibilityRole="button" accessibilityState={{ expanded: !closed[s.key] }} style={styles.sectionHead}>
                  <View style={[styles.sectionIcon, { backgroundColor: alpha(s.color, 0.16) }]}>
                    <Icon name={s.icon} size={16} color={s.color} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 16 }}>
                      {s.title} · {s.list.length}
                    </Text>
                    <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, fontSize: 12 }}>{s.hint}</Text>
                  </View>
                  <Chevron open={!closed[s.key]} />
                </Pressable>
                {closed[s.key] ? null : <Card style={{ padding: 6 }}>
                  {s.list.map((i, idx) => {
                    const entry = byId[i.id];
                    return (
                      <Bounce
                        key={i.id}
                        scaleTo={0.98}
                        onPress={() => router.push({ pathname: "/editor", params: { id: i.id } })}
                        style={[styles.row, idx > 0 && { borderTopWidth: 1, borderTopColor: theme.line }]}
                      >
                        <ItemAvatar name={i.platform} url={entry?.url} icons={prefs.icons} size={38} />
                        <View style={{ flex: 1 }}>
                          <Text numberOfLines={1} style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 15 }}>
                            {i.platform}
                          </Text>
                          <Text numberOfLines={1} style={{ color: theme.textFaint, fontFamily: theme.font.body, fontSize: 12 }}>
                            {i.breached ? `Seen ${i.breached.toLocaleString()} times in breaches` : entry?.username || `${i.length} characters`}
                          </Text>
                        </View>
                        <Badge text={i.label} color={strengthColor(theme, i.score)} />
                        <Text style={{ color: theme.accentSoft, fontFamily: theme.font.bodySemi, fontSize: 13 }}>Fix</Text>
                      </Bounce>
                    );
                  })}
                </Card>}
              </FadeIn>
            ) : null
          )}

          <FadeIn delay={400} style={{ marginTop: 18 }}>
            <Card>
              <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 16, marginBottom: 10 }}>Quick wins</Text>
              {[
                "Use 16+ characters — length beats complexity.",
                "Never reuse your email password anywhere else.",
                "Turn on biometric unlock in Settings.",
              ].map((t) => (
                <View key={t} style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
                  <Icon name="shieldCheck" size={16} color={theme.accentSoft} />
                  <Text style={{ flex: 1, color: theme.textMuted, fontFamily: theme.font.body }}>{t}</Text>
                </View>
              ))}
            </Card>
          </FadeIn>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Tile({ n, label, color }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: alpha(color.startsWith("#") ? color : "#31AAA9", 0.1), borderColor: theme.line }]}>
      <Text style={{ color, fontFamily: theme.font.displayHeavy, fontSize: 22 }}>{n ?? "–"}</Text>
      <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, letterSpacing: -0.4, marginTop: 6, marginBottom: 4 },
  grid: { flexDirection: "row", gap: 8, marginTop: 22, alignSelf: "stretch" },
  tile: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 16, borderWidth: 1 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  sectionIcon: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10 },
});
