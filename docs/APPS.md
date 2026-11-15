# Stashr apps (what each one is for)

All are listed with download buttons on the website's **/apps** page.

| App | Who installs it | What it does | What it can see |
|---|---|---|---|
| **Stashr for Android** (`mobile/`) | You | Vault, 2FA, photo backup, servers | Everything of yours |
| **Stashr Hub** (`hub-app/`, `com.tanush.stashr.hub`) | The always-on home tablet (and optionally a phone to report its health) | Wi-Fi scan with names, security camera, "Hey Stashr" voice, dashboard, slideshow, speed tests, WhatsApp sender, announcements | Home data only. Joins with a pairing code, never your password |
| **Stashr TV** (`tv-app/`, `com.tanush.stashr.tv`) | The living-room Android TV | Launcher (apps + movies), Drive → USB movie sync, built-in player, remote control, on-screen messages | Home data only. Joins with the home-device code |
| **Stashr Cast** (`cast-app/`, `com.tanush.stashr.cast`) | Each phone that wants to show its screen | Mirrors the screen and sound to Stashr TV over the Wi-Fi | Only what is on the screen while casting; nothing leaves the Wi-Fi |
| **Stashr Location** (`where-app/`, `com.tanush.stashr.where`) | Each family member's phone | Shares only location, battery and "on Wi-Fi yes/no" | Nothing of the vault. Joins with the fixed code + the person's name |
| **Browser extension** (`extension/`) | You | Autofill | Your vault |

## Stashr for Android (the main app): Smart home inside
Settings → **Smart home** (version 2.4.0) opens every Smart home function the website has, as native screens with the same seven sections
(Overview, Devices, Camera & alerts, Automations, Insights, Media & network, Health): Ask Stashr (typed), the Home screen card, TV remote,
the tablet's Wi-Fi rows, family phones and locations (link code, live map), link code for the tablet or TV, camera (start/stop, photo, clip,
live view, gallery), alerts and briefs, scenes, schedules, places and WhatsApp, home location (paste coordinates or a Google Maps link, or
search an address), TV time, insights, speed chart, movies from Drive and the health check. Differences from the website: no microphone in
Ask Stashr, times are typed as HH:MM, and the maps are schematic drawings (home, distance rings, route line) rather than street maps.
It updates through the usual Settings → Check for updates (GitHub release built by `android-apk.yml`).

**Home-screen widget and shortcuts (2.6.0):** the *Stashr Home* widget (any launcher: long-press the home screen → Widgets → Stashr, or
Smart home → Overview → *Add to phone's home screen*) shows who is on the way, who is home, the weather (rain when likely) and the TV, from
`GET /home/dashboard`. It stores display text only (no token) and refreshes when Smart home loads and about every 15 minutes in the
background, only while a widget is placed; it is cleared on sign-out. Long-press the Stashr icon for *Smart home*, *TV remote*, *Camera*,
*Money* and *Passwords*. Both open `stashr://` links; Smart home and Money are behind the unlock, and a link tapped while locked opens right
after the unlock. Code: `mobile/modules/stashr-widget`, `src/lib/homeWidget.js`, `src/lib/widgetText.js` (tests:
`node --test scripts/widgetText.test.mjs`).

**More widgets (2.6.3), all in the website's departure-board style:** *Stashr Scenes* (up to four scenes, one tap runs one),
*Stashr TV remote* (TV state; ⏯, VOL −, VOL +, MUTE, HOME), *Stashr Quick actions* (Ask Stashr, Camera photo, Money, Passwords),
*Stashr Money* (spent today and this month, top category, entries to check; from `GET /expenses`, loaded only while this widget is
placed) and *Stashr Network* (last speed test, devices on the Wi-Fi, health of the Stashr devices; loaded only while placed).
Buttons that act open `stashr://action?…&k=<key>`: the app asks for the unlock, checks the per-install secret key every widget button
carries (so no other app can fire them), sends only whitelisted commands and shows what the server answered (`src/app/action.js`).

## Health check
Every app (Hub 1.9, TV 1.3, Location 1.5) sends `status.health` with each report: app version, Android version, "Display over other
apps", accessibility, battery limits, notifications, camera and microphone (tablet), location "all the time" (phone), USB drive (TV), and its
last error (crashes are caught and sent too, kept 7 days). The website's *Health* tab (and the app's Health section) turn that into
green/yellow/red per device with the exact thing to switch on, and a **Copy a report** button to paste into a chat instead of logs.
An app older than the health feature shows grey "update to …".

