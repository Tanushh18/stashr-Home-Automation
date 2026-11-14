# Tablet and phone test plan (Stashr Hub)

Nothing in the Android app has been run on a real device yet: it is only compiled, unit-tested and linted.
This file is the running list of what to test. **Add every new feature here when it is built**, and tick items off
(`[x]`) with the date and the result when tested. Put problems under "Found".

## 0. Connect the tablet from the terminal (adb)
```bash
adb devices                       # tablet must show as "device" (USB debugging on; Wi-Fi: adb connect <ip>:5555)
adb install -r Stashr-Hub.apk     # APK from the /apps page or the GitHub release stashr-hub-v…
adb logcat -s StashrHub:V AndroidRuntime:E *:S    # watch while testing; share the output when something fails
adb shell dumpsys activity activities | grep -i stashr.hub    # which screen is open
adb shell pm grant com.tanush.stashr.hub android.permission.CAMERA   # (optional) skip a permission dialog
```
Adb access gives only a terminal on your computer. The app still talks to the Stashr server by itself.

## 1. Install and pair
- [ ] APK installs; app opens in the Stashr look (light and dark).
- [ ] Smart home → Devices → "Link the home tablet" shows a fixed code; typing it + a tablet name in Stashr Hub links the tablet (the code stays the same on reload; "New code" changes it, linked tablets stay linked).
- [ ] The tablet code does not link a family phone in Stashr Location, and the phone code does not link a tablet.
- [ ] The tablet shows on the Smart home page as online within a minute; the same for a family phone (second code).
- [ ] A used or expired code is refused.

## 2. Tablet: Wi-Fi scan
- [ ] Wi-Fi rows appear with IP, names (where the device shares one) and ports.
- [ ] Phone reconnects with a new IP: it keeps its row and label (name key).
- [ ] Give a device a person: "Who is home" updates; leaving Wi-Fi marks them out after ~15 min.
- [ ] Risky-port flags look right on a device you know.

## 3. Tablet: camera (security camera)
- [ ] Start from the page: the app asks for camera permission once; "Watching" shows.
- [ ] Walk into view: photo reaches the page gallery and Telegram within seconds; a clip follows.
- [ ] Live view opens on the page for 2 minutes with a new frame every ~1.5 s.
- [ ] Stop from the page: the camera closes (no green dot).
- [ ] **Auto camera** (Camera card, switch on, needs a person set): everyone out for 2 min → camera starts and Telegram says so; someone back → camera stops. A camera you started by hand is not stopped.

## 4. Tablet: voice and music
- [ ] "Hey Stashr, tv ki awaaz kam karo" does it and shows the reply on the dashboard (Hindi and English); the tablet makes no sound.
- [ ] "Arijit ke gaane chalao" plays in YouTube Music on the tablet.
- [ ] "Stashr today updates" / "aaj ke updates" (voice, page and Telegram) opens **Today at home** on the tablet by itself, even from another app. If not: "Display over other apps" permission.
- [ ] Mic button on the website works in Chrome.

## 5. Tablet: dashboard, slideshow, speed, wake
- [ ] Dashboard: clock, weather (set the city on the page), people, TV, scenes, "Ask Stashr".
- [ ] Photo slideshow starts after 10 idle minutes (Drive folder set) and from "photos dikhao"; a tap exits.
- [ ] Speed test runs hourly and from "Test now"; the chart gets a point.
- [ ] Wake-on-LAN wakes a PC whose MAC you typed in its Wi-Fi row.

## 6. Family phone
- [ ] Battery, storage, memory and model show within ~15 min, and soon after joining the Wi-Fi.
- [ ] Low battery shows correctly; charging shows.

## 7. Places and WhatsApp (the fragile one)
- [ ] Phone: install **Stashr Location**, link with the code + name (it appears in Devices → Family locations); permissions "while using" then "Allow all the time".
- [ ] Tablet: Accessibility switch on (Android 13+: App info → ⋮ → Allow restricted settings); lock screen is None/Swipe.
- [ ] Tablet dashboard "WhatsApp messages" → send a test to a small test group: WhatsApp opens, group chosen, message sent, app returns to the dashboard.
- [ ] Page → Places → "Send test" does the same.
- [ ] Walk or drive into the circle inside the time window: the arrive message goes once. Outside the window: nothing.
- [ ] Walk out of the circle: the leave message goes (inside its window only). Standing on the edge does not repeat it.
- [ ] Tablet offline: Telegram says the message was not sent.
- [ ] Group with a long name or similar names: the right one is picked.

