import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Stashr design tokens — the same palette as the website
 * (client/src/styles/theme.css), tuned for native.
 */
const shared = {
  radius: { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 },
  font: {
    display: "Inter_700Bold",
    displayHeavy: "Inter_700Bold",
    displayMedium: "Inter_600SemiBold",
    body: "Inter_400Regular",
    bodyMedium: "Inter_500Medium",
    bodySemi: "Inter_600SemiBold",
    bodyBold: "Inter_700Bold",
    mono: "monospace",
  },
};

// Flat palette: neutral greys plus one teal accent. `brand`/`cool` stay as
// two-stop arrays for older callers but both stops are the same solid colour.
export const themes = {
  dark: {
    ...shared,
    mode: "dark",
    bg: "#0F1113",
    bgSoft: "#15181B",
    surface: "#171A1D",
    surfaceSolid: "#171A1D",
    surfaceRaised: "#1D2125",
    line: "#262A2F",
    lineStrong: "#353A40",
    text: "#E2E5E8",
    textMuted: "#9BA1A8",
    textFaint: "#6B7178",
    heading: "#F4F5F6",
    accent: "#2BB3B1",
    accentSoft: "#4CC6C4",
    accent2: "#E5484D",
    accent3: "#D4A72C",
    ok: "#30A46C",
    warn: "#D4A72C",
    danger: "#E5484D",
    brand: ["#2BB3B1", "#2BB3B1"],
    cool: ["#2BB3B1", "#2BB3B1"],
    glows: ["transparent", "transparent", "transparent"],
    statusBar: "light",
    shadow: "#000000",
  },
  light: {
    ...shared,
    mode: "light",
    bg: "#F6F7F9",
    bgSoft: "#EEF0F3",
    surface: "#FFFFFF",
    surfaceSolid: "#FFFFFF",
    surfaceRaised: "#FFFFFF",
    line: "#E3E6EA",
    lineStrong: "#CFD4DA",
    text: "#1F2937",
    textMuted: "#5B6472",
    textFaint: "#8A929E",
    heading: "#111827",
    accent: "#0F7F7D",
    accentSoft: "#0F7F7D",
    accent2: "#D1343A",
    accent3: "#9A6B00",
    ok: "#1D7F4E",
    warn: "#9A6B00",
    danger: "#D1343A",
    brand: ["#0F7F7D", "#0F7F7D"],
    cool: ["#0F7F7D", "#0F7F7D"],
    glows: ["transparent", "transparent", "transparent"],
    statusBar: "dark",
    shadow: "#111827",
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
