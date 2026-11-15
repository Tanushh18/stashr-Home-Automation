import React, { useEffect } from "react";
import { AppState, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import * as ScreenCapture from "expo-screen-capture";
import { Platform } from "react-native";
import { useFonts } from "expo-font";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Sora_600SemiBold, Sora_700Bold, Sora_800ExtraBold } from "@expo-google-fonts/sora";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { ThemeProvider, useTheme } from "../lib/theme";
import { VaultProvider, useVault } from "../lib/vault";
import { ToastProvider } from "../components/Toast";
import SkyFx from "../components/SkyFx";
import { refreshServers } from "../lib/api";
import "../lib/photoBackground";
import "../lib/moneyBackground";
import { syncIfStale } from "../lib/moneySync";
import { startAutoBackup } from "../lib/photoAuto";

// Load the latest server list from the registry in the background.
refreshServers().catch(() => {});

SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 450, fade: true });

function RootStack({ fontsReady }) {
  const { theme } = useTheme();
  const { status } = useVault();
  const booted = fontsReady && status !== "booting";

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.bg).catch(() => {});
  }, [theme.bg]);

  useEffect(() => {
    if (booted) SplashScreen.hideAsync().catch(() => {});
  }, [booted]);

  // Once the vault is unlocked, keep camera-roll backup going while the app is open.
  useEffect(() => {
    if (status === "ready") startAutoBackup();
  }, [status]);

  // Money: when the app comes to the front (and once it is unlocked), send any new bank SMS to the sheet — at most every 10 minutes.
  useEffect(() => {
    if (status !== "ready") return undefined;
    syncIfStale(10).catch(() => {});
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") syncIfStale(10).catch(() => {}); });
    return () => sub.remove();
  }, [status]);

  // Money: the moment the internet comes back, send any bank SMS that arrived while it was off (at most every 2 minutes).
  useEffect(() => {
    if (status !== "ready") return undefined;
    let sub = null;
    try {
      const Network = require("expo-network");
      if (Network.addNetworkStateListener) sub = Network.addNetworkStateListener((st) => { if (st && st.isInternetReachable) syncIfStale(2).catch(() => {}); });
    } catch (e) { /* no network listener in this build: the app-open and 15-minute checks still run */ }
    return () => { try { if (sub) sub.remove(); } catch (e) { /* already gone */ } };
  }, [status]);

  // No screenshots / screen recording, and a blank preview in recent apps (FLAG_SECURE).
  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    ScreenCapture.preventScreenCaptureAsync("aurelia").catch(() => {});
    return () => {
      ScreenCapture.allowScreenCaptureAsync("aurelia").catch(() => {});
    };
  }, []);

  if (!booted) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  return (
    <>
      <StatusBar style={theme.statusBar} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.bg },
          animation: "fade_from_bottom",
        }}
      >
        <Stack.Protected guard={status === "signedOut"}>
          <Stack.Screen name="auth" />
        </Stack.Protected>
        <Stack.Protected guard={status === "locked"}>
          <Stack.Screen name="lock" options={{ animation: "fade" }} />
        </Stack.Protected>
        <Stack.Protected guard={status === "ready"}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="editor" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="scan" options={{ presentation: "fullScreenModal", animation: "fade" }} />
          <Stack.Screen name="account" options={{ animation: "slide_from_right" }} />
          <Stack.Screen name="photo-viewer" options={{ presentation: "fullScreenModal", animation: "fade" }} />
        </Stack.Protected>
      </Stack>
      {status === "ready" ? <SkyFx /> : null}
    </>
  );
}

export default function RootLayout() {
  const [fontsReady, fontError] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Sora_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <VaultProvider>
          <ToastProvider>
            <RootStack fontsReady={fontsReady || !!fontError} />
          </ToastProvider>
        </VaultProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
