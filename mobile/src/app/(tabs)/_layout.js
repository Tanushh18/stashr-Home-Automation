import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Tabs, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "../../components/Icon";
import { Bounce, tap } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";

const ICONS = { index: "vault", health: "pulse", generator: "wand", settings: "settings" };
const LABELS = { index: "Vault", health: "Health", generator: "Generate", settings: "Settings" };

/** Docked bottom tab bar with a centre "add" button. */
function VaultTabBar({ state, navigation }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const tabs = state.routes.map((route, i) => {
    const focused = state.index === i;
    return (
      <Pressable
        key={route.key}
        style={styles.tab}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={LABELS[route.name]}
        onPress={() => {
          tap();
          const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
        }}
      >
        <View style={[styles.pill, focused && { backgroundColor: alpha(theme.accent, theme.mode === "dark" ? 0.16 : 0.12) }]}>
          <Icon name={ICONS[route.name]} size={22} color={focused ? theme.accent : theme.textMuted} strokeWidth={focused ? 2.1 : 1.7} />
        </View>
        <Text style={{ fontSize: 11, marginTop: 4, color: focused ? theme.heading : theme.textMuted, fontFamily: focused ? theme.font.bodySemi : theme.font.bodyMedium }}>
          {LABELS[route.name]}
        </Text>
      </Pressable>
    );
  });

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom, backgroundColor: theme.surfaceSolid }]} pointerEvents="box-none">
      <View style={[styles.bar, { backgroundColor: theme.surfaceSolid, borderColor: theme.line }]}>
        {tabs.slice(0, 2)}
        <View style={styles.tab}>
          <Bounce
            onPress={() => router.push("/editor")}
            accessibilityRole="button"
            accessibilityLabel="Add item"
            style={[styles.fab, { backgroundColor: theme.accent, shadowColor: theme.accent }]}
          >
            <Icon name="plus" size={26} color={theme.onAccent} strokeWidth={2.4} />
          </Bounce>
        </View>
        {tabs.slice(2)}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { theme } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <VaultTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.bg } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="health" />
      <Tabs.Screen name="generator" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bar: { flexDirection: "row", height: 72, borderTopWidth: StyleSheet.hairlineWidth, alignItems: "center", paddingHorizontal: 4 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", height: "100%" },
  pill: { width: 56, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  fab: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
