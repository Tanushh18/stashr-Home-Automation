import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Ambience from "../../Components/Ambience/Ambience";
import { publicApiBase } from "../../api/client";
import "./Apps.css";

const EXT = { file: "/apps/stashr-extension.zip", version: "1.0.2" };
// The main app is always the newest GitHub release, served by the API like the other apps (no old copy kept on this site).
// If the API cannot reach GitHub, the direct GitHub link below still works.
const APK = {
  file: `${publicApiBase}/api/mobile-updates/android/download`,
  github: "https://github.com/Tanushh18/stashr-Home-Automation/releases/latest/download/stashr-release.apk",
};

// Stashr Hub is built by GitHub Actions (hub-apk.yml) and served by the API from the newest GitHub release.
const HUB_APK = `${publicApiBase}/api/mobile-updates/hub/download`;
const HUB_TABLET = [
  "Finds the real names of devices on your Wi-Fi, so a phone keeps its name when its IP changes",
  "Camera alerts: a photo and a short clip to Telegram when someone comes into view",
  "“Hey Stashr” voice commands in Hindi or English, and songs through YouTube Music on your Premium account",
  "A home dashboard and a photo slideshow from a Google Drive folder",
  "Hourly internet speed tests, open-port checks and Wake-on-LAN for your computer",
];
const HUB_PHONE = [
  "Battery, charging, storage and memory, sent to Stashr about every 15 minutes",
  "Shows who is home when the phone is on the home Wi-Fi",
  "No location and no passwords: for the location use the separate Stashr Location app below",
];

// Stashr TV: the Android TV launcher and movie sync (built by tv-apk.yml, served like Stashr Hub).
const TV_APK = `${publicApiBase}/api/mobile-updates/tv/download`;
const TV = [
  "A simple home screen for the TV: all your apps in one row (Netflix, Prime, JioHotstar, YouTube…) and your movies in another",
  "Movie sync: movies you put in your Google Drive folder download to the TV’s USB drive by themselves, with resume, and play in a built-in player that remembers where you stopped",
  "Control from anywhere: volume, play/pause, open an app or a YouTube link from the Stashr website, Telegram or by voice through the tablet",
  "Shows short messages on top of whatever is playing, such as “Parveen is arriving in 15 mins” and “Open the door”",
  "Tells Stashr when the TV is on, what is playing, and how long the TV has been watched today",
];

// Stashr Cast: shows the phone screen on the TV (built by cast-apk.yml, served like the other side apps).
const CAST_APK = `${publicApiBase}/api/mobile-updates/cast/download`;
const CAST = [
  "Mirrors your Android phone’s screen and sound to the living-room TV over your own Wi-Fi, with very little delay (about a tenth of a second on a 5 GHz network)",
  "Pick the TV from a list, type the 4-digit PIN once, and from then on it is one tap; the phone remembers the TV",
  "Smooth (60 frames a second), Sharp or Max quality, and a switch for sound",
  "Nothing goes through the internet, so it also works when the internet is down",
  "Needs Stashr TV (1.3 or later) on the TV; secure screens such as some banking or streaming apps show black, which is Android’s rule",
];

// Stashr Location: location only, for family phones (built by where-apk.yml, served like Stashr Hub).
const WHERE_APK = `${publicApiBase}/api/mobile-updates/where/download`;
const WHERE = [
  "Shares only the phone’s location, battery level and whether it is on Wi-Fi, and nothing else. It cannot see your vault or passwords",
  "Joins with one fixed code from the Smart home page plus the person’s name, and stays linked until you disconnect it, on the website or in the app",
  "No permanent notification and very little battery: it looks rarely when someone is far away or leaving, and often only when they are heading home",
  "Stashr works out who is on the way and how long they will take. The tablet and the TV show “Parveen is arriving in 15 mins”, then “Open the door: Parveen arrived home”",
  "Also sends you the same messages as a normal notification when someone else is arriving",
];

const FEATURES = [
  "Passwords, 2FA codes and secure notes, unlocked with your fingerprint or face",
  "Servers, deployments, monitoring and moving a server between Render accounts",
  "Same account and same server as the website, so everything stays in sync",
];

