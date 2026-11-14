import React, { useEffect, useRef, useState } from "react";
import { Animated, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTheme, alpha } from "../lib/theme";
import { strengthColor } from "../lib/strength";
import { domainOf, openableUrl, typeOf, FIELD_DEFS, TYPE_LABELS } from "../lib/items";
import { useToast } from "./Toast";
import { Badge, Card, ExpandableText, IconButton, tap } from "./ui";
import ItemAvatar from "./ItemAvatar";
import TotpCode from "./TotpCode";
import Icon from "./Icon";

const AUTO_HIDE_MS = 20000;
const CLIPBOARD_CLEAR_MS = 30000;

export const timeAgo = (date) => {
  if (!date) return "";
  const s = Math.max(1, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  if (s < 31536000) return `${Math.floor(s / 2592000)}mo ago`;
  return `${Math.floor(s / 31536000)}y ago`;
};

/** Copies and wipes the clipboard again after 30s if it still holds the secret. */
export async function copySecret(value, label, toast) {
  await Clipboard.setStringAsync(value);
  toast(`${label} copied · clears in 30s`, "info");
  setTimeout(async () => {
    try {
      if ((await Clipboard.getStringAsync()) === value) await Clipboard.setStringAsync("");
    } catch (e) {
      /* ignore */
    }
  }, CLIPBOARD_CLEAR_MS);
}

export default function ItemCard({ item, info, icons, onEdit, onFavorite, selecting = false, selected = false, onSelect, index = 0 }) {
  const { theme } = useTheme();
  const toast = useToast();
  const [shown, setShown] = useState(false);
  const [revealed, setRevealed] = useState({});
  const kind = typeOf(item);
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(appear, { toValue: 1, delay: Math.min(index, 10) * 50, useNativeDriver: true, speed: 12, bounciness: 6 }).start();
  }, [appear, index]);

  useEffect(() => {
    if (!shown) return undefined;
    const t = setTimeout(() => setShown(false), AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [shown]);

  const domain = domainOf(item.url);
  const translateY = appear.interpolate({ inputRange: [0, 1], outputRange: [22, 0] });

  return (
    <Animated.View style={{ opacity: appear, transform: [{ translateY }], marginBottom: 14 }}>
      <Card style={{ padding: 16, ...(selected ? { borderColor: theme.accent, borderWidth: 2 } : null) }}>
        <View style={styles.head}>
          {selecting ? (
            <Pressable
              onPress={() => { tap(); onSelect && onSelect(); }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`Select ${item.name || "item"}`}
              style={[styles.check, { borderColor: selected ? theme.accent : theme.line, backgroundColor: selected ? theme.accent : "transparent" }]}
            >
              {selected ? <Icon name="check" size={14} color="#fff" /> : null}
            </Pressable>
          ) : null}
          <ItemAvatar name={item.name} url={item.url} icons={icons} />
          <Pressable style={{ flex: 1 }} onPress={onEdit}>
            <Text numberOfLines={1} style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 17 }}>
              {item.name || "Untitled"}
            </Text>
            <Text
              numberOfLines={1}
              onPress={domain ? () => Linking.openURL(openableUrl(item.url)) : undefined}
              style={{ color: domain ? theme.accentSoft : theme.textMuted, fontFamily: theme.font.body, fontSize: 13, marginTop: 2 }}
            >
              {domain || (item.folder ? `📁 ${item.folder}` : "No website")}
            </Text>
          </Pressable>
          <IconButton name={item.favorite ? "starFill" : "star"} size={34} iconSize={16} color={item.favorite ? theme.warn : undefined} onPress={onFavorite} />
          <IconButton name="pencil" size={34} iconSize={15} onPress={onEdit} />
        </View>

        <View style={styles.badges}>
          {info ? (
            <>
              <Badge text={info.label} color={strengthColor(theme, info.score)} icon={info.score >= 3 ? "shieldCheck" : "alert"} />
              {info.breached ? <Badge text="Breached" color={theme.danger} icon="alert" /> : null}
              {info.reused ? <Badge text="Reused" color={theme.warn} icon="repeat" /> : null}
              {info.old ? <Badge text="Old" color={theme.accent3} icon="clock" /> : null}
            </>
          ) : null}
          {kind !== "login" ? <Badge text={TYPE_LABELS[kind]} color={theme.accent3} icon="shieldCheck" /> : null}
          {kind === "login" && item.notes ? <Badge text="Note" color={theme.textFaint} icon="note" /> : null}
          <Text style={{ marginLeft: "auto", color: theme.textFaint, fontSize: 11, fontFamily: theme.font.body }}>
            {timeAgo(item.updatedAt || item.createdAt)}
          </Text>
        </View>

        {kind !== "login" ? (
          <>
            {(FIELD_DEFS[kind] || []).filter((d) => (item.fields || {})[d.key]).map((d) => {
              const value = item.fields[d.key];
              const hide = d.secret && !revealed[d.key];
              return (
                <View key={d.key} style={[styles.row, { borderColor: theme.line }]}>
                  <Text style={{ color: theme.textFaint, fontFamily: theme.font.bodySemi, fontSize: 11, width: 74 }} numberOfLines={1}>{d.label}</Text>
                  <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 14 }}>{hide ? `•••• ${value.slice(-4)}` : value}</Text>
                  {d.secret ? <IconButton name={hide ? "eye" : "eyeOff"} size={32} iconSize={14} onPress={() => { tap(); setRevealed((r) => ({ ...r, [d.key]: !r[d.key] })); }} /> : null}
                  <IconButton name="copy" size={32} iconSize={14} onPress={() => { tap(); copySecret(value, d.label, toast); }} />
                </View>
              );
            })}
            {kind === "note" && item.notes ? (
              <View style={{ marginTop: 10 }}><ExpandableText lines={4} style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19 }}>{item.notes}</ExpandableText></View>
            ) : null}
          </>
        ) : null}

        {item.username ? (
          <View style={[styles.row, { borderColor: theme.line }]}>
            <Icon name="user" size={15} color={theme.textFaint} />
            <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 14 }}>{item.username}</Text>
            <IconButton name="copy" size={32} iconSize={14} onPress={() => { tap(); copySecret(item.username, "Username", toast); }} />
          </View>
        ) : null}

        {item.password ? (
          <View style={[styles.row, { borderColor: shown ? alpha(theme.ok, 0.5) : theme.line, backgroundColor: alpha(theme.accent, 0.07) }]}>
            <Icon name="key" size={15} color={theme.textFaint} />
            <Pressable style={{ flex: 1 }} onPress={() => { tap(); setShown((v) => !v); }}>
              <Text
                numberOfLines={1}
                style={{ color: shown ? theme.heading : theme.textMuted, fontFamily: theme.font.mono, fontSize: shown ? 15 : 17, letterSpacing: shown ? 0.4 : 3 }}
              >
                {shown ? item.password : "••••••••••"}
              </Text>
            </Pressable>
            <IconButton name={shown ? "eyeOff" : "eye"} size={32} iconSize={14} active={shown} onPress={() => { tap(); setShown((v) => !v); }} />
            <IconButton name="copy" size={32} iconSize={14} onPress={() => { tap(); copySecret(item.password, `${item.name || "Password"}`, toast); }} />
          </View>
        ) : null}

        {item.totp ? (
          <View style={{ marginTop: 10 }}>
            <TotpCode secret={item.totp} />
          </View>
        ) : null}
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  check: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 12, marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, paddingLeft: 12, paddingRight: 6, paddingVertical: 5, minHeight: 46, marginTop: 8 },
});