## Stashr Hub (the home tablet)
- **Link:** website → Smart home → Devices → *Link the home tablet* shows one fixed 8-letter **tablet code** (copy / "New code"). In
  Stashr Hub type the code and a name for the tablet. A one-time 15-minute code still works as an alternative.
- The tablet code is separate from the family-phone code: a tablet can see the home dashboard and your slideshow photos, so only you
  should have it.

## Stashr TV (the TV)
- Rebuilt in this repository after the old TV app (a separate local repository) was lost. It is both the **launcher** (apps row, movies row,
  settings) and the **movie pipeline client**: Google Drive folder → Stashr server (`/home/movies/manifest`, `/home/movies/file` with
  Range) → the TV's USB drive, resumable, size-checked; "mirror" mode removes files that left Drive, "move" mode keeps them
  (server setting); the server removes a Drive file once the TV reports a complete copy (`status.movies`).
- **Link:** the same fixed *home-device code* as the tablet (Smart home → Devices → Link the home tablet or TV). The TV reports to the
  server directly with its own token (no tablet relay needed; the old relay through the tablet still works if present).
- **Commands it understands:** launch_app, volume, media, key (HOME/BACK through its accessibility service), open_url (YouTube),
  sync_now, remove_movie, play_movie, notify (banner over whatever is playing; needs "Display over other apps").
- **On the TV home screen:** weather chip, a *Headlines* row, a one-time *Good morning* panel (weather + top 5 headlines, 30 s) the
  first time the launcher shows each morning (05:00–11:00), "Aaj movie night?" (a row of the USB movies) when everyone with a person
  is home on a weekend evening (Fri 17:00 on, Sat/Sun 16:00 on), and "X is arriving…" cards. Data: `GET /home/agent/tv-home`
  (weather from Open-Meteo, headlines from the public Google News India RSS feed, English / Hindi / both, cached 20 min).
- **Updates:** Stashr TV is built by `tv-apk.yml` on every change under `tv-app/`, released as `stashr-tv-v…` (never "latest") and served at
  `/api/mobile-updates/tv/*`; the TV offers it (one tap). The first install is by cable (`adb install`).
- **Limits:** a TV can't be powered off by an app (limits pause and go home); foreground-app detection needs the accessibility service.

## Stashr Cast (phone screen on the TV)
- **How:** the phone captures its screen (MediaProjection) and encodes H.264 on the phone's hardware encoder (low-latency, CBR, no B-frames,
  60 fps in *Smooth*), sends it over a plain TCP stream on the home Wi-Fi to Stashr TV (port 8766, found by NSD `_stashr-cast._tcp`), which
  decodes it on the TV's hardware decoder straight onto a full-screen surface. Sound is captured on the phone (Android 10+) and played with a
  small buffer. If the Wi-Fi is slow, the phone drops frames and asks for a fresh key frame instead of letting the delay grow.
- **Pairing:** TV → *Screen mirror* tile shows a 4-digit PIN; the phone types it once and gets a token, so next time it is one tap. The TV
  can forget phones. 5 wrong PINs lock an address for 10 minutes. Nothing needs the internet or the Stashr server.
- **Expect:** roughly 80–200 ms delay on 5 GHz, more on 2.4 GHz; secure (DRM) screens appear black; a phone cannot cast while the TV is
  already showing another cast. **The easy alternative** — if the TV has Chromecast built in (most Android/Google TVs), the phone's own
  *Cast / Smart View* in Quick Settings works with no app at all.
- **Not included:** iPhone (use AirPlay or the TV's Cast), Miracast (third-party apps can't be a Miracast receiver on Android).

## Photo frame needs Drive
Google no longer lets apps read a whole Google Photos library (only items the app itself made, or ones you pick), so the tablet's photo frame
only works with a **Google Drive folder**. To use Google Photos pictures: select them in Google Photos → Save to Drive → put them in one folder.

## Stashr Location (family phones)
- **Link:** website → Smart home → Devices → *Family locations* shows one fixed 8-letter code (copy / "New code"). In the app type the code,
  the person's name and press Connect. The phone then appears in that card. It stays linked until you press Disconnect there, or the
  person presses Disconnect in the app.
