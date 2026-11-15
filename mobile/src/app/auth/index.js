import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Aurora from "../../components/Aurora";
import Icon from "../../components/Icon";
import StatusPill from "../../components/StatusPill";
import { FadeIn, GhostButton, GradientButton, GradientText } from "../../components/ui";
import { useTheme } from "../../lib/theme";

const FEATURES = [
  { icon: "lock", title: "AES-256 sealed", body: "Encrypted before it touches the database." },
  { icon: "pulse", title: "Live health score", body: "Spot weak and reused passwords instantly." },
  { icon: "fingerprint", title: "Biometric unlock", body: "Open your vault with a touch." },
];

/** Shield logo. */
function HeroMark() {
  const { theme } = useTheme();
  return (
    <View style={styles.markWrap}>
      <View style={[styles.mark, { backgroundColor: theme.accent }]}>
        <Icon name="shieldCheck" size={44} color={theme.onAccent} strokeWidth={1.8} />
      </View>
    </View>
  );
}

export default function Welcome() {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Aurora />
      <SafeAreaView style={styles.safe}>
        <FadeIn style={{ alignItems: "center" }}>
          <HeroMark />
        </FadeIn>

        <FadeIn delay={120}>
          <Text style={[styles.eyebrow, { color: theme.accentSoft, fontFamily: theme.font.bodySemi }]}>STASHR</Text>
          <Text style={[styles.title, { color: theme.heading, fontFamily: theme.font.displayHeavy }]}>
            Every password,{"\n"}
            <GradientText>in one safe place.</GradientText>
          </Text>
          <Text style={[styles.body, { color: theme.textMuted, fontFamily: theme.font.body }]}>
            Your vault from the website, now in your pocket. Same account, same server, same encryption.
          </Text>
        </FadeIn>

        <View style={{ gap: 10, marginTop: 22 }}>
          {FEATURES.map((f, i) => (
            <FadeIn key={f.title} delay={220 + i * 90}>
              <View style={[styles.feature, { backgroundColor: theme.surface, borderColor: theme.line }]}>
                <LinearGradient colors={theme.cool} style={styles.featureIcon}>
                  <Icon name={f.icon} size={18} color={theme.onAccent} />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 15 }}>{f.title}</Text>
                  <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 }}>{f.body}</Text>
                </View>
              </View>
            </FadeIn>
          ))}
        </View>

        <View style={{ flex: 1 }} />

        <FadeIn delay={520} style={{ gap: 12 }}>
          <GradientButton title="Create your vault" onPress={() => router.push("/auth/signup")} />
          <GhostButton title="I already have an account" onPress={() => router.push("/auth/login")} />
          <View style={{ alignItems: "center", marginTop: 6 }}>
            <StatusPill compact style={{ alignSelf: "center" }} />
          </View>
        </FadeIn>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: 22, paddingBottom: 16 },
  markWrap: { width: 120, height: 120, alignItems: "center", justifyContent: "center", marginTop: 12, marginBottom: 8 },
  mark: { width: 84, height: 84, borderRadius: 20, alignItems: "center", justifyContent: "center", shadowOpacity: 0, shadowRadius: 30, shadowOffset: { width: 0, height: 14 }, elevation: 0 },
  eyebrow: { fontSize: 12, letterSpacing: 1, marginTop: 8 },
  title: { fontSize: 26, letterSpacing: -0.4, marginTop: 10 },
  body: { fontSize: 15, lineHeight: 23, marginTop: 12 },
  feature: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 18, borderWidth: 1 },
  featureIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
