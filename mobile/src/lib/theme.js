import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Stashr design tokens — the Stashr Universe palette shared with the web app
 * (midnight navy / daylight neutrals, emerald accent, Plus Jakarta Sans). See docs/DESIGN_LANGUAGE.md.
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
    // Midnight navy + emerald: the same palette as the web app (client/src/styles/theme.css).
    bg: "#08121A",
    bgSoft: "#0B161A",
    surface: "#0E1B1F",
    surfaceSolid: "#0E1B1F",
    surfaceRaised: "#132429",
    line: "#1D3134",
    lineStrong: "#2A4447",
    text: "#D9E5E1",
    textMuted: "#9BB0AB",
    textFaint: "#7F958F",
    heading: "#F3F8F6",
    accent: "#22C58F",
    accentSoft: "#3CCF9A",
    onAccent: "#04130E",
    accent2: "#EF4444",
    accent3: "#F5C86A",
    ok: "#3CCF9A",
    warn: "#F59E0B",
    danger: "#FF6B6F",
    brand: ["#22C58F", "#12A37A"],
    cool: ["#2BB3B1", "#2BB3B1"],
    glows: ["transparent", "transparent", "transparent"],
    statusBar: "light",
    shadow: "#000000",
  },
  light: {
    ...shared,
    mode: "light",
    // Daylight: warm off-white and forest green, matching the web light theme.
    bg: "#F5F7F2",
    bgSoft: "#EEF3EC",
    surface: "#FFFFFF",
    surfaceSolid: "#FFFFFF",
    surfaceRaised: "#FFFFFF",
    line: "#DDE5DC",
    lineStrong: "#C6D2C6",
    text: "#1C2B25",
    textMuted: "#4C5F57",
    textFaint: "#5F7269",
    heading: "#0B241A",
    accent: "#0D6E5C",
    accentSoft: "#0F7F7D",
    onAccent: "#FFFFFF",
    accent2: "#D1343A",
    accent3: "#9A6B00",
    ok: "#1D7F4E",
    warn: "#B45309",
    danger: "#D1343A",
    brand: ["#0D6E5C", "#0D6E5C"],
    cool: ["#0F7F7D", "#0F7F7D"],
    glows: ["transparent", "transparent", "transparent"],
    statusBar: "dark",
    shadow: "#0B241A",
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
