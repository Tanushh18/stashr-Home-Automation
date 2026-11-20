# Stashr 3D Universe — Redesign Checklist

Status legend: `[x]` done and verified · `[~]` done in part (the note says what is left) · `[ ]` not done.

Ground rules for every item:
- The 3D layer is decoration and navigation help only. It never receives passwords, secret values, env vars or tokens.
  It gets counts at most.
- Every page must keep working in **Standard 2D** mode, with WebGL off and with reduced motion on.
- No feature is removed. No API, auth, encryption, TOTP, backup or import/export code is changed. Every route, form,
  button and API call stays exactly as it was.

## Phase 1 — Repository audit
- [x] 1.1 Read the root and client `package.json`. Stack: React 19, Vite 8, react-router 7, three 0.170 (already a dependency).
- [x] 1.2 Map the routes in `client/src/App.jsx`, including the guards (RequireVault, RequireFeature, RequireAdmin, GuestOnly).
- [x] 1.3 List the pages in `client/src/Pages` and the shared components in `client/src/Components`.
- [x] 1.4 Find the global layers: JungleScene (z -1), SkyFx, Sidebar, BottomNav, Navbar, CommandPalette, NetBar.
- [x] 1.5 Find the design tokens: `styles/theme.css`, `styles/system.css`, `docs/DESIGN_SYSTEM.md`.
- [x] 1.6 Find the existing 3D code: Smart Home `HouseModelView` (three, loaded only on that route).
- [x] 1.7 List the server routers and models. None are touched.
- [x] 1.8 Check what the other apps are: mobile (Expo), extension (MV3), hub/tv/cast/where (Kotlin), launcher (overlay patcher).
- [x] 1.9 Write the audit map → `docs/REDESIGN_AUDIT.md`.

## Phase 2 — Design system (`client/src/styles/universe.css`)
- [x] 2.1 Material tokens for dark and light: glass, smoked glass, glass edge, metal bevel, grid line, depth shadows, holo sweep.
- [x] 2.2 Environment accents through `data-env` (vault, lab, dev, ledger, security, comms, infra, media, home, admin, command).
- [x] 2.3 Mono type for IDs, status, eyebrows, sidebar group labels, palette kinds and kbd hints.
- [x] 2.4 Shared surface classes: `.surface-glass`, `.surface-metal`, `.grid-floor`, `.light-strip`, `.mono`.
- [x] 2.5 Visible focus rings everywhere.
- [x] 2.6 Sidebar as an OS dock rail: glass in immersive mode, glowing active strip, **3D toggle** in the footer.
- [x] 2.7 BottomNav (mobile) as a glass command dock with accent strip.
- [x] 2.8 CommandPalette as a holographic console, plus a new **"Switch to immersive 3D / standard 2D workspace"** command.
- [x] 2.9 What's New restyled, which also **fixes a pre-existing bug** (the modal had no padding and its button hung outside
  the frame). AlertBell is a glass notification console with accent-edged rows; ServiceStatus is a mono instrument lamp;
  InstallPrompt is a glass docking card.
- [x] 2.10 Splash / loading as a vault-core loader (orbiting ring, accent glow).
- [x] 2.11 Empty states (hologram plinth), dialogs (glass and accent strip), skeletons (holo sweep) and toasts (glass).
  The crash screen (ErrorBoundary) moved from off-brand inline purple to the design system; its logic is unchanged.
- [x] 2.12 The light theme has its own daylight environment: sky, pale mountains and white glass, with every scene palette-aware.
- [x] 2.13 Design language for web, Android, extension and TV → `docs/DESIGN_LANGUAGE.md`.

## Phase 3 — 3D foundation (`client/src/three/`)
- [x] 3.1 `capabilities.js`: WebGL detection, reduced motion, device tier.
- [x] 3.2 `immersive.js`: Standard / Immersive preference in localStorage, synced across tabs. It is a view preference, not a secret.
- [x] 3.3 `SceneHost.jsx`: lazy three import, pause off-screen and in hidden tabs, a still frame under reduced motion,
  DPR cap, frame-rate cap, full GPU dispose and context loss on unmount.
- [x] 3.4 `Immersive.jsx` (static fallback with the 3D layer on top) and `ModeToggle`.
- [x] 3.5 `kit.js`: sky dome, mountain rings, instanced towers, platforms, glow rings, particles, light paths with pulses,
  clouds, grid floor and lighting rig. All procedural; no external assets.
- [x] 3.6 Tests: `tests/universe3d.test.mjs` (route map, helpers, data-free scenes, lazy three, cleanup, Home contract).

