import React, { useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Clipboard from "expo-clipboard";
import { Page, Note } from "../components/kit";
import { Box, Btn, Dim, Row, Sub, Txt, useAct } from "../components/home/h";

/*
 * Phone setup: a checklist that makes a phone fast and keeps payments working. An app cannot switch other apps or system services off by
 * itself (Android only lets that happen with a computer and USB/Wi-Fi debugging, or root), so each step opens the exact Android screen
 * where the change is made, and "Done" remembers it. Nothing here reads your apps or sends anything anywhere.
 */
const KEY = "stashr.phoneSetup.done";

const open = (action) => (Platform.OS === "android" ? Linking.sendIntent(action) : Linking.openSettings());

const STEPS = [
  { id: "home", title: "Make Stashr Launcher your Home app", why: "Without this the old home screen keeps opening.", action: "android.settings.HOME_SETTINGS", button: "Choose Home app",
    help: "Pick Stashr Launcher. Your layout is kept; you can switch back any time." },
  { id: "access", title: "Switch OFF every Accessibility service", why: "Google Pay, PhonePe and bank apps refuse to run while an accessibility service is on. Stashr Launcher locks the screen with Device admin instead, so it never needs one.", action: "android.settings.ACCESSIBILITY_SETTINGS", button: "Open Accessibility",
    help: "Installed apps → turn each one off. Then try a payment." },
  { id: "battery", title: "Let Stashr apps run in the background", why: "Phones (OPPO, Xiaomi, Vivo) stop background apps; Stashr Location then goes quiet.", action: "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS", button: "Open battery settings",
    help: "Set Stashr, Stashr Location and Stashr Launcher to Unrestricted / Don't optimise. OPPO/ColorOS: also Settings → Apps → the app → Auto-start ON." },
  { id: "unused", title: "Remove or disable apps you do not use", why: "Every app you never open still wakes up, uses memory and slows the phone.", action: "android.settings.MANAGE_ALL_APPLICATIONS_SETTINGS", button: "Open all apps",
    help: "Uninstall what you do not need. Pre-installed apps that cannot be uninstalled: choose Disable. Do not disable anything you do not recognise." },
  { id: "anim", title: "Halve the animation time (feels much faster)", why: "Windows and transitions finish in half the time. Reversible.", action: "android.settings.APPLICATION_DEVELOPMENT_SETTINGS", button: "Open Developer options",
    help: "Settings → About phone → tap Build number 7 times; then Developer options → Window / Transition / Animator duration scale = 0.5x." },
  { id: "storage", title: "Free up storage", why: "A phone with less than 10% free storage slows down.", action: "android.settings.INTERNAL_STORAGE_SETTINGS", button: "Open storage",
    help: "Clear cached data, old downloads and videos. Photos can go to the Stashr photo backup first." },
  { id: "restart", title: "Restart the phone once a week", why: "Clears memory leaks that build up in a week.", action: null, button: "", help: "Hold Power → Restart." },
];

const ADB = `# Run on a computer with USB debugging on (Developer options). Reversible: set the three values back to 1.
adb shell settings put global window_animation_scale 0.5
adb shell settings put global transition_animation_scale 0.5
adb shell settings put global animator_duration_scale 0.5
# See what is installed (read-only), then decide yourself what to disable:
adb shell pm list packages -3
# Disable one app for this user (undo: adb shell pm enable <package>):
# adb shell pm disable-user --user 0 <package>`;

export default function PhoneSetup() {
  const act = useAct();
  const [done, setDone] = useState({});
  useEffect(() => { (async () => { try { setDone(JSON.parse((await SecureStore.getItemAsync(KEY)) || "{}")); } catch (e) { setDone({}); } })(); }, []);
  const mark = async (id, on) => {
    const next = { ...done, [id]: on };
    setDone(next);
    try { await SecureStore.setItemAsync(KEY, JSON.stringify(next)); } catch (e) { /* the tick is only a reminder */ }
  };
  const left = STEPS.filter((s) => !done[s.id]).length;
  return (
    <Page title="Phone setup" subtitle="Make this phone fast, keep payments working, set Stashr Launcher as Home.">
      <View style={{ gap: 14 }}>
        <Note tone={left ? "mute" : "ok"}>{left ? `${left} step${left === 1 ? "" : "s"} left. Each button opens the right Android screen.` : "All done. The phone is set up."}</Note>
        {STEPS.map((s, i) => (
          <Box key={s.id} title={`${done[s.id] ? "✓ " : `${i + 1}. `}${s.title}`}>
            <Dim>{s.why}</Dim>
            <Dim>{s.help}</Dim>
            <Row>
              {s.action ? <Btn label={s.button} kind="primary" onPress={() => act(() => open(s.action), undefined)} /> : null}
              <Btn label={done[s.id] ? "Not done" : "Done"} onPress={() => mark(s.id, !done[s.id])} />
            </Row>
          </Box>
        ))}
        <Box title="From a computer (optional)">
          <Dim>Android only lets services and system apps be switched off from a computer. This script halves animations and lists your apps; it never disables anything by itself.</Dim>
          <Sub>Script</Sub>
          <Txt>{ADB}</Txt>
          <Row><Btn label="Copy the script" onPress={() => act(() => Clipboard.setStringAsync(ADB), "Copied")} /></Row>
        </Box>
      </View>
    </Page>
  );
}
