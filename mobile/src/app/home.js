import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Page, Loading, Note } from "../components/kit";
import { Chip } from "../components/ui";
import { useToast } from "../components/Toast";
import { home } from "../lib/homeApi";
import { Boundary, usePoll } from "../components/home/h";
import Overview from "../components/home/Overview";
import Devices from "../components/home/Devices";
import Security from "../components/home/Security";
import Automations from "../components/home/Automations";
import Insights from "../components/home/Insights";
import Media from "../components/home/Media";
import Health from "../components/home/Health";

const TABS = [["overview", "Overview"], ["devices", "Devices"], ["security", "Camera & alerts"], ["automations", "Automations"], ["insights", "Insights"], ["media", "Media & network"], ["health", "Health"]];
const KEY = "stashr.home.tab";
const VIEWS = { overview: Overview, devices: Devices, security: Security, automations: Automations, insights: Insights, media: Media, health: Health };

/** Smart home: the same sections as the website's Smart home page, drawn natively. */
export default function SmartHome() {
  const toast = useToast();
  const [tab, setTab] = useState("overview");
  const [devices, setDevices] = useState(null);
  const [people, setPeople] = useState([]);
  const [events, setEvents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const scroller = useRef(null);
  // ?tab=devices / ?tab=security from a long-press shortcut wins over the remembered tab.
  const { tab: linked } = useLocalSearchParams();

  useEffect(() => {
    if (TABS.some(([k]) => k === linked)) { setTab(linked); return; }
    SecureStore.getItemAsync(KEY).then((t) => { if (TABS.some(([k]) => k === t)) setTab(t); }).catch(() => {});
  }, [linked]);
  const go = useCallback((t) => { setTab(t); SecureStore.setItemAsync(KEY, t).catch(() => {}); }, []);

  const reload = useCallback(async () => {
    try {
      const [d, e] = await Promise.all([home.devices(), home.events(30)]);
      setDevices(d.devices); setPeople(d.people || []); setEvents(e.events || []); setError("");
    } catch (err) { setError(err.message || "Could not load your devices."); }
  }, []);
  const loadSettings = useCallback(async () => { try { setSettings(await home.settings()); } catch { /* cards stay hidden */ } }, []);
  useEffect(() => { loadSettings(); }, [loadSettings]);
  usePoll(reload, 15000);

  const save = useCallback(async (body, done = "Saved.") => {
    try { setSettings(await home.saveSettings(body)); if (done) toast(done); return true; }
    catch (e) { toast(e.message || "Could not save.", "error"); return false; }
  }, [toast]);

  const refresh = async () => { setRefreshing(true); await Promise.all([reload(), loadSettings()]); setRefreshing(false); };
  const View_ = VIEWS[tab] || Overview;
  const ctx = { devices: devices || [], people, events, settings, setSettings, save, reload, go, loadSettings };

  return (
    <Page title="Smart home" subtitle="Your TV, the Wi-Fi, the family's phones and the tablet camera, from anywhere." onRefresh={refresh} refreshing={refreshing}>
      {error ? <Note tone="bad">{error}</Note> : null}
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
        {TABS.map(([k, label]) => <Chip key={k} label={label} active={tab === k} onPress={() => go(k)} />)}
      </ScrollView>
      {devices === null && !error ? <Loading /> : (
        <View style={{ gap: 14 }}>
          <Boundary key={tab} name="This section"><View_ ctx={ctx} /></Boundary>
        </View>
      )}
    </Page>
  );
}