## Phase 4 — Signed-out Home
- [x] 4.1 Hero UniverseScene: floating city, emerald security core and beam, six district islands, arched transit bridges,
  orbital loop, mountains, mist sea, clouds and particles. It sits over the WorldScene SVG fallback.
- [x] 4.2 Hero copy, the three CTAs, ServiceStatus and the privacy line are kept; the scrim stays readable.
- [x] 4.3 Workspace toggle in the hero; spec chips (AES-256-GCM, TOTP 2FA, HIBP k-anonymity).
- [x] 4.4 **District markers**: real, keyboard-focusable links pinned to the 3D islands. Hover or focus eases the camera
  toward the district.
- [x] 4.5 Command deck VaultCoreScene: an extruded metal shield with a keyhole, three ticked orbital rings, and four station
  markers with energy links. Hovering a station highlights its marker. The CSS orbits remain as the fallback.
- [x] 4.6 Six destination stations, each with its own accent and CSS-3D emblem: vault door, crystals, radar, skyline,
  node grid, device stack.
- [x] 4.7 "How it works" as a lit route through three gates, with a travelling pulse (vertical on mobile).
- [x] 4.8 Android showcase: a phone mockup with fingerprint unlock, vault health, one-tap copy, autofill and feature chips.
  `ANDROID_URL` logic unchanged.
- [x] 4.9 Footer: light strip and a mono system line; Privacy link kept.
- [x] 4.10 Checked at 1440 (dark, light, 2D, no-WebGL, reduced motion), 1024, 768 and 390.

## Phase 5 — Core vault
- [x] 5.1 `PageEnvironment`: one fixed backdrop per route, mounted once in App, never on /photos.
- [x] 5.2 VaultScene: an octagonal corridor of lit frames, glass control rooms and holo panels, then a circular vault door
  with bolts, rings and a locking wheel that **unlocks and swings open on entry**, revealing the emerald core.
- [x] 5.3 Passwords uses the vault environment; list, search, folders, favourites, reveal and copy are untouched.
- [x] 5.4 Generator uses the "creation lab" variant (door open, violet core).
- [x] 5.5 DeveloperCityScene: one tower per project, from the **project count only**, with bridges, database stacks and a
  cloud deck. Projects open from the existing list; the towers are not clickable because the backdrop sits behind the content.
- [x] 5.6 Projects, ProjectDetail, ProjectForm and Deploy use dev-city.
- [x] 5.7 Dashboard uses the Universe command backdrop.
- [x] 5.8 Page interiors (`styles/interiors.css`, scoped per environment, presentation only):
  - **Vault:** each login is a machined *storage module* (corner rivets, a lid seam, an LED strength rail). Hidden secrets
    are a hatched, sealed slot and revealed ones a lit slot. Favourites are *gold-sealed* modules. Folders are
    *compartment drawers* with a lit lip. Stats form an instrument strip and search is a console field.
  - **Generator:** a holographic display with scanlines and a scanning beam.
  - **Projects:** *development stations* with a station skyline and a lit roof strip.
  - **Security Center:** monitoring rows with pulsing status LEDs. Settings shows sessions as an access log.
  - **Infrastructure:** rack panels with three LEDs, mono table heads and lit row hovers.
  - **Admin:** a console table.

## Phase 6 — Security and account
- [x] 6.1 SecurityCenterScene: curved holographic display wall, floor radar with sweep, pulsing sensor pylons. It shows no
  numbers by design, so it can never fake a status.
- [x] 6.2 Security Center, Security and Settings (sessions, 2FA, backups) use the SOC environment.
- [x] 6.3 Sign in and Forgot: the 3D vault facility inside the existing scene panel. **The door unlocks while a sign-in
  request runs.** The form card gets an accent strip.
- [x] 6.4 Privacy and Logout use the calm universe backdrop.

## Phase 7 — Infrastructure
- [x] 7.1 InfrastructureScene: a server-rack city with LED faces, bidirectional data lanes and a purple/blue cloud deck.
- [x] 7.2 Servers, Services, Service map, Render and Cron use it. Their opaque `.rd-page` background becomes translucent in
  immersive mode only. All status still comes from real data.

## Phase 8 — Integrations and Smart Home
- [x] 8.1 MediaGalleryScene: two arcs of floating frames with generated abstract art (never user images), reflective floor.
- [x] 8.2 Media uses the gallery. Photo Cloud keeps its own look on purpose (App.jsx already opts it out).
- [x] 8.3 WhatsApp and SMS use the comms SOC variant; Money uses the gold "ledger" city.
- [x] 8.4 Smart Home: a glass house and garden habitat behind the page. Its real 3D house view with live device data is unchanged.

## Phase 9 — Administration
- [x] 9.1 Admin, GGN Admin and App Updates use the command backdrop with the admin accent.
- [x] 9.2 The Apps page uses the ecosystem backdrop.
- [x] 9.3 Role guards untouched.

