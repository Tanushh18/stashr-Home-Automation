import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Aurora from "../components/Aurora";
import Icon from "../components/Icon";
import { Bounce, GhostButton } from "../components/ui";
import { useTheme } from "../lib/theme";
import { useVault } from "../lib/vault";

/** App is locked: a fingerprint/face check gates re-entry (no password needed). */
export default function Lock() {
  const { theme } = useTheme();
  const { unlockWithBiometrics, logout, profile } = useVault();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;

  const bio = async () => {
    try {
      setBusy(true);
      setError("");
      await unlockWithBiometrics();
    } catch (e) {
      if (!/cancel/i.test(e.message || "")) setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true })).start();
    const t = setTimeout(bio, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ring = (d) => ({
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5 - d, 0] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2 + d] }) }],
  });
  const first = (profile?.name || "").split(" ")[0];

  return (
    <View style={{ flex: 1 }}>
      <Aurora />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.center}>
              <Animated.View style={[styles.ring, { borderColor: theme.accent }, ring(0)]} />
              <Animated.View style={[styles.ring, { borderColor: theme.accent2 }, ring(0.2)]} />
              <Bounce onPress={bio} scaleTo={0.9}>
                <LinearGradient colors={theme.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.button, { shadowColor: theme.accent }]}>
                  <Icon name="fingerprint" size={48} color={theme.onAccent} strokeWidth={1.6} />
                </LinearGradient>
              </Bounce>
            </View>
            <Text style={[styles.title, { color: theme.heading, fontFamily: theme.font.displayHeavy }]}>
              {first ? `Hi ${first}` : "App locked"}
            </Text>
            <Text style={[styles.sub, { color: theme.textMuted, fontFamily: theme.font.body }]}>
              {error || "Touch the sensor to continue."}
            </Text>

            <View style={{ alignSelf: "stretch", marginTop: 26 }}>
              <GhostButton title={busy ? "Checking…" : "Try again"} icon="fingerprint" loading={busy} onPress={bio} />
              <GhostButton title="Sign out" icon="logout" color={theme.textMuted} onPress={logout} style={{ marginTop: 10 }} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: 22, alignItems: "center", justifyContent: "center" },
  center: { width: 180, height: 180, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", width: 110, height: 110, borderRadius: 55, borderWidth: 2 },
  button: { width: 110, height: 110, borderRadius: 55, alignItems: "center", justifyContent: "center", shadowOpacity: 0, shadowRadius: 30, elevation: 0 },
  title: { fontSize: 24, marginTop: 16, letterSpacing: -0.4 },
  sub: { fontSize: 15, marginTop: 8, textAlign: "center", lineHeight: 22 },
});
