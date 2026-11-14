import React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Icon from "./Icon";
import { Card, Collapsible, ExpandableText, IconButton } from "./ui";
import { useTheme, alpha } from "../lib/theme";

/* Plain building blocks for the workspace screens: a header, flat cards, list rows and status text. */

export function Page({ title, subtitle, onRefresh, refreshing = false, back = true, right, children, bottom = 40 }) {
  const { theme } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <ScrollView
          contentContainerStyle={{ padding: 18, paddingBottom: bottom, gap: 14 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} /> : undefined}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 4 }}>
            {back ? <IconButton name="back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/settings"))} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 24, letterSpacing: -0.3 }} numberOfLines={1}>{title}</Text>
              {subtitle ? <ExpandableText lines={2} style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 18, marginTop: 2 }}>{subtitle}</ExpandableText> : null}
            </View>
            {right}
          </View>
          {sectioned(children)}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/**
 * Turns every top-level <Heading> on a Page into a dropdown: the heading and everything after it (up to the next
 * Heading) open and close together. Screens get collapsible sections without changing their own code.
 */
function sectioned(children) {
  const items = React.Children.toArray(children);
  if (!items.some((c) => c?.type === Heading)) return children;
  const out = [];
  let cur = null;
  items.forEach((c, i) => {
    if (c?.type === Heading) {
      cur = { key: c.key || `h${i}`, title: c.props.children, action: c.props.action, body: [] };
      out.push(cur);
    } else if (cur) cur.body.push(c);
    else out.push(c);
  });
  return out.map((x) =>
    x && x.body ? (
      <Collapsible key={x.key} card={false} title={x.title} right={x.action}>
        {x.body}
      </Collapsible>
    ) : (
      x
    )
  );
}

export function Heading({ children, action }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
      <Text style={{ flex: 1, color: theme.textMuted, fontFamily: theme.font.bodySemi, fontSize: 12, letterSpacing: 0.4 }}>{String(children).toUpperCase()}</Text>
      {action}
    </View>
  );
}

export function Line({ title, subtitle, right, onPress, icon, last }) {
  const { theme } = useTheme();
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: last ? 0 : 1, borderColor: theme.line }}>
      {icon ? <Icon name={icon} size={18} color={theme.textMuted} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.heading, fontFamily: theme.font.bodyMedium, fontSize: 15 }} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          onPress ? (
            <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{subtitle}</Text>
          ) : (
            <ExpandableText lines={2} style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, lineHeight: 17, marginTop: 2 }}>{subtitle}</ExpandableText>
          )
        ) : null}
      </View>
      {right}
      {onPress && right === undefined ? <Icon name="arrow" size={16} color={theme.textFaint} /> : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} android_ripple={{ color: alpha(theme.accent, 0.1) }}>{body}</Pressable> : body;
}

/** A card whose children are Line rows (the last row loses its divider). */
export function Group({ children }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return <Card style={{ paddingVertical: 2, paddingHorizontal: 16 }}>{items.map((c, i) => React.cloneElement(c, { last: i === items.length - 1 }))}</Card>;
}

const TONES = (theme) => ({ ok: theme.ok, warn: theme.warn, bad: theme.danger, mute: theme.textMuted });
export function Status({ text, tone = "mute" }) {
  const { theme } = useTheme();
  const c = TONES(theme)[tone] || theme.textMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
      <Text style={{ color: c, fontFamily: theme.font.bodyMedium, fontSize: 12 }}>{text}</Text>
    </View>
  );
}

export function Note({ children, tone = "mute" }) {
  const { theme } = useTheme();
  const c = TONES(theme)[tone] || theme.textMuted;
  return (
    <View style={{ borderLeftWidth: 3, borderColor: c, paddingLeft: 12, paddingVertical: 8, paddingRight: 10, backgroundColor: alpha(c, 0.07), borderRadius: 8 }}>
      {typeof children === "string" ? (
        <ExpandableText lines={4} style={{ color: theme.text, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19 }}>{children}</ExpandableText>
      ) : (
        <Text style={{ color: theme.text, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19 }}>{children}</Text>
      )}
    </View>
  );
}

export function Empty({ title, children }) {
  const { theme } = useTheme();
  return (
    <View style={{ paddingVertical: 28, alignItems: "center", gap: 6 }}>
      <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 16 }}>{title}</Text>
      {children ? <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, textAlign: "center", lineHeight: 19 }}>{children}</Text> : null}
    </View>
  );
}

export const Loading = () => {
  const { theme } = useTheme();
  return <ActivityIndicator color={theme.accent} style={{ marginVertical: 28 }} />;
};

export const ago = (value) => {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
};

export const gb = (v) => (v == null ? "–" : `${Number(v).toFixed(Number(v) >= 10 ? 0 : 1)} GB`);