export default function Apps() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`${publicApiBase}/api/mobile-updates/android/latest?currentVersionCode=0`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && d.version) setVersion(d.version); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return (
    <div className="apps page">
      <Ambience petals={false} />
      <article className="shell-narrow apps__doc card anim-fade-up">
        <span className="card__ribbon" />
        <p className="eyebrow">Android · {version ? `version ${version}` : "latest version"}</p>
        <h1>Stashr for Android</h1>
        <p className="lede">Your vault, servers and smart home in your pocket. Sign in with the account you use on the website.</p>
        <a className="btn btn--primary apps__download" href={APK.file} download="stashr.apk">Download APK</a>
        <p className="apps__note">Administrator? <Link to="/app-updates">Choose which devices get a new app version</Link> (Stashr, Location, Hub, TV).</p>
        <p className="apps__note">Button not working? <a href={APK.github}>Download from GitHub</a>.</p>
        <h2>What you get</h2>
        <ul>{FEATURES.map((f) => <li key={f}>{f}</li>)}</ul>
        <h2>How to install</h2>
        <ol>
          <li>Open this page on your Android phone and tap <strong>Download APK</strong>.</li>
          <li>Open the downloaded file. If Android asks, allow installs from your browser.</li>
        </ol>
        <p className="apps__note">Updates install over the old app and keep your data. If a previous build refuses to update, uninstall it first.</p>
        <h2>Stashr Hub for Android</h2>
        <p>The app for the always-on home tablet (and, in phone mode, a phone that reports its health). It joins with a code, so nobody types your Stashr password on it.</p>
        <a className="btn btn--primary apps__download" href={HUB_APK} download="stashr-hub.apk">Download Stashr Hub</a>
        <h3>On the home tablet</h3>
        <ul>{HUB_TABLET.map((f) => <li key={f}>{f}</li>)}</ul>
        <h3>On a family phone</h3>
        <ul>{HUB_PHONE.map((f) => <li key={f}>{f}</li>)}</ul>
        <ol>
          <li>Install the APK on the tablet or phone. If Android asks, allow installs from your browser.</li>
          <li>On the website open <strong>Smart home → Devices → Link the home tablet</strong>, pick which one it is and tap <strong>Make a code</strong>.</li>
          <li>Type the 8-letter code in Stashr Hub. The tablet asks for camera, microphone and notification permission once.</li>
        </ol>
        <p className="apps__note">Stashr Hub updates itself from new GitHub releases. Android asks for one tap to install each update.</p>
        <h2>Stashr TV for Android TV</h2>
        <p>The launcher for the living-room TV. It replaces the old TV app: home screen, movie sync from Google Drive to a USB drive, a player, remote control from Stashr and on-screen messages.</p>
        <a className="btn btn--primary apps__download" href={TV_APK} download="stashr-tv.apk">Download Stashr TV</a>
        <ul>{TV.map((f) => <li key={f}>{f}</li>)}</ul>
        <ol>
          <li>Install the APK on the TV (a USB drive or “Send files to TV” works). Allow installs from unknown sources when asked.</li>
          <li>On the website open <strong>Smart home → Devices → Link the home tablet or TV</strong> and copy the code.</li>
          <li>Open Stashr TV, type the code and a name for the TV, and choose it as the home app when Android asks.</li>
          <li>In Stashr TV’s settings turn on the “Stashr TV remote” accessibility service and “Display over other apps”, so Home/Back commands and on-screen messages work.</li>
        </ol>
        <p className="apps__note">Plug in a USB drive for movies. Stashr TV updates itself from GitHub releases; Android asks for one tap.</p>
        <h2>Stashr Cast for Android</h2>
        <p>Show your phone on the TV. It is a separate small app, so it never touches your Stashr data.</p>
        <a className="btn btn--primary apps__download" href={CAST_APK} download="stashr-cast.apk">Download Stashr Cast</a>
        <ul>{CAST.map((f) => <li key={f}>{f}</li>)}</ul>
        <ol>
          <li>On the TV open Stashr TV → <strong>Screen mirror</strong>; it shows a 4-digit PIN.</li>
          <li>On the phone open Stashr Cast, pick the TV, type the PIN and tap <strong>Start mirroring</strong>.</li>
          <li>Allow the screen-capture question. Tap Stop in the notification (or press Back on the TV) to end.</li>
        </ol>
        <p className="apps__note">Phone and TV on the same Wi-Fi, ideally 5 GHz. iPhones can’t use this app; they use AirPlay or the TV’s built-in Cast.</p>
        <h2>Stashr Location for Android</h2>
        <p>A tiny app for the phones of people at home. It only shares where the phone is, so the family never gets near your passwords. Install it on each family phone.</p>
        <a className="btn btn--primary apps__download" href={WHERE_APK} download="stashr-location.apk">Download Stashr Location</a>
        <ul>{WHERE.map((f) => <li key={f}>{f}</li>)}</ul>
        <ol>
          <li>On the website open <strong>Smart home → Devices → Family locations</strong>. The link code is there, and it stays the same until you make a new one.</li>
          <li>Install the APK on the family phone. If Android asks, allow installs from your browser.</li>
          <li>Open Stashr Location, type the code and the person’s name, and tap <strong>Connect</strong>. Allow location “all the time” when it asks.</li>
          <li>Set the home location once on the website (Smart home → Automations → Places). It applies to every phone.</li>
        </ol>
        <p className="apps__note">On some phones (Xiaomi, Oppo, Vivo) battery savers pause background apps. If updates stop, the app has a button for its battery settings. It updates itself from GitHub releases; Android asks for one tap.</p>
        <h2>Browser extension</h2>
        <p>Autofill from your vault in Chrome, Edge and Brave. Version {EXT.version}.</p>
        <a className="btn btn--primary apps__download" href={EXT.file} download="stashr-extension.zip">Download extension</a>
        <ol>
          <li>Unzip the file, then open <code>chrome://extensions</code> and turn on Developer mode.</li>
          <li>Choose <strong>Load unpacked</strong> and pick the unzipped folder.</li>
        </ol>
        <p className="privacy__back"><Link to="/">← Back to Stashr</Link></p>
      </article>
    </div>
  );
}