- **Home location:** set once on the website (Smart home → Automations → Places → *Home location*). It applies to every phone.
- **Privacy:** only `lat, lon, accuracy, speed`, battery level and "Wi-Fi connected + its address" are sent, only to your server.
  The server never sends the app anything but its own state and short notices.
- **Battery and no notification:** no foreground service. The app takes one fix at a time. The server tells it when to look next
  (`nextCheckSec`): every 30 min when far away and not heading home, every 15 min when away but near, every 20 min at home, and
  every 10 → 5 → 2 → 1 min as someone heading home gets closer (>20 km, >10 km, >3 km, closer). Heading home is detected from two
  fixes getting closer. Plus a free source: passive fixes other apps cause (uploaded only after moving 300 m).
- **What the family sees:** the tablet shows a banner "Parveen 10 minute mein aa rahe hain", shows on a big full-screen card (the tablet never speaks) "Parveen Chawla is arriving in
  15 mins" (also at 5 mins) and "Open the door: Parveen Chawla arrived home"; the TV gets the same text (`notify`, only when the TV is
  on); other linked phones get it as a normal notification; Telegram gets it too. Arrival counts when the phone is inside the home
  circle, or the tablet sees the phone on the Wi-Fi and it is within 2 km: whichever happens first.
- **Fixed-code safety:** the code is only useful to someone who adds *their own* phone to your list (it gives them no access to anything).
  Linking is rate-limited and capped by the device limit. Replace the code any time; linked phones stay linked.
- **ETA:** by road, with live traffic when `MAPBOX_TOKEN` (a public `pk.` token) is set on the server: Mapbox's `driving-traffic` time for right now, shown as “live traffic” on the page. Without it, or when Mapbox does not answer: by road without traffic. The server asks an OSRM routing server (the free public one at router.project-osrm.org, or your own through `OSRM_URL`) for the driving time and distance from the phone to home, sending only those two coordinates, at most once per 3 minutes or 400 m per phone. No live traffic. At walking pace, when the service is down or timed out (2.5 s), when switched off per account (Home location → *Use real roads*), or server-wide with `HOME_ROUTING=off`, it falls back to a straight line × 1.3 at the phone's speed (or 25 km/h).

## Live location on the TV
- Stashr TV has a **Live location** tile (or say "tv par live location" in Stashr / Telegram): a map drawn on the TV with home in the
  centre, a pin for every family member who is **out**, the road home (from the routing service) and a card each with "About 12 min
  away · 6.4 km · live traffic", speed and "updated 8 s ago". It refreshes every 5 seconds (`GET /home/agent/tv-live`).
- While the TV screen is open, the server keeps a 2-minute "live" window; phones that are out then check their location every ~8 s
  (`live: true`, `nextCheckSec: 8`) instead of every 1–30 min. Phones at home are not affected. When the screen closes, they go back
  to the normal pace within a couple of minutes. Switch: *Family locations → Allow the live map on the TV*.
- **Honest limits:** a phone only learns about live mode at its next normal check (1–30 min; usually 1–10 min when heading home), and
  Android may stretch the 8-second checks in the background (Doze), so expect updates every 10–60 s, not exactly 5. Instant start needs
  push messages (Firebase), which this project does not use. The map has no street tiles (no map-tile service), only the route line.

## Less load, less battery
- **Phone → server:** a phone that has not moved (same Wi-Fi access point as its last fix, no live view) sends a tiny `{same:true}` call
  instead of taking a new fix; a fix within 40 m of the last upload is also sent as `same`; a fix younger than 4 minutes is reused. A
  call still goes out at least every 25 minutes so the server knows the phone is alive. Low battery (≤ 15 %, not charging) doubles
  the delay and skips GPS. No network → no fix at all, retry in 5 minutes.
- **Server answers how long to wait:** moving or heading home: 1–10 minutes; away and near: 15; at home: 20; far away: 30; and **twice as
  long (max 30 min) after 3 checks at the same place**.
- **Server side:** a `same` call is one small write; a normal fix reads the settings, uses a 20 s memory of the home's devices (instead of
  loading them all each time), skips the history read, and answers from the state it just computed. The tablet/website dashboard is
  shared for 8 s, and the page polls less (devices 15 s, home screen 20 s, family locations 30 s; nothing polls while the tab is hidden;
  the live map and the TV map poll every 5 s only while open).