## Phase 10 — Ecosystem consistency
- [x] 10.1 Extension popup: accent strip, mono technical text, focus ring (CSS only).
- [x] 10.2 Mobile (Expo): `src/lib/theme.js` now uses the web palette in both themes: midnight navy with emerald
  `#22C58F` in dark, daylight neutrals with forest `#0D6E5C` in light. Every text and accent pair passes WCAG AA
  (4.75–14.6:1). Status colours in Stashr Home stay semantic.
  - Verified: `expo export --platform android` succeeds.
  - Verified: the app's web build renders the real sign-up screen in both schemes.
- [x] 10.3 TV, cast, hub and where already use the web palette (verified in `colors.xml`); the launcher is recorded in the doc.

## Phase 11 — Testing and shipping
- [x] 11.1 `npm test`: 243 pass, 0 fail (13 new).
- [x] 11.2 `npm run lint`: 0 errors. The 2 warnings were already there.
- [x] 11.3 `npm run build` passes. three ships in its own lazy chunk (about 173 KB gzipped) and each scene is 1–3 KB
  gzipped. The entry bundle grew by about 3 KB gzipped.
- [x] 11.4 Playwright (headless Chromium, SwiftShader WebGL) screenshots with **no console errors**:
  - Home: 3D, 2D, no-WebGL, light theme, reduced motion, mobile.
  - 20 signed-in routes at desktop and mobile. These used a mocked `/authenticate` with sample data, kept in the scratchpad
    and never committed.
  - Sign in and Forgot in dark and light.
- [x] 11.5 Committed and pushed to `tanush/bold-dirac-qnxa2j`; draft PR Tanushh18/stashr-Home-Automation#111.

## Phase 12 — Follow-ups requested after the first PR
- [x] 12.1 **Camera flights between pages.**
  - Every scene arrives with a 1.5 s flight: drawn back, raised and widened, then easing into its pose. The offset is
    applied for the draw only, so scene camera logic is untouched.
  - The outgoing environment hands off with a 0.9 s fade while an accent transit streak sweeps past.
  - Off under reduced motion.
  - Verified in Chromium at 150 / 450 / 900 / 2200 ms after clicking Passwords → Projects.
- [x] 12.2 **Custom desktop cursor.**
  - A trailing halo grows over links and buttons, narrows to a caret over text fields and dips on press.
  - The system cursor is never hidden (a test enforces this).
  - Fine pointers in immersive mode only; the loop sleeps when the pointer is idle.
- [x] 12.3 **GLB models.**
  - `scripts/build-models.mjs` writes `public/models/stashr-shield.glb` (85 KB, 27 KB gzipped) and `vault-door.glb`
    (101 KB, 44 KB gzipped).
  - Both are generated, so they're original work: welded geometry with `KHR_mesh_quantization`.
  - The command-deck shield and the vault door load from them through a lazy GLTFLoader chunk (13.6 KB gzipped),
    falling back to the code-built geometry if loading fails.
  - Tests check the files are valid glTF 2.0 and byte-for-byte reproducible.
  - The service worker caches `.glb` for offline use.
- [x] 12.4 **Image-based lighting.** Scenes reflect a PMREM RoomEnvironment (high-tier devices; about 1 KB gzipped), so
  metal and glass read as real materials. It is freed on unmount.
- [x] 12.5 **Mongoose advisory.**
  - The `server/package-lock.json` change touches mongoose's packages only: mongoose 9.10.2 → 9.12.2, the mongodb driver
    7.6 → 7.8, plus kareem, mquery and sift patches. The `^9.10.2` range is unchanged.
  - `npm audit --omit=dev --audit-level=high` reports 0 vulnerabilities.
  - The full server suite passes locally: 1101 / 1101.
- [x] 12.6 **Extension.** The real MV3 extension was loaded into Chromium: the service worker starts, the popup renders in
  dark and light, keyboard focus is visible and there are no page errors. Fixed its header accent strip being clipped.
- [x] 12.7 **TV, hub, cast and where (Kotlin).** No code changes. Their Gradle unit tests and debug builds pass in this
  PR's CI.
- [x] 12.8 Tests: 243 client tests pass, 11 of them for the 3D layer, models, flights, cursor, interiors and mobile palette.

## Still outside what can be verified here
- **Physical devices.** Android, TV and extension behaviour was checked through CI builds, the Expo web build and
  extension-in-Chromium, not on real hardware.
- **Signed-in flows end to end.** Password CRUD, reveal and copy, project CRUD, server operations and admin actions were
  not run against a live API with MongoDB. Page logic is unchanged, so the risk is visual only.
