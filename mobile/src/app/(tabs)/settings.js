import React, { useEffect, useState } from "react";
import { Alert, AppState, Linking, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import * as FileSystem from "expo-file-system/legacy";
import { LinearGradient } from "expo-linear-gradient";
import Aurora from "../../components/Aurora";
import Icon from "../../components/Icon";
import StatusPill from "../../components/StatusPill";
import { useToast } from "../../components/Toast";
import { Bounce, Card, Chip, FadeIn, GhostButton, GradientText, tap } from "../../components/ui";
import { useTheme, alpha } from "../../lib/theme";
import { useVault } from "../../lib/vault";
import { api, activeServer } from "../../lib/api";
import { autofillSupported, isServiceEnabled, openAccessibilitySettings, isAutofillServiceEnabled, openAutofillServiceSettings } from "../../../modules/stashr-autofill";

const WEBSITE = "https://password-website.onrender.com";

function getReleaseInfo() {
  const config = Constants.expoConfig || {};
  const createdAt = Updates.createdAt ? new Date(Updates.createdAt) : null;
  const createdAtLabel = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString() : "not reported";
  return {
    version: config.version || "unknown",
    build: Constants.nativeBuildVersion || config.android?.versionCode || "unknown",
    otaVersion: config.extra?.stashrRelease?.otaVersion || process.env.EXPO_PUBLIC_OTA_VERSION || "not tagged",
    channel: "server-managed",
    runtime: Updates.runtimeVersion || (typeof config.runtimeVersion === "string" ? config.runtimeVersion : config.version || "unknown"),
    updateId: Updates.updateId ? Updates.updateId.slice(0, 8) : "embedded",
    launch: "installed APK",
    createdAt: createdAtLabel,
  };
}
const LOCK_OPTIONS = [
  { v: 0.5, label: "30s" },
  { v: 1, label: "1 min" },
  { v: 5, label: "5 min" },
  { v: 15, label: "15 min" },
  { v: -1, label: "Never" },
];

function Row({ icon, title, subtitle, right, onPress, color }) {
  const { theme } = useTheme();
  const body = (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: alpha(color || theme.accent, 0.16) }]}>
        <Icon name={icon} size={18} color={color || theme.accentSoft} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.heading, fontFamily: theme.font.bodySemi, fontSize: 15 }}>{title}</Text>
        {subtitle ? <Text style={{ color: theme.textFaint, fontFamily: theme.font.body, fontSize: 12, marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {right !== undefined ? right : onPress ? <Icon name="arrow" size={16} color={theme.textFaint} /> : null}
    </View>
  );
  return onPress ? <Bounce onPress={onPress} scaleTo={0.98}>{body}</Bounce> : body;
}

function Section({ title, children, delay }) {
  const { theme } = useTheme();
  return (
    <FadeIn delay={delay}>
      <Text style={[styles.section, { color: theme.textFaint, fontFamily: theme.font.bodySemi }]}>{title}</Text>
      <Card style={{ gap: 16 }}>{children}</Card>
    </FadeIn>
  );
}

export default function Settings() {
  const { theme, preference, setPreference } = useTheme();
  const [serviceOn, setServiceOn] = useState(false);
  const [saveOn, setSaveOn] = useState(false);
  const { profile, items, biometric, biometricAvailable, setBiometric, logout, lock, panicLock, prefs, setPrefs, setProfileName, refreshProfile } = useVault();
  const toast = useToast();
  const [name, setName] = useState(profile?.name || "");
  const [updateStatus, setUpdateStatus] = useState("Not checked this session");
  const releaseInfo = getReleaseInfo();

  useEffect(() => {
    if (!autofillSupported) return undefined;
    const check = () => {
      setServiceOn(isServiceEnabled());
      setSaveOn(isAutofillServiceEnabled());
    };
    check();
    const sub = AppState.addEventListener("change", (s) => s === "active" && check());
    return () => sub.remove();
  }, []);

  const saveName = async () => {
    try {
      await api.updateProfile(name.trim());
      setProfileName(name.trim());
      toast("Name updated");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const signOutOthers = async () => {
    try {
      await api.logoutAll();
      await refreshProfile();
      toast("Signed out of every other device", "info");
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const checkUpdates = async () => {
    setUpdateStatus("Checking the Stashr update server…");
    try {
      const currentVersionCode = Number(releaseInfo.build) || 0;
      const base = activeServer().replace(/\/+$/, "");
      const response = await fetch(`${base}/api/mobile-updates/android/latest?currentVersionCode=${currentVersionCode}`, {
        headers: { Accept: "application/json" },
      });
      const manifest = await response.json();
      if (!response.ok) throw new Error(manifest.error || "Update server unavailable");
      const checkedAt = new Date().toLocaleTimeString();
      if (!manifest.updateAvailable) {
        setUpdateStatus(`Checked ${checkedAt}: latest build ${manifest.versionCode} installed`);
        toast(`Stashr ${manifest.version} is up to date`, "info");
        return;
      }
      const sizeMb = manifest.sizeBytes ? (manifest.sizeBytes / (1024 * 1024)).toFixed(1) + " MB" : "size unknown";
      Alert.alert(
        "Stashr update available",
        `Version ${manifest.version} · build ${manifest.versionCode}\n${sizeMb}\n\n${manifest.releaseNotes || "Bug fixes and improvements"}\n\nThe complete APK will be downloaded. Android will ask you to confirm installation.`,
        [
          { text: "Later", style: "cancel" },
          {
            text: "Download & install",
            onPress: async () => {
              try {
                setUpdateStatus(`Downloading build ${manifest.versionCode}…`);
                const destination = `${FileSystem.cacheDirectory}stashr-update-${manifest.versionCode}.apk`;
                const downloaded = await FileSystem.downloadAsync(manifest.downloadUrl, destination);
                if (downloaded.status !== 200) throw new Error(`Download returned HTTP ${downloaded.status}`);
                const info = await FileSystem.getInfoAsync(downloaded.uri);
                if (!info.exists || !info.size || info.size < 1024 * 1024) throw new Error("Downloaded APK is missing or incomplete");
                const contentUri = await FileSystem.getContentUriAsync(downloaded.uri);
                setUpdateStatus(`Build ${manifest.versionCode} downloaded · opening Android installer`);
                await Linking.openURL(contentUri);
                toast("APK downloaded. Confirm installation in Android to update Stashr.", "info");
              } catch (error) {
                setUpdateStatus("APK download/install could not be opened");
                toast(error.message || "Could not download the update", "error");
                try {
                  await Linking.openURL(manifest.downloadUrl);
                } catch (_) {}
              }
            },
          },
        ]
      );
    } catch (error) {
      setUpdateStatus("Update check failed · server or internet unavailable");
      toast("Could not check the Stashr update server. Try again when online.", "error");
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Aurora stars={false} intensity={0.8} />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 130, gap: 16 }} keyboardShouldPersistTaps="handled">
          <FadeIn>
            <Text style={[styles.title, { color: theme.heading, fontFamily: theme.font.displayHeavy }]}>
              <GradientText>Settings</GradientText>
            </Text>
          </FadeIn>

          <FadeIn delay={60}>
            <Card glow style={{ gap: 14 }}>
              <View style={styles.profile}>
                <LinearGradient colors={theme.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
                  <Text style={{ color: "#fff", fontFamily: theme.font.displayHeavy, fontSize: 26 }}>{(profile?.name || "?").charAt(0).toUpperCase()}</Text>
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.heading, fontFamily: theme.font.display, fontSize: 19 }}>{profile?.name || "Your vault"}</Text>
                  <Text style={{ color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13 }}>{profile?.email}</Text>
                  <Text style={{ color: theme.accentSoft, fontFamily: theme.font.bodySemi, fontSize: 12, marginTop: 4 }}>
                    {items.length} items · encrypted
                  </Text>
                </View>
              </View>
              <View style={[styles.nameRow, { borderColor: theme.line }]}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor={theme.textFaint}
                  style={{ flex: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 15 }}
                />
                {name.trim() && name.trim() !== profile?.name ? <Chip label="Save" active onPress={saveName} /> : null}
              </View>
            </Card>
          </FadeIn>

          <Section title="WORKSPACE" delay={80}>
            <Row icon="home" title="Smart home" subtitle="TV, tablet, family locations, camera, scenes and insights" onPress={() => router.push("/home")} />
            <Row icon="note" title="Money" subtitle="UPI and bank payments from your SMS, by category, in your Google Sheet" onPress={() => router.push("/money")} />
            {profile?.features?.smartHome !== false ? <Row icon="mail" title="WhatsApp sender" subtitle="Turn sending on, see when the next message goes, sheets, pictures and every step of each message" onPress={() => router.push("/whatsapp")} /> : null}
            <Row icon="user" title="Shared with me" subtitle="Photo folders other people shared with you" onPress={() => router.push("/shared")} />
            {profile?.features?.projects !== false ? <Row icon="folder" title="Projects" subtitle="Notes, variables and deploy status for each project" onPress={() => router.push("/projects")} /> : null}
            {profile?.features?.servers !== false ? <Row icon="globe" title="Servers" subtitle="Render services: status, deploys, restart" onPress={() => router.push("/servers")} /> : null}
            {profile?.features?.cron !== false ? <Row icon="pulse" title="Monitoring" subtitle="Health checks and incidents" onPress={() => router.push("/monitoring")} /> : null}
            <Row icon="repeat" title="GitHub" subtitle="Accounts used to read your repositories" onPress={() => router.push("/github")} />
            {profile?.features?.photos !== false ? <Row icon="cloud" title="Photo backup and storage" subtitle="Google accounts, camera-roll backup, share links" onPress={() => router.push("/photo-backup")} /> : null}
            {profile?.features?.photos !== false ? <Row icon="user" title="People" subtitle="Photos grouped by face, on this phone only" onPress={() => router.push("/people")} /> : null}
            {profile?.features?.photos !== false ? <Row icon="grid" title="Photo folders" subtitle="Folders mirrored in Google Drive" onPress={() => router.push("/photo-folders")} /> : null}
            {profile?.features?.photos !== false ? <Row icon="image" title="Albums" subtitle="Collections across your accounts" onPress={() => router.push("/albums")} /> : null}
            {profile?.isAdmin ? <Row icon="download" title="App updates" subtitle="Which devices are offered each new app version" onPress={() => router.push("/app-updates")} /> : null}
            {profile?.features?.adminPanel ? <Row icon="user" title="Admin" subtitle="Users and which features each person sees" onPress={() => router.push("/admin")} /> : null}
            <Row icon="download" title="Apps" subtitle="Download or update Stashr Hub, TV, Location and Cast" onPress={() => router.push("/apps")} />
            {profile?.isAdmin ? <Row icon="settings" title="Server URLs" subtitle="Backend addresses and environment sync" onPress={() => router.push("/server-urls")} /> : null}
          </Section>

          <Section title="SECURITY" delay={100}>
            <Row
              icon="fingerprint"
              title="Biometric app lock"
              subtitle={biometricAvailable ? "Require a fingerprint or face check to reopen the app" : "Set up a fingerprint or face unlock on this phone first"}
              right={
                <Switch
                  value={biometric}
                  disabled={!biometricAvailable}
                  onValueChange={async (v) => {
                    tap();
                    try {
                      await setBiometric(v);
                      toast(v ? "Biometric app lock on" : "Biometric app lock off", "info");
                    } catch (e) {
                      if (!/cancel/i.test(e.message || "")) toast(e.message, "error");
                    }
                  }}
                  trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }}
                  thumbColor="#fff"
                />
              }
            />
            {biometric ? (
              <View>
                <Row icon="timer" title="Auto-lock" subtitle="Ask for a fingerprint again after the app has been in the background" color={theme.accent3} right={null} />
                <View style={styles.chips}>
                  {LOCK_OPTIONS.map((o) => <Chip key={o.v} label={o.label} active={prefs.autoLock === o.v} onPress={() => setPrefs({ autoLock: o.v })} />)}
                </View>
              </View>
            ) : null}
            <Row icon="shieldCheck" title="Two-factor login" subtitle={profile?.twoFactorEnabled ? `On · ${profile.recoveryCodesLeft} recovery codes left` : "Off — add a second step to sign in"} color={profile?.twoFactorEnabled ? theme.ok : theme.warn} onPress={() => router.push("/account/twofactor")} />
            <Row icon="key" title="Change password" onPress={() => router.push("/account/password")} />
            {biometric ? <Row icon="lock" title="Lock now" onPress={lock} color={theme.accent2} /> : null}
            {biometric ? <Row icon="lock" title="Panic lock" subtitle="Lock now and clear the vault from memory" onPress={() => panicLock()} color={theme.accent2} /> : null}
            <Row icon="logout" title="Sign out other devices" subtitle={`${Math.max(0, (profile?.sessions || 1) - 1)} other session(s)`} onPress={signOutOthers} color={theme.accent2} />
          </Section>

          {Platform.OS === "android" && autofillSupported ? (
            <Section title="AUTOFILL" delay={120}>
              <Row
                icon="key"
                title="Autofill in other apps"
                subtitle="Show your saved logins when you tap a username or password field"
                right={
                  <Switch
                    value={Boolean(prefs.autofill)}
                    onValueChange={(v) => {
                      tap();
                      setPrefs({ autofill: v });
                      if (v && !serviceOn) openAccessibilitySettings();
                    }}
                    trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }}
                    thumbColor="#fff"
                  />
                }
              />
              {prefs.autofill ? (
                <View>
                  <Row
                    icon="shieldCheck"
                    title={serviceOn ? "Accessibility service is on" : "Turn on the Stashr accessibility service"}
                    subtitle={serviceOn ? "Stashr can see login fields in other apps" : "Tap, then choose Stashr Autofill and switch it on"}
                    color={serviceOn ? theme.ok : theme.warn}
                    onPress={openAccessibilitySettings}
                  />
                  <Row
                    icon="fingerprint"
                    title="Confirm before filling"
                    subtitle="Ask for your fingerprint or screen lock each time"
                    right={
                      <Switch
                        value={prefs.autofillBiometric !== false}
                        onValueChange={(v) => {
                          tap();
                          setPrefs({ autofillBiometric: v });
                        }}
                        trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }}
                        thumbColor="#fff"
                      />
                    }
                  />
                </View>
              ) : null}
              <Row
                icon="download"
                title={saveOn ? "Saving new logins is on" : "Save new logins"}
                subtitle={
                  saveOn
                    ? "Android will ask “Save password to Stashr?” after you sign in somewhere new"
                    : "Tap and choose Stashr as your autofill service. Android will then offer to save logins you type."
                }
                color={saveOn ? theme.ok : theme.warn}
                onPress={openAutofillServiceSettings}
              />
            </Section>
          ) : null}

          <Section title="APPEARANCE" delay={140}>
            <View>
              <Row icon={theme.mode === "dark" ? "moon" : "sun"} title="Theme" subtitle="Dark, light, or follow your phone" right={null} />
              <View style={styles.chips}>
                {["system", "dark", "light"].map((p) => <Chip key={p} label={p[0].toUpperCase() + p.slice(1)} active={preference === p} onPress={() => setPreference(p)} />)}
              </View>
            </View>
            <Row
              icon="globe"
              title="Website icons"
              subtitle="Fetched from DuckDuckGo, which can see which sites you've saved"
              right={<Switch value={prefs.icons} onValueChange={(v) => setPrefs({ icons: v })} trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }} thumbColor="#fff" />}
            />
          </Section>

          <Section title="FUN" delay={165}>
            <Row
              icon="sparkle"
              title="Fun effects"
              subtitle="Robots fly by, planes land when you save, things blow up when something is deleted for good. Off with reduce motion."
              right={<Switch value={prefs.fx !== false} onValueChange={(v) => setPrefs({ fx: v })} trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }} thumbColor="#fff" />}
            />
          </Section>

          <Section title="WEEKLY CHECK" delay={170}>
            <Row
              icon="shield"
              title="Weekly breach check"
              subtitle="Checks your passwords against Have I Been Pwned about once a week. Only the first 5 characters of each password's hash are sent."
              right={<Switch value={Boolean(prefs.autoBreach)} onValueChange={(v) => setPrefs({ autoBreach: v })} trackColor={{ false: alpha(theme.accent, 0.2), true: theme.accent }} thumbColor="#fff" />}
            />
          </Section>

          <Section title="YOUR DATA" delay={180}>
            <Row icon="download" title="Export & import" subtitle="Encrypted backups, CSV, and imports from other managers" onPress={() => router.push("/account/data")} />
            <Row icon="note" title="Privacy policy" onPress={() => Linking.openURL(`${WEBSITE}/privacy`)} />
          </Section>

          <Section title="APP" delay={220}>
            <StatusPill />
            <Row icon="globe" title="Server" subtitle={activeServer().replace(/^https?:\/\//, "")} color={theme.ok} right={null} />
            <Row
              icon="refresh"
              title="Check for updates"
              subtitle={`App ${releaseInfo.version} · Build ${releaseInfo.build}\nDelivery: complete APK from Stashr server\nChannel: ${releaseInfo.channel} · ${releaseInfo.launch}\n${updateStatus}`}
              onPress={checkUpdates}
            />
            <Row icon="phone" title="Open the website" subtitle="Same vault, bigger screen" onPress={() => Linking.openURL(WEBSITE)} />
          </Section>

          <FadeIn delay={260} style={{ gap: 10 }}>
            <GhostButton
              title="Sign out"
              icon="logout"
              color={theme.danger}
              onPress={() =>
                Alert.alert("Sign out?", "You'll need your master password to get back in.", [
                  { text: "Stay", style: "cancel" },
                  { text: "Sign out", style: "destructive", onPress: logout },
                ])
              }
            />
            <GhostButton title="Delete account" icon="trash" color={theme.textFaint} small onPress={() => router.push("/account/delete")} />
            <Text style={{ textAlign: "center", color: theme.textFaint, fontFamily: theme.font.body, fontSize: 12 }}>
              Stashr {Constants.expoConfig?.version || "1.0.0"} · your keys, your vault
            </Text>
          </FadeIn>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, letterSpacing: -0.4, marginTop: 6 },
  profile: { flexDirection: "row", alignItems: "center", gap: 16 },
  avatar: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, paddingTop: 12 },
  section: { fontSize: 12, letterSpacing: 0.4, marginBottom: 8, marginLeft: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10, marginLeft: 50 },
});
