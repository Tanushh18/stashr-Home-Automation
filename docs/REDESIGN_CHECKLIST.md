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
- [~] 2.9 What's New restyled, which also **fixes a pre-existing bug** (the modal had no padding and its button hung outside
  the frame). AlertBell, ServiceStatus and InstallPrompt pick up the tokens and focus rings but have no bespoke restyle.
- [x] 2.10 Splash / loading as a vault-core loader (orbiting ring, accent glow).
- [~] 2.11 Empty states (hologram plinth), dialogs (glass and accent strip), skeletons (holo sweep) and toasts (glass) are
  done. The ErrorBoundary screen is not restyled.
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
- [~] 5.8 Page interiors (the vault list, folders, item cards, generator controls, project tree) keep their existing layouts.
  They take the new materials (glass cards, accent strips, mono labels) but were not re-laid out as "storage modules" or
  "compartments".

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
- [~] 10.2 Mobile (Expo): the gap is documented (slate and `#22C55E` versus the web's emerald). App code is unchanged
  because there's no device here to verify it on.
- [x] 10.3 TV, cast, hub and where already use the web palette (verified in `colors.xml`); the launcher is recorded in the doc.

## Phase 11 — Testing and shipping
- [x] 11.1 `npm test`: 237 pass, 0 fail (7 new).
- [x] 11.2 `npm run lint`: 0 errors. The 2 warnings were already there.
- [x] 11.3 `npm run build` passes. three ships in its own lazy chunk (about 173 KB gzipped) and each scene is 1–3 KB
  gzipped. The entry bundle grew by about 3 KB gzipped.
- [x] 11.4 Playwright (headless Chromium, SwiftShader WebGL) screenshots with **no console errors**:
  - Home: 3D, 2D, no-WebGL, light theme, reduced motion, mobile.
  - 20 signed-in routes at desktop and mobile. These used a mocked `/authenticate` with sample data, kept in the scratchpad
    and never committed.
  - Sign in and Forgot in dark and light.
- [ ] 11.5 Commit, push to `tanush/bold-dirac-qnxa2j` and open a draft PR.

## Not done / out of scope for this pass (deliberately honest)
- **Camera transitions between routes.** Each route builds its own scene; there is no continuous fly-through between
  districts across navigation.
- **Custom desktop cursor.** Not added, to keep standard pointer behaviour.
- **GLTF/GLB models.** Everything is procedural geometry, which keeps downloads tiny. The Smart Home .glb import path is unchanged.
- **Per-page interior re-layouts** (see 5.8). Pages keep their proven layouts and gain the new materials.
- **Signed-in flows end to end** (password CRUD, reveal and copy, project CRUD, server operations, admin actions) were not
  exercised against a real API with MongoDB. Page logic was not modified, so the risk is visual only.
- **Android, TV and extension on real devices** were not tested.