## 7b. Arrival time and Telegram control
- [ ] Page → Automations → Places → Home location saved (use your phone's browser at home).
- [ ] Phone (Stashr Location): no notification in the drawer. Go out ~5 km and come back: the tablet banner and the page's Home screen card show “… minute mein aa rahe hain”; Telegram says it once when within 15 min.
- [ ] Check battery use of Stashr Hub on the phone after a day (Settings → Battery); try Precise mode only if the ETA is too slow.
- [ ] Phone with an aggressive battery saver (Xiaomi/Oppo/Vivo): does the ETA still update? (turn battery optimisation off for the app)
- [ ] Telegram: “pause the tv”, “volume up”, “camera photo” (photo comes back), “kaun ghar par hai”, “papa kab aayenge”, “today”, /who, /camera on.
- [ ] Page → Overview → “What is switched on” matches reality; “Open” jumps to the right tab.

## 7c. Stashr Location app and announcements
- [ ] Page → Devices → Family locations shows a fixed 8-letter code; it does not change on reload; "New code" changes it and linked phones stay linked.
- [ ] Phone: install from /apps, type code + name → the phone appears with its name; wrong code and a duplicate name are refused with a clear message.
- [ ] Home location set on the website (Places → Home location). Phone far away: card shows km and minutes; after it starts heading home the state becomes "heading home".
- [ ] Check how often it uploads: far away and leaving ≈ 30 min; heading home and close ≈ 1–2 min (see `adb logcat` / the "updated … ago" text).
- [ ] Tablet: announcement screen with big text, no voice "… is arriving in 15 mins" (and 5), then "Open the door: … arrived home". Without "Display over other apps" you only get the heads-up notification.
- [ ] Arrival by Wi-Fi: phone joins home Wi-Fi (tablet sees it, person set) within 2 km → "Open the door" fires even before the GPS circle.
- [ ] TV on: does the TV show the message? (needs the TV app to support `notify`; note the result in "Found").
- [ ] Second phone gets the same message as a notification when someone else is arriving.
- [ ] Disconnect in the app → disappears from the page; Disconnect on the page → the app returns to Setup with a message.
- [ ] Battery use of Stashr Location after a day (Settings → Battery).
- [ ] OTA: new `where-app/` change → release `stashr-where-v…` is created, not "latest"; `/api/mobile-updates/where/latest` finds it; the app offers the update.

## 7d. Stashr TV (launcher and movies)
- [ ] Install the APK on the TV; the home-device code + a name links it (appears as a TV on the page, online within ~30 s). Choose Stashr TV as the home app.
- [ ] Home screen: apps row (favourites first), launching Netflix/YouTube works with the remote; Back/Home behave.
- [ ] Settings: turn on the "Stashr TV remote" accessibility service and "Display over other apps".
- [ ] Page → TV card: volume up/down/mute, play/pause, open an app, "tv par … songs" / YouTube link, HOME/BACK all reach the TV.
- [ ] The page shows the app that is on the TV (needs the accessibility service) and TV time counts up.
- [ ] Movies: put a movie in the Drive folder (Movies from Google Drive set up) → it downloads to the USB drive (progress shown), resumes after unplugging Wi-Fi, size matches; it appears in the Movies row and plays; position is remembered.
- [ ] "move" mode: the Drive file is removed once the TV has it. "mirror" mode: a file removed from Drive disappears from the TV; files the app did not download are never deleted.
- [ ] `notify`: "Parveen is arriving in 15 mins" appears over a playing video for ~12 s; without the overlay permission only a Toast shows.
- [ ] TV standby: the page shows it as off/standby quickly.
- [ ] OTA: a change under `tv-app/` creates `stashr-tv-v…` (not "latest"); the TV offers the update.

## 7e. Arrival time by road
- [ ] Drive/ride home from ~5 km: the minutes on the page and tablet are close to what Google Maps says (without traffic); compare 3 times.
- [ ] Switch "Use real roads" off on the website: the time becomes the straight-line one. On again: road time returns.
- [ ] Airplane mode on the server side is hard to test: check that the page still shows an ETA if router.project-osrm.org is unreachable (set HOME_ROUTING=off locally).

## 7f. Live traffic (needs MAPBOX_TOKEN on both servers)
- [ ] Family locations shows "live traffic" next to a coming-home phone; the minutes match Google Maps' current time within a few minutes, at rush hour and at night.
- [ ] Remove the token: the label disappears and the OSRM time returns.

## 7g. Rain, news, movie night, TV home screen
- [ ] Set the weather city; when the forecast chance is ≥ 50% and one phone leaves home, only that phone gets "Chhatri le lo" (not the others, not twice within 6 hours).
- [ ] TV launcher shows the weather chip and the Headlines row; changing language/count on the website changes it within 15 min.
- [ ] First launcher view each morning (05:00–11:00) shows the Good morning panel for ~30 s; not again the same day.
- [ ] Saturday evening with everyone home: "Aaj movie night?" row with USB movies; with someone out: no row.
- [ ] Nothing on the tablet or TV speaks.

## 7h. Local mode (server down)
- [ ] Tablet and TV online once (so they hold the key). Then block the server (turn the router's internet off, or unplug the WAN cable).
- [ ] After ~1.5 min the tablet shows "Offline mode"; after ~1–2 min the TV shows its "Offline mode" chip.
- [ ] On the tablet press a scene / type "volume up" / "pause": the TV obeys through the LAN.
- [ ] A person's phone (labelled on the Wi-Fi) joins after 10+ minutes away: "Open the door: … arrived home" on the tablet and on the TV, no sound.
- [ ] Trigger the camera while offline; plug the internet back: the photos/clips arrive, and the offline arrival appears in "What happened" as "(offline mode) …".
- [ ] Router with client isolation / no multicast: does the TV still find the tablet (saved address)? Note the result.

## 7i. Family insights
- [ ] Insights tab: turn history on; after 3–4 days, "Places Stashr found" lists the office; name it; trips and the commute chart appear.
- [ ] The tablet's Safar card shows a "leave now" line around the usual leaving time at the office, and today's trips.
- [ ] Nothing about history shows on the TV or on any phone (apart from the privacy line in Stashr Location).
- [ ] "Delete the history" erases it; switching it off stops new fixes.

## 7j. Live location on the TV
- [ ] A phone is out (a few km away): TV launcher → Live location. Within 1–3 minutes the card turns live ("updated N s ago" stays under ~30 s) and the pin moves.
- [ ] The road line goes toward home; the minutes match the Family locations card.
- [ ] A phone at home is not on the map. "Everyone is at home" when nobody is out.
- [ ] Close the screen: after ~2–3 minutes the phone goes back to slow checks (battery!).
- [ ] Say "tv par live location" in Stashr (website/Telegram): the TV opens the screen.
- [ ] Turn the website switch off: the TV shows that it is switched off.

## 7k. Website live map and home picker
- [ ] Automations → Places → Home location: click the map, search your street, paste a Google Maps link, paste "lat, lon": each moves the pin; Save home keeps it.
- [ ] Devices → Live map → Start live view: tiles load, Home pin and circle show; phones at home show as pins; a phone that is out shows the road line.
- [ ] After 1–3 minutes the pin of a phone that is out turns orange ("live") and moves; Stop live view: phones return to the slow pace.
- [ ] Dark mode / phone browser: the map and the list are usable.

## 7l. Stashr Cast (phone screen on the TV)
- [ ] Install Stashr Cast on a phone (from /apps); Stashr TV 1.3+ on the TV. TV → Screen mirror shows a PIN.
- [ ] Phone lists the TV (same Wi-Fi); PIN once; Start mirroring → the phone screen appears full-screen on the TV within ~2 s.
- [ ] Scroll a list and play a game / video: is it smooth? Note the delay (clap a timer app) on 5 GHz and on 2.4 GHz.
- [ ] Sound plays on the TV in sync (Android 10+); the "Send sound" switch off mutes it.
- [ ] Rotate the phone: the picture follows. Quality chips (Smooth / Sharp / Max) change sharpness.
- [ ] Stop from the notification, from the TV Back button, and by switching Wi-Fi off: the TV returns to the launcher each time.
- [ ] Second phone while one is casting gets "TV is busy"; wrong PIN is refused; "Forget phones" on the TV asks for the PIN again.
- [ ] A Netflix screen goes black (DRM): expected.

## 7m. Health tab and the main app's Smart home
- [ ] Website → Health: every device shows its version and green/yellow/red; turn "Display over other apps" off on the TV: it turns red with the fix text within a minute or two; "Copy a report" pastes a readable block.
- [ ] Force a crash is hard; check instead that a device's "Last error" line appears after you break something (e.g. unplug the USB movie drive during a sync).
- [ ] Stashr app 2.4.0 (update via Settings → Check for updates): Settings → Smart home opens; go through all seven sections; compare a few values with the website (devices, family locations, health).
- [ ] In the app: TV volume/pause buttons, camera start/stop, a scene run, home location by pasting a Google Maps link, the live map.

## 7n. Movie download details and contacts import (added 2026-11-13)
- [ ] Put a movie in the Drive folder; website → Smart home → Media & network → "Downloads on <TV>" shows it as Waiting, then Downloading with percent, "x MB of y MB", the start time, the speed and the time left (needs Stashr TV 1.3.2).
- [ ] When it finishes the row says Done with the average speed, "took …" and the finish time; unplug the USB drive during a download: the row says Failed with the reason; it resumes on the next sync.
- [ ] After a TV restart the last finished/failed downloads are still listed (a download that was running shows as stopped).
- [ ] WhatsApp sender → Group from Google contacts: a `.vcf` file loads (names with accents, several numbers per person); the Search box filters by name or number; "Tick these" only affects what the search shows.
- [ ] A group's "Edit sheet" button opens an editor: type new numbers, or add from a contacts file (CSV or .vcf) with search; duplicates are reported, not added twice. Same in the Android app.
- [ ] WhatsApp sender → New sheet: "Add an Excel file (.xlsx)" lists the tabs with their number counts; tick tabs, name each, choose how many sheets to split a tab into; the plan lists the final names ("Name 1", "Name 2"…) and refuses empty or used names.
- [ ] With We Three connected, "Also create it in We Three" is ticked: the new sheet appears as a list in We Three with the same people; messaging one person in Stashr marks that lead in We Three; a lead added to the list in We Three shows up in Stashr within ~10 minutes. An older sheet has a "Send to We Three" button.
- [ ] WhatsApp sender → a sheet → "View people": the list shows each person with their send status and, for a sheet in We Three, their stage there; the stage chips (with counts), the search box and paging work; "Edit" changes the name and number here and on the We Three lead; a number already used is refused.
- [ ] "Delete here and in We Three" asks you to type the sheet name; the sheet disappears at once and its leads leave We Three within a few minutes (the Stashr server removes them a few at a time). A plain "Delete sheet" leaves We Three alone.
- [ ] Unplug the tablet at more than 20% battery: after 10 minutes the WhatsApp sender page still shows it online (Stashr Hub 1.9.4, battery exemption allowed).

## 7o. SMS sender (Shine One SMS, managed in Stashr)
- [ ] Needs We Three with the "console with an admin login" change deployed, and the We Three link on the WhatsApp sender page (an admin account).
- [ ] Stashr → SMS sender loads: On/Pause, sent today, phones online, limits (safe defaults / my numbers), lunch and night times, days.
- [ ] A sheet: copy messages from a WhatsApp sheet, Save messages, switch Auto-send on (optionally only new leads); the phone sends at lunch/night with one of the messages picked at random; counts go up; Latest messages shows them.
- [ ] Test SMS to your own number arrives at once. A phone set to GGN Home only does not send Shine One messages.
- [ ] ggnHome SMS console → Shine One Estate tab only points to Stashr; its Phones and Log tabs still work.

## 8. Updates (OTA)
- [ ] Push a change under `hub-app/` to `main`; the GitHub Release is created and is **not** "latest".
- [ ] The app (or "check_update") finds it, verifies it and Android asks for one tap to install.
- [ ] `GET /api/mobile-updates/hub/latest?currentVersionCode=1` on the live server returns the release.

## 9. Alerts and automations (server)
- [ ] Telegram bot connected; new device, unknown device at night and arrive/leave alerts arrive.
- [ ] Morning brief at its time; "Send a test" works. Weekly report on Sunday 20:00.
- [ ] TV: daily limit action, late-night warning, schedules at their minute (check the time zone).
- [ ] Scenes ("movie night") send their commands.

## Found
_(Write problems here: what you did, what happened, `adb logcat` lines.)_

## To add when built
_(New features go in the sections above; write a line here first if it does not fit.)_