## Live map and home location on the website
- *Devices → Live map* (**Start live view**): a Leaflet map on OpenStreetMap tiles (fetched by your browser) with Home, a pin for every
  linked phone (orange = live, grey = waiting), the road home for those who are out, ETA, speed, accuracy and "updated N s ago".
  It polls every 5 s only while switched on and puts phones that are out into live mode (like the TV). `GET /home/live`.
- *Automations → Places → Home location*: set it any of these ways — click on the map; search an address (`GET /home/geocode`, OpenStreetMap
  Nominatim with Open-Meteo as a fallback); paste coordinates ("28.6139, 77.2090") or a Google Maps / OpenStreetMap link; type the
  numbers; or "Use this device's location". The circle shows the "at home" area. One home location serves every phone and device.

## Local mode (when the server or the internet is down)
- The tablet (Stashr Hub 1.8+) runs a tiny LAN server on port 8765 and advertises `_stashr-hub._tcp`. Server answers carry a shared key
  (`local.key`) that the tablet and the TV store while they are online. If the server cannot be reached for 90 s (tablet) / 45 s (TV):
  - the **tablet** shows "Offline mode", keeps its last dashboard, runs scenes and typed or spoken sentences with a small built-in
    rule set (volume, play/pause, open app, home/back, camera, "kaun ghar par hai") and sends them to the TV through the LAN;
  - the **TV** reports to the tablet instead of the server (every 10 s), gets those commands and the "Open the door" banners, and tries
    the server again every minute;
  - an **arrival** (a Wi-Fi device you gave a person, back after 10+ minutes) is announced on the tablet and the TV, and uploaded as a
    note "(offline mode) …" when the server is back; camera photos and clips are queued on the tablet (200 MB) and uploaded later.
- Needs: the tablet and TV have been online once (to learn the key), a tablet with a steady IP, and a Wi-Fi that allows multicast.
  The TV uses a raw socket to the private address, so Android's cleartext rule is not involved. The key is sent unencrypted on your own Wi-Fi.
- Not available offline: phones' locations, ETA, Telegram, weather and headlines (the last copy is shown), anything the small rule set doesn't know.

## Family insights (website and tablet only)
- *Insights* tab: switch **Keep a location history** on (off by default). Stashr keeps about one fix per 2 minutes or 150 m per phone for
  60 days (`HomeTrack`), and can erase everything from the website. From it: places found (stops of 20+ min on 3+ days, which you name:
  Office, School…), trips between places, the usual leaving time and way home per place with a 14-day chart, and a 7-day driving
  report (trips, km, highest speed seen in a fix, trips over your limit). Fixes are 1–30 minutes apart, so speeds and times are
  approximate and hard braking is not measured.
- The tablet's *Safar* card shows today's trips and "leave now" lines ("Papa: traffic zyada hai (45 min, aam taur par 32). Abhi niklo"),
  using live traffic (Mapbox) when set. Nothing from the history is sent to a phone or the TV, and nothing is spoken.
- The Stashr Location app tells each person in its privacy card that the owner can turn a history on.

## Two servers
Stashr runs on two servers that share one database (`password-manager-server-g305` and `password-manager-server-xxdr`, the same list
the main app uses). Stashr Hub and Stashr Location keep both addresses (Setup → Advanced → server and backup server), try the one
that worked last, and move to the other when it is asleep or down (no connection, or HTTP 502–504). A device token works on either.

## Updates
Stashr Hub and Stashr Location are built by GitHub Actions (`hub-apk.yml`, `where-apk.yml`) on every change under their folder,
signed with the same keystore secrets, and published as GitHub Releases (`stashr-hub-v…`, `stashr-where-v…`) that are never marked
"latest". The API serves them at `/api/mobile-updates/hub/*` and `/api/mobile-updates/where/*`; the apps check themselves and Android
asks for one tap to install.

## Known limits
- **TV screen messages** need the TV app (separate repo `tv-movie-sync`) to understand the `notify` command; until it does, the TV
  command fails harmlessly and the tablet, phones and Telegram still get the message.
- Phone makers (Xiaomi, Oppo, Vivo, Samsung) may pause background apps; Stashr Location has a button to its battery settings.
- Android 12+ "approximate location" makes the ETA rough; choose Precise.
