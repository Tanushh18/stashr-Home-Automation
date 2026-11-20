# Stashr Universe — design language

This is one visual language across every Stashr surface. The web client gets the full spatial treatment. The other surfaces
share the same colours, type and motion rules at a cost that suits each device.

## Principles
1. **The 3D layer is an interface layer, not the interface.** Every action stays a normal, accessible HTML control. Scenes are
   decoration and orientation only.
2. **Never show what isn't real.** Scenes show no numbers and no statuses. Pages show real data from the API, and nothing
   simulates a healthy state.
3. **Secrets never reach the GPU.** Scenes may receive counts (for example, the number of projects) and nothing else. A unit
   test (`client/tests/universe3d.test.mjs`) fails if a scene imports vault state, the API, crypto or storage.
4. **Progressive enhancement.** Standard 2D mode, missing WebGL, reduced motion and low-power devices all get a complete,
   working app.

## Colour
| Token | Dark | Light | Use |
|---|---|---|---|
| `--emerald` | #12a37a | — | Primary brand, vault |
| `--river` | #2bb3b1 | — | Links, transit lines, focus |
| `--runway` | #f5c86a | — | Labels and departure-board accents |
| `--env` | per environment | per environment | Accent of the current module (below) |

Environment accents are set by `data-env` on `<html>`. `PageEnvironment` sets it for every route.

| Environment | Routes | Accent |
|---|---|---|
| vault / facility | Passwords, Sign in, Forgot | emerald `#22c58f` |
| lab | Generator | violet `#8b7cf6` |
| dev | Projects | cyan `#38bdf8` (light `#0284c7`) |
| ledger | Money | gold `#d9b45a` (light `#a07818`) |
| security | Security Center, Security, Settings | teal `#2dd4bf` |
| comms | WhatsApp, SMS | rose `#f472b6` |
| infra / admin | Servers, Services, Cron, Render, Admin, App Updates | blue `#60a5fa` (light `#2f5fd0`) |
| media | Media | rose `#f472b6` |
| home | Smart Home | garden green `#6fcf6a` |
| command / ecosystem | Dashboard, Apps, Privacy | teal `#2bb3b1` |

The light theme has its own world: daylight glass (`--glass-1: rgba(255,255,255,.66)`), sky-blue skies, pale mountains and
warm horizons. It is not an inversion of the dark theme.

## Materials (`client/src/styles/universe.css`)
- `--glass-1` / `--glass-2`: frosted and smoked glass panels.
- `--glass-edge`: the hairline edge on glass.
- `--metal-edge`: a bevel gradient, used through the `.surface-metal` mask.
- `--depth-1…3`: depth shadows, each with an inner highlight.
- `--grid-line`: a fine architectural grid (`.grid-floor`).
- `.light-strip`: an accent strip with a glow. It is used under page heads, on active nav items, on dialogs and on the
  palette.

In the immersive workspace, `.card`, `.ui-panel` and `.ui-stat` turn to glass so the environment shows through. Standard
mode keeps solid surfaces.

## Type
- Display: Plus Jakarta Sans (`--font-display`), for page titles and section heads.
- UI: Inter / system sans.
- Technical: `--font-mono` (JetBrains Mono → SF Mono → Menlo), for IDs, codes, status chips, page eyebrows, sidebar group
  labels, palette kinds and kbd hints.

## Motion
- Transform and opacity only; the camera eases with exponential damping (`damp()` in `three/kit.js`).
- Scenes pause off-screen and in hidden tabs. Backdrops are capped at 30 fps, and at 24 fps on low-tier devices.
- `prefers-reduced-motion` renders a single still frame and stops every CSS loop.

## 3D architecture (`client/src/three/`)
| File | Role |
|---|---|
| `capabilities.js` | WebGL detection, reduced motion, device tier |
| `immersive.js` | Standard / Immersive preference (localStorage, synced across tabs) |
| `SceneHost.jsx` | Lazy three import, renderer lifecycle, pause/resize/dispose, frame cap |
| `Immersive.jsx` | Static fallback with a 3D overlay; the `ModeToggle` button |
| `PageEnvironment.jsx` | One fixed backdrop per route; sets `data-env` and `data-workspace` |
| `environments.js` | Route → scene, variant and accent (pure, tested) |
| `kit.js` | Procedural primitives: sky dome, mountains, instanced towers, platforms, rings, particles, light paths, clouds, grid |
| `scenes/universe.js` | Floating city, security core and six district islands; drives the HTML district markers on Home |
| `scenes/vaultCore.js` | Shield core, orbital rings and station markers (Home command deck) |
| `scenes/vault.js` | Vault facility: corridor, door that opens on entry or sign-in, emerald core |
| `scenes/devCity.js` | One tower per project (count only), bridges, databases, cloud deck |
| `scenes/soc.js` | Curved display wall, radar sweep, sensor pylons |
| `scenes/infra.js` | Server-rack city with data lanes |
| `scenes/gallery.js` | Floating gallery of abstract frames (never user images) |
| `scenes/habitat.js` | Glass house and garden behind Smart Home |

All geometry is procedural and textures are generated canvases, so there are no external assets or network requests.
three.js and each scene ship as separate lazy chunks: three is about 173 KB gzipped and loads only in immersive mode, and
each scene is 1–3 KB.

## Other surfaces
| Surface | Rule |
|---|---|
| Android (Expo, `mobile/src/lib/theme.js`) | Plus Jakarta Sans as on the web. **Known gap:** the app uses slate neutrals with green `#22C55E`, not the web's midnight navy with emerald `#12a37a` / `#22c58f`. Align it the next time the mobile theme is touched; it was not changed here because it can't be checked on a device in this environment. Native interactions and no WebGL scenes: mid-range phones get speed, not spectacle. |
| Chrome extension (`extension/popup.css`) | Same tokens. It adds the accent strip, mono technical text and focus ring. It stays compact and fast, with no 3D. |
| TV / cast / hub / where (Kotlin) | Already on the web palette in `res/values*/colors.xml` (`bg #08121A` / `#F5F7F2`, `primary #0E7F6D` / `#0D6E5C`). Layouts follow each app's purpose (10-foot UI, casting, tablet hub, location). No 3D. |
| Launcher (overlay patcher) | Wallpaper and accent colour from this palette only. |
