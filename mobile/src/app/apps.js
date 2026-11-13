import React from "react";
import { Linking, View } from "react-native";
import { Page } from "../components/kit";
import { Box, Btn, Dim, Row, useAct } from "../components/home/h";
import { activeServer } from "../lib/api";

/** The Stashr apps and where to download them (the server serves the newest build of each). */
const APPS = [
  { key: "android", name: "Stashr", for: "Phone", text: "Passwords, photos, projects, Money and Smart home on your phone (this app)." },
  { key: "hub", name: "Stashr Hub", for: "Home tablet", text: "The always-on tablet: camera alerts, voice commands, Wi-Fi scan, local mode and the WhatsApp sender." },
  { key: "tv", name: "Stashr TV", for: "TV", text: "The TV launcher: movies from Drive, notices, live map and cast receiver." },
  { key: "where", name: "Stashr Location", for: "Family phones", text: "Shares only where the phone is, in the background, with your own Stashr. Runs always-on with a per-phone switch." },
  { key: "cast", name: "Stashr Cast", for: "Phone", text: "Mirror your phone screen to the TV." },
];

export default function Apps() {
  const act = useAct();
  const base = activeServer();
  const open = (key) => act(() => Linking.openURL(`${base}/api/mobile-updates/${key}/download`));
  return (
    <Page title="Apps" subtitle="Download or update any Stashr app. Android will ask you to confirm the install.">
      <View style={{ gap: 14 }}>
        {APPS.map((a) => (
          <Box key={a.key} title={a.name} subtitle={a.for}>
            <Dim>{a.text}</Dim>
            <Row><Btn kind="primary" label="Download the newest build" onPress={() => open(a.key)} /></Row>
          </Box>
        ))}
        <Dim>The Chrome extension and the website are on the Apps page of the website.</Dim>
      </View>
    </Page>
  );
}
