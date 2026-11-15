# Stashr Smart Home & Personal Device OS — audit and plan

Status: **proposal, waiting for approval.** Written 2026-11-15 against `main` at `8daf82b` plus the uncommitted 2.6.0 widget work.
Nothing in phases 1–8 below is built yet except where the matrix says so.

## 1. Repository architecture (what is really there)

| Part | Folder | Stack | Role today |
|---|---|---|---|
| API server | `server/` | Express + MongoDB on Render | Vault, projects/Render ops, registry, **Smart home** (`router/home*.js`, `utils/home*.js`), Money, WhatsApp sender, photos, Telegram bot, OTA/APK serving |
| Website | `client/` | React/Vite | Every feature, incl. `Pages/SmartHome` (7 tabs) and a 3D house viewer (imported `.glb`, `models/homeModel3d.js`) |
| Main Android app | `mobile/` | Expo SDK 57 / React Native 0.86, Expo Router | Vault, 2FA, photos, Money (bank SMS), servers, **Smart home** (native screens, same 7 sections as the website) |
| Hub app | `hub-app/` | Kotlin | Always-on tablet: Wi-Fi scan, camera (motion, clips, live), "Hey Stashr" mic, dashboard, slideshow, speed test, WhatsApp sender, announcements, local rules when offline |
| TV app | `tv-app/` | Kotlin | TV launcher: apps/movies rows, Drive → USB movies, remote commands, on-screen messages, weather/headlines |
| Location app | `where-app/` | Kotlin | Family phones: location, battery, on-Wi-Fi; FCM "locate now" ping |
| Cast app | `cast-app/` | Kotlin | Phone screen → Stashr TV over local Wi-Fi |
| Launcher | `launcher-app/` | Lawnchair at a pinned commit + `apply.py` + `overlay/` | Name, package id, icon, green accent, "Lawnchair" → "Stashr" text. **No code fork.** |
| Browser extension | `extension/` | MV3 | Autofill |
| CI/CD | `.github/workflows/` | GitHub Actions | One APK workflow per app (push to `main` releases the main app, hub, TV, Location, Cast); launcher is manual |

### How a home device talks to Stashr
`HomeDevice` (`kind: tv | hub | phone`) joins with a pairing/home code, gets its **own revocable token** that can only call `/home/agent/*`,
and **polls** `POST /home/agent/report` (status in, queued commands out; max 20 waiting). The server validates every command against a
whitelist (`utils/home.js → COMMANDS`). There is no push channel to the hub/TV; the website and app also **poll** (15–20 s).
Server-sent events exist only for the vault (`router/vault.js`).

### Commands that exist (verified in `utils/home.js`)
- **TV:** launch_app, volume (up/down/mute/level), media (play/pause/next/prev), key (HOME/BACK), open_url (YouTube), play/remove movie, sync_now, live_location, notify.
- **Hub tablet:** scan_now, screen_off, speed_test, wifi_motion_test, check_update, wake (Wake-on-LAN), play_music, camera (arm/disarm/snapshot/clip/live), slideshow, show_today/map/room, announce, send_whatsapp, send_wa.
- **Phone:** report_now, notice.

## 2. Existing vs missing (feature matrix)

Legend: ✅ working · 🟡 partial · 📝 designed, not built · ❌ missing · 🔌 needs a third-party integration · 📱 needs Android native work · 🖥 needs server work

