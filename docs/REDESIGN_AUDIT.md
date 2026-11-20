# Stashr redesign — repository audit map

This is a snapshot taken before the 3D redesign. It records what exists so the redesign changes presentation only.

## Stack
| Part | Tech |
|---|---|
| Web client (`client/`) | React 19, Vite 8, react-router 7, axios, react-toastify, three 0.170, leaflet, qrcode, xlsx |
| API (`server/`) | Express, helmet, cors, compression, cookie-parser, MongoDB (models in `server/models`) |
| Mobile (`mobile/`) | Expo / React Native, expo-router (`src/app`), tokens in `src/lib/theme.js` (slate + Stashr green, Plus Jakarta Sans) |
| Extension (`extension/`) | Manifest V3: popup, unlock page, content scripts; tokens copied from the web palette in `popup.css` |
| hub-app, tv-app, cast-app, where-app | Native Kotlin Android apps (Gradle), each with its own APK workflow |
| launcher-app | Python overlay patcher applied to an upstream launcher |

## Web routes (client/src/App.jsx)
Guards:
- `RequireVault`: signed in or locked; otherwise redirects to /signin.
- `RequireFeature(feature)`: needs `profile.features[feature]`.
- `RequireAdmin`: needs `profile.isAdmin`.
- `GuestOnly`: for signed-out visitors only.

| Path | Page | Guard |
|---|---|---|
| `/` | Home (signed out) → redirects to `/dashboard` when signed in | — |
| `/dashboard` | Dashboard | vault |
| `/signin`, `/forgot-password` | Login, Forgot (`/signup` → `/signin`) | guest |
| `/passwords` | Passwords (vault) | vault |
| `/generator` | Generator | vault |
| `/projects`, `/projects/new`, `/projects/deploy`, `/projects/:id`, `/projects/:id/edit` | Projects suite | vault |
| `/settings` | Settings (sessions, 2FA, backups) | vault |
| `/security-center` | Security Center | vault |
| `/security` | Security | admin |
| `/servers` | Servers registry | admin |
| `/services`, `/services/map`, `/cron`, `/render` | Infra tabs | vault |
| `/media` | Media | admin |
| `/photos`, `/photos/import`, `/photos/shared/:id` | Photo Cloud | feature |
| `/share/photos/:token` | Public photo share | — |
| `/money`, `/smart-home`, `/whatsapp`, `/sms`, `/ggnhome-admin` | Integrations | vault |
| `/admin` | Admin | feature adminPanel |
| `/app-updates` | App Updates | admin |
| `/apps`, `/privacy`, `/logout` | Public pages | — |

## Global shell (always mounted)
| Component | Role | Notes |
|---|---|---|
| NetBar | Connection banner | |
| CommandPalette | Command palette | |
| JungleScene | Fixed decorative backdrop | z -1 |
| SkyFx | Ambient flying robots and planes | z 45 |
| Navbar | Top navigation | |
| Sidebar | Signed-in sidebar | |
| ToastContainer | Toast notifications | |
| InstallPrompt | PWA install prompt | |
| BottomNav | Mobile navigation | |

- Photos routes opt out of the system styling through `body.route-photos`.

## Design tokens
- `client/src/styles/theme.css`:
  - Palette for dark and light, with `--emerald`, `--river` and `--runway`.
  - Fonts: `--font-display` (Plus Jakarta Sans).
  - Legacy classes: `.btn`, `.card`, `.input`, `.pill`.
- `client/src/styles/system.css`: type, spacing and motion scales, the shell, and `.ui-*` primitives.
- `docs/DESIGN_SYSTEM.md` documents the above.

## Existing 3D and illustrations
- `Components/WorldScene`: SVG city, waterfall and river. Used on Home and as banner strips.
- `Pages/SmartHome/HouseModelView.jsx`: real three.js house built from imported .glb or a generated layout, with room tinting from live presence data. Uses `lib/houseScene.js` and `lib/houseGlb.js`.
- `Components/TransitCity`, `Robot`, `Jungle`, `SkyFx`: CSS/SVG illustration systems.

## API surface (server/router)
- All routers are mounted through `routing.js`:
  - Account and identity: account, mpin, link, passwordReset, extension
  - Vault and projects: vault, projects
  - Deploy and hosting: render, deployOps, github, hosts, moveServer, statusPage
  - Home automation: home, homeMore, homeWhere, homeInsights, homeRoom, homeShare
  - Messaging: wa, sms, telegram
  - Other: ggnadmin, expenses, assistant, photoCloud, admin, registry, shineMedia, stashrPropagation
- Mounted directly on the app: `/api/mobile-updates`, `/api/app-rollout`, `/api/ota`.
- Auth: `middlewares/authenticate.js`. Rate limiting: `middlewares/rateLimit.js`.
- Vault encryption: `models/EncDecManager.js`.

**The redesign touches none of these.**

## Constraints found
- The client is a static site. No CSP is set in `index.html`, and the API sets its own headers with helmet. three.js needs no `eval`, so no header changes are needed.
- three is already a dependency but is used only on the Smart Home route. New scenes must load it lazily so it stays out of the entry bundle.
- Signed-in screens cannot be exercised here without the API and MongoDB. Visual checks for them are limited to build success and static rendering.
