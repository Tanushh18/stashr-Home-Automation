import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Stashr design tokens — clean modern system generated with the
 * UI UX Pro Max skill (slate neutrals, Stashr green accent, Plus Jakarta Sans).
 * `onAccent` is the text/icon colour to use on a solid accent fill.
 */
const shared = {
  radius: { sm: 10, md: 12, lg: 16, xl: 20, pill: 999 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  touch: 48, // Android minimum touch target (dp)
  font: {
    display: "PlusJakartaSans_700Bold",
    displayHeavy: "PlusJakartaSans_800ExtraBold",
    displayMedium: "PlusJakartaSans_600SemiBold",
    body: "PlusJakartaSans_400Regular",
    bodyMedium: "PlusJakartaSans_500Medium",
    bodySemi: "PlusJakartaSans_600SemiBold",
    bodyBold: "PlusJakartaSans_700Bold",
    mono: "monospace",
  },
};

// `brand`/`cool` stay as two-stop arrays for older callers; both stops are the same solid colour.
export const themes = {
  dark: {
    ...shared,
    mode: "dark",
    bg: "#0B1120",
    bgSoft: "#0F172A",
    surface: "#131C2E",
    surfaceSolid: "#131C2E",
    surfaceRaised: "#1B2336",
    line: "#1F2A3D",
    lineStrong: "#334155",
    text: "#E2E8F0",
    textMuted: "#94A3B8",
    textFaint: "#7C8BA1",
    heading: "#F8FAFC",
    accent: "#22C55E",
    accentSoft: "#4ADE80",
    onAccent: "#052E16",
    accent2: "#EF4444",
    accent3: "#F59E0B",
    ok: "#22C55E",
    warn: "#F59E0B",
    danger: "#EF4444",
    brand: ["#22C55E", "#22C55E"],
    cool: ["#22C55E", "#22C55E"],
    glows: ["transparent", "transparent", "transparent"],
    statusBar: "light",
    shadow: "#000000",
  },
  light: {
    ...shared,
    mode: "light",
    bg: "#F8FAFC",
    bgSoft: "#F1F5F9",
    surface: "#FFFFFF",
    surfaceSolid: "#FFFFFF",
    surfaceRaised: "#FFFFFF",
    line: "#E2E8F0",
    lineStrong: "#CBD5E1",
    text: "#1E293B",
    textMuted: "#475569",
    textFaint: "#64748B",
    heading: "#0F172A",
    accent: "#0D6E5C",
    accentSoft: "#0F7F6A",
    onAccent: "#FFFFFF",
    accent2: "#DC2626",
    accent3: "#B45309",
    ok: "#15803D",
    warn: "#B45309",
    danger: "#DC2626",
    brand: ["#0D6E5C", "#0D6E5C"],
    cool: ["#0D6E5C", "#0D6E5C"],
    glows: ["transparent", "transparent", "transparent"],
    statusBar: "dark",
    shadow: "#0F172A",
  },
};

const KEY = "aurelia_theme";
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const system = useColorScheme();
  const [preference, setPreference] = useState("system"); // system | dark | light

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((v) => {
        if (v === "dark" || v === "light" || v === "system") setPreference(v);
      })
      .catch(() => {});
  }, []);

  const value = useMemo(() => {
    const mode = preference === "system" ? (system === "light" ? "light" : "dark") : preference;
    return {
      theme: themes[mode],
      preference,
      setPreference: (p) => {
        setPreference(p);
        SecureStore.setItemAsync(KEY, p).catch(() => {});
      },
    };
  }, [preference, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Adds alpha to a #RRGGBB colour. */
export const alpha = (hex, a) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