| Brief area | Status | What exists / what is missing |
|---|---|---|
| **Lights, fans, AC, plugs, sensors, doors, energy** | ❌ 🔌 | **No integration at all.** Only TV, tablet, phones, Wi-Fi presence, Wake-on-LAN and the tablet camera are controllable. Every "turn off bedroom AC / lights / energy" feature depends on choosing an integration (§5). |
| Device registry, per-device tokens, revoke | ✅ | `HomeDevice`, pair codes, rename/merge/remove, health check per device |
| Rooms / floors | 🟡 | Rooms exist for the Wi-Fi/Bluetooth room model and Wi-Fi labels; no floors, no device-to-room for controllable devices (there are none yet) |
| Scenes | ✅ (TV only) | Editable step lists; defaults Movie night / Quiet / Good night |
| Schedules, places (geofence), presence, ETA "coming home" | ✅ | Minute tick with a lease (`SchedulerLease`), `etaTick`, `geoTick`, places → WhatsApp |
| Automation builder (AND/OR, templates, test, versions, retry) | ❌ 🖥 | Rules are fixed kinds; no condition engine, no history per rule, no version history |
| Execution history | 🟡 | `HomeEvent` timeline (kinds: command, automation, place, camera, battery_low, tv_limit…) |
| AI command centre | 🟡 | **Rule-based** Hinglish/English parser (`utils/homeAssistant.js`) shared by website, Telegram, tablet mic. No LLM, no follow-ups, no plan preview, no command history UI |
| Notifications to the owner | 🟡 | Delivered by **Telegram** (alerts: new device, night device, empty home + TV on, camera motion, presence, everything, briefs). In-app timeline. |
| Native phone notifications (main app) | ❌ 📱🖥 | Main app has **no** `expo-notifications`, no FCM token, no channels, no actions. FCM exists server-side only to ping Location phones (`utils/fcm.js`) |
| Notification intelligence (grouping, cooldowns, quiet hours, priorities) | 🟡 | Telegram: per-alert switches, night window, one-alert-a-minute for motion. No grouping engine, no per-room/device prefs |
| Notification centre / history | 🟡 | Home timeline + Telegram history; no read/unread, categories or search |
| NotificationListenerService (read other apps) | ❌ 📱 | Not present. Only if explicitly wanted (privacy cost) |
| Launcher (Lawnchair) | ✅ | Built and installed as Home on the OPPO A38 |
| Home widget (who's home, coming, weather, TV) | 🟡 📱 | **Built this session, not released:** `mobile/modules/stashr-widget`, app 2.6.0, compile check running |
| Dock/app shortcuts (Smart home, TV, Camera, Money, Passwords) | 🟡 📱 | **Built this session, not released** (same module) |
| Deep links behind the unlock | 🟡 | Fixed this session for `/home`, `/money`; **other routes (e.g. `/projects`, `/servers`) are still outside the lock guard** — see §7 |
| Spaces | ❌ | Needs a Lawnchair code fork (per-space layouts) or a lighter "profiles" version inside Stashr |
| Universal search | 🟡 | Website command palette; mobile vault search; launcher has app/web search only |
| Gestures (two/three-finger etc.) | ❌ 📱 | Needs a Lawnchair fork; Lawnchair already has swipe-down / double-tap configurable |
| Multi-device: messages to phones/TV, find device, sign out a device | 🟡 | notice/notify/announce commands, live map, remove device. No file/clipboard share |
| AI insights | 🟡 | `homeInsights.js`, `homeHabits.js` (trips, commute, TV usage, habits) with real data |
| 3D home | 🟡 | Website imports a `.glb` and maps parts to rooms; nothing on the phone |
| Privacy & security centre | 🟡 | Website SecurityCenter (vault), sessions "sign out others", device health. No single permissions overview on the phone |
| Onboarding | 🟡 | Per-app setup; launcher README has the ColorOS checklist; no unified first-run |
| Offline / stale data | 🟡 | Hub has local rules when the server is down; the app shows errors; widget shows "updated HH:MM" |

## 3. Decisions needed before building (you choose)

1. **Which smart devices do you actually own?** (brand/app: Wipro, Syska, Havells, Philips Wiz, Tuya/Smart Life, Mi Home, Sonoff, any Home Assistant…)
   This decides the integration in §5 and whether phases 2–5 can show real lights/AC/plugs. Without devices, those features stay hidden (the brief forbids fake controls).
2. **AI provider for the command centre:** keep the rule engine as the safe executor and add an LLM only to *understand* sentences
   (Claude via the Anthropic API, server-side, key in Render env). Or rules only.
3. **Native notifications through FCM** (needs `google-services.json` for `com.tanush.stashr.com` and the existing Firebase service account). Yes/no.
4. **Read other apps' notifications** (NotificationListenerService): off by default; build at all?
5. **Launcher code fork** (for Spaces, gestures, At-a-Glance provider, search-bar AI): fork `LawnchairLauncher/lawnchair` into your account, as `launcher-app/README.md` describes.

## 4. UI / navigation architecture (proposed)

- **Launcher home** = Lawnchair + Stashr widgets (Home status, Scenes, Favourite devices, AI bar) + dock shortcuts. Widgets live in the
  **main app** (it has the login), so they also work on any launcher and keep the launcher light.
- **Main app tabs** stay (Vault, Photos, ＋, Health, Settings) and gain a **Home** entry point: Overview (status, AI bar, scenes, alerts),
  Devices (by room / category), Automations, Activity (notification centre), Insights.
- **AI command sheet** reachable from the widget AI bar, the app, the launcher search bar (fork) and a Quick Settings tile.

## 5. Integration plan for real devices (🔌)

| Option | Covers | Cost / risk |
|---|---|---|
| **Home Assistant bridge** (recommended if you will run a small box or the hub tablet can't) | Tuya, Matter, Zigbee, Wiz, Hue, Sonoff, ACs via IR/cloud — almost everything | Needs Home Assistant running at home; Stashr talks to its REST/WebSocket API with a long-lived token |
| **Tuya / Smart Life cloud API** | Most Indian smart bulbs/plugs (Wipro, Syska, Havells…), some ACs, energy plugs | Tuya IoT developer project; cloud only; rate limits |
| Matter on the hub tablet | Matter devices on the LAN | Android Matter controller support is limited; high effort |

Either way the server gets a `HomeThing` model (id, integration, room, category, capabilities, last state, last seen) and a capability-checked
command path next to `COMMANDS`, so the UI only shows controls the device really has.

## 6. Android permissions & native capabilities

| Capability | Where | Permission / API | Notes |
|---|---|---|---|
| Home widget, app shortcuts | main app | none (AppWidget, ShortcutManager) | Built (2.6.0, unreleased) |
| Native notifications with actions | main app | `POST_NOTIFICATIONS` (13+), FCM, channels per category | Actions call authenticated APIs; result notification on success/failure |
| Quick Settings tiles | main app | TileService | Scenes, TV pause, camera photo |
| Background refresh | main app | expo-background-task (WorkManager) | ~15 min, deferred by ColorOS; never promised |
| Read other apps' notifications | main app | NotificationListenerService (user enables in Settings) | Off by default, local only |
| Voice | main app / hub | `RECORD_AUDIO`, push-to-talk only | Never always-on on phones |
| Gestures, Spaces, AI search bar | launcher | Lawnchair fork | |

## 7. Backend / database changes

- **Now (security fix, small):** put every signed-in route of the app behind `Stack.Protected` (today only tabs, editor, scan, account,
  photo-viewer, and — after this session — home and money are guarded).
- `PushToken` (owner, device, FCM token, platform, lastSeen) + `POST /me/push-tokens`; notification sender with categories/priorities,
  cooldowns, grouping window, quiet hours; `Notification` collection (owner, category, priority, title, body, actions, groupKey, readAt, at).
- `HomeThing` + integration adapters (§5); capability whitelist; state cache with `seenAt` for stale display.
- Automations v2: `Automation` (trigger, conditions tree, actions, enabled, version), `AutomationRun` (inputs, result per step, error);
  loop/duplicate protection reuses `claim()` and the minute lease.
- AI: `POST /home/ai/plan` (sentence → proposed actions, never executes) and `POST /home/ai/run` (executes a confirmed plan through the
  existing command path); `AiCommand` history.
- Server-sent events for home state (reuse the vault stream pattern) to replace 15–20 s polling where the app is open.

## 8. Phased plan (each phase ends with a release only after it works on the phone)

| Phase | Scope | Depends on |
|---|---|---|
| 0 | This audit | — |
| 1 | Finish & release widget + shortcuts (2.6.0); lock-guard all routes; ColorOS setup checklist in the app | — |
| 2 | Scenes widget + Quick Settings tiles; launcher default layout (Stashr folder, dock) via `apply.py` | 1 |
| 3 | Native notifications: FCM in the main app, channels, actions (Pause TV, Camera photo, Run scene, Mark expected), notification centre, quiet hours, grouping, cooldowns; Telegram stays as an option | decision 3 |
| 4 | AI command centre: plan → confirm → run → verified result, command history; LLM only if decision 2 | decision 2 |
| 5 | Real devices: chosen integration, `HomeThing`, device cards with only supported controls, rooms/categories | decision 1 |
| 6 | Automations v2: builder (simple first, flow later), templates, test run, history, retry | 5 for device triggers |
| 7 | Multi-device: send to device, find device, revoke; Spaces (light version in app, full version needs fork); universal search | decision 5 |
| 8 | Insights with evidence, energy (only with real meter data), optional 3D on phone (off by default) | 5 |

## 9. Testing plan

- Unit: `node --test` for pure logic (server `tests/`, mobile `scripts/*.test.mjs`), Kotlin unit tests in modules.
- On the OPPO A38 (ColorOS, Android 15, 4 GB): fresh install, upgrade from 2.5.0, lock/unlock + deep links, reboot, notification permission
  denied/granted, battery-restricted, offline / server down (stale labels), widget refresh, shortcut targets.
- Each release goes through the existing workflows; nothing is pushed to `main` (which auto-releases) until it has been tested on the phone
  and you approve.
