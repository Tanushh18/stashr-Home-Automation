# Stashr — Password Vault & Project Secrets

Stashr is a web and Android application for managing saved logins and project configuration from a shared API. The repository includes a React/Vite web client, an Express API, and an Expo/React Native mobile client.

> **Security scope:** This README describes repository setup and the visible design. It is not a security audit or a guarantee that the deployed service is secure. Do not place real vault data, production tokens, API keys, private keys, database dumps, or password exports in Git.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [App development, OTA and Android releases](APP_DEVELOPMENT_AND_RELEASE.md)
- [Technology](#technology)
- [Requirements](#requirements)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Run tests and builds](#run-tests-and-builds)
- [Deployment](#deployment)
- [Security and privacy notes](#security-and-privacy-notes)
- [Repository hygiene](#repository-hygiene)
- [Troubleshooting](#troubleshooting)

## Features

- Password and login entry management, folders, favorites, password generation, and vault-health checks.
- Project records for hosting, databases, cloud integrations, environment variables, and custom fields.
- Web client and Android client using the same API.
- Optional TOTP-based second factor and one-time recovery codes for account sign-in.
- Import/export and encrypted backup flows.
- Optional breach checks using Have I Been Pwned's k-anonymity range API.
- Optional integrations including Google Drive (movies for the TV), GitHub, Telegram alerts, Brevo email, and Groq-powered diagnostics.
- API health/readiness endpoints and optional scheduler/keep-alive jobs.

Optional integrations require explicit configuration and their own provider credentials. A feature may be unavailable when the corresponding credentials are not configured.

## Architecture

```text
.
├── server/       Express API, database models, authentication, integrations
├── client/       React + Vite web application
├── mobile/       Expo + React Native Android application
├── extension/    Chrome/Chromium autofill extension
├── docs/         Security design and project documentation
├── .github/      CI and the APK + OTA release workflow
├── render.yaml   Render Blueprint for web and API services
├── APP_DEVELOPMENT_AND_RELEASE.md  App structure, API, OTA and APK release guide
└── README.md
```

### API server

- Entry point: `server/server.js`
- Express app and middleware: `server/app.js`
- MongoDB connection: `server/db/connection.js`
- API route registration: `server/router/routing.js`
- Server-side encryption helpers / legacy item handling: `server/models/EncDecManager.js`
- Security notes: [docs/SECURITY.md](docs/SECURITY.md)

The server reads `server/config.env` first, then the normal environment (including the hosting provider's environment variables). The checked-in template is `server/config.env.example`.

### Web client

- Source: `client/src/`
- API client: `client/src/api/client.js`
- Local development server: Vite
- Build output: `client/build/`

The API base URL can be configured at build time using `VITE_API_URLS` (comma-separated). The client also contains a default API endpoint, so do not assume an unset variable means it makes no network requests.

### Android client

- Source: `mobile/src/`
- API client: `mobile/src/lib/api.js`
- App configuration: `mobile/app.json`
- Expo configuration can provide fallback API server URLs. The client supports `EXPO_PUBLIC_API_URLS` (comma-separated).

Only use public client variables for non-secret configuration. Anything with an `EXPO_PUBLIC_` prefix may be embedded into the app bundle and must not contain credentials.

## Technology

| Area | Main tools |
| --- | --- |
| API | Node.js 20+, Express 5, Mongoose, MongoDB, dotenv, Helmet, bcrypt, JWT |
| Web | React, React DOM, Vite, React Router, Axios |
| Android | Expo SDK, Expo Router, React Native, SecureStore, native crypto |
| Tests | Node test runner, Supertest, MongoDB Memory Server |
| Hosting | Render Blueprint in `render.yaml` |

Refer to each package manifest for the precise dependency versions and scripts.

## Requirements

- Git
- Node.js 20 or newer for the API; Node.js 20.19 or newer for the web client's current Vite toolchain
- npm
- A MongoDB deployment for persistent local use (local MongoDB or MongoDB Atlas)
- Android Studio / Android SDK and JDK compatible with the installed Expo/React Native toolchain for native Android builds

Use a supported Node.js LTS release and install the Android tooling according to current Expo documentation.

## Local setup

### 1. Clone the repository

```bash
git clone https://github.com/Tanushh18/password-manager.git
cd password-manager
```

### 2. Configure the API server

```bash
cd server
npm install
cp config.env.example config.env
```

On Windows PowerShell, use:

```powershell
Copy-Item config.env.example config.env
```

Edit `server/config.env` with a local MongoDB connection string and unique secrets. Generate strong independent random values:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run the command twice; use one output for `SECRET_KEY` and the other for `CRYPTO_SECRET_KEY`. Never use the sample strings from the template in a deployed environment.

Start the API:

```bash
npm run dev:start
# or
npm start
```

The API listens on `http://localhost:8000` by default. Health endpoints include `/health`, `/livez`, and `/readyz`. Readiness requires a connected database.

### 3. Start the web client

Open another terminal from the repository root:

```bash
cd client
npm install
```

Create `client/.env.local` if you want to override the default API address:

```dotenv
VITE_API_URLS=http://localhost:8000
```

Then run:

```bash
npm run dev
```

Vite prints the local URL. If the server URL is changed, restart Vite so the updated build-time environment is read.

### 4. Start the Android app

```bash
cd mobile
npm install
```

For an emulator/device using a locally running API, set the API URL to an address reachable from that device:

```bash
EXPO_PUBLIC_API_URLS=http://YOUR_LAN_IP:8000 npx expo run:android
```

For Android Emulator, the host machine is commonly reachable at `10.0.2.2`; for a physical device, use your computer's LAN IP and ensure the firewall permits the connection. Do not use `localhost` from a physical device to refer to your development computer.

The native build uses native modules; Expo Go alone may not support the complete app.

### 5. Configure optional providers

Enable only the integrations you plan to use. Typical secrets/configuration include:

- Google OAuth client ID/secret and the exact registered callback URI for the TV's movies from Google Drive.
- Brevo API key plus a verified sender email for password-reset email.
- A random scheduler secret for a trusted monitor that calls the protected operations endpoint.
- Optional Groq key for diagnostics when enabled and consented to.
- A GitHub token or Telegram bot token may be entered by an authenticated user in the app. These are user-provided integration credentials, not values that belong in the repository.

Store production credentials in the hosting platform's secret/environment settings, not in source control or in the web/mobile build environment.

## Environment variables

The canonical API template is `server/config.env.example`. The core values are:

| Variable | Required? | Purpose |
| --- | --- | --- |
| `MONGO_URL` | Yes for persistent API data | MongoDB connection string. `DATABASE` and `MONGODB_URI` are also accepted aliases by the connection helper. |
| `SECRET_KEY` | Required by authentication/session features | JWT/authentication signing secret. |
| `CRYPTO_SECRET_KEY` | Required by server-side encrypted features | Protects server-held encryption keys and legacy/server-readable secrets. Keep it stable and separate from `SECRET_KEY`. |
| `PORT` | No | API port; defaults to `8000`. |
| `NODE_ENV` | No | Runtime mode. Set to `production` in deployment. |
| `CLIENT_ORIGINS` | No | Comma-separated allowed web origins. |
| `EXTENSION_ORIGINS` | No | Comma-separated exact Chrome extension origins. |
| `SELF_URL` | No | Public API URL used by keep-alive and callbacks. Render can provide `RENDER_EXTERNAL_URL`. |
| `KEEP_ALIVE`, `KEEP_ALIVE_MINUTES` | No | Configure optional periodic self-ping. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth configuration for the TV's movies (Google Drive). |
| `GOOGLE_PHOTO_REDIRECT_URI` | Optional | Exact Google OAuth callback URL. |
| `PHOTO_CLOUD_CLIENT_URL` | Optional | Web client URL used by the Google sign-in redirect. |
| `RENDER_MONITOR_CRON_SECRET` | Optional | Shared secret for a trusted monitoring scheduler. |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Optional | Transactional mail configuration. Configure a verified sender in Brevo. |
| `GROQ_API_KEY`, `GROQ_MODEL` | Optional | Optional AI-assisted diagnostics. |

Check code and provider settings before adding more variables: integrations evolve. Never copy real production values into this table or into `.env.example`.

## Run tests and builds

### API tests

```bash
cd server
npm test
```

### Web tests, lint, and production build

```bash
cd client
npm test
npm run lint
npm run build
```

### Android tooling

```bash
cd mobile
npm run doctor
```

The signed APK and the OTA bundle are built by the **Stashr Android Release** GitHub Actions workflow and published as a GitHub Release. The Stashr API server serves both to the app. Local builds: `npx expo prebuild --platform android` and `cd android && ./gradlew assembleRelease`. See [APP_DEVELOPMENT_AND_RELEASE.md](APP_DEVELOPMENT_AND_RELEASE.md) for secrets and the release checklist.

## Deployment

The root `render.yaml` describes a static web service rooted at `client/` and a Node web service rooted at `server/`.

1. Create/select the Render Blueprint for this repository.
2. Configure all required server environment variables in Render's Environment settings.
3. Configure `VITE_API_URLS` as a build-time setting for the static client.
4. Set `CLIENT_ORIGINS` to the exact deployed site origin(s); avoid broad CORS allowlists.
5. Use the same database and matching auth/encryption secrets across API instances that share a database.
6. Set the trusted monitoring secret only if an external scheduler is configured to use it.
7. Deploy and verify `/health` and `/readyz`.

Do not put secret values into `render.yaml`. The Blueprint should contain variable names and non-sensitive defaults only.

## Security and privacy notes

### Encryption claims

The repository contains multiple generations of encryption behavior. Newer client code and `docs/SECURITY.md` describe device-side PBKDF2 and AES-GCM for vault entries, while server code also contains server-side encryption helpers for legacy entries and features such as TOTP. The root README has historically described a different current model. Review code paths before making any claim that every data type is end-to-end encrypted or zero-knowledge.

At minimum:

- Treat `CRYPTO_SECRET_KEY` and the database as high-value secrets.
- Do not log passwords, tokens, cookies, request bodies, recovery codes, or decrypted vault contents.
- Keep HTTPS enabled in production.
- Use unique high-entropy secrets and a least-privilege database user.
- Use two-factor authentication on source-control and deployment accounts.
- Exported CSVs and decrypted backups are plaintext and must be stored securely and deleted when no longer required.
- Third-party integrations may send metadata to their providers. Review each integration before enabling it.
- No master-password recovery may be possible for vault data encrypted solely by a locally-derived key; maintain encrypted backups securely.

### If a credential has ever been committed

Deleting it from the current file is not sufficient. Assume it may remain accessible through Git history, forks, caches, or artifacts. Revoke/rotate the credential with its provider first, then remove the exposed value and consider history cleanup. Never paste a credential into an issue or chat when asking for help.

## Repository hygiene

- Keep local `config.env`, `.env`, provider credentials, private keys, database dumps, recovery scripts and plaintext exports out of Git.
- Use `server/config.env.example` as a template only; its values must be placeholders, never valid credentials.
- Only expose `VITE_*` and `EXPO_PUBLIC_*` variables when they are safe for every user of the built client.
- Do not commit production account data, logs, screenshots containing secrets, cloud service-account JSON, or copied database records.
- Before sharing the repo, inspect recent commits and Git history with secret scanning. GitHub secret scanning may not detect every private or custom credential pattern.

## Troubleshooting

**API says no database URL is configured**
- Set `MONGO_URL` in `server/config.env` or the server environment and check that the DB accepts connections.

**Login/session failures across server instances**
- Ensure all instances sharing a database use the same auth/encryption environment values, and check cookie/CORS settings for the deployed site.

**Web app calls the wrong API**
- Set `VITE_API_URLS` and rebuild/restart Vite. Check the configured API fallback in `client/src/api/client.js`.

**Android app cannot reach a local server**
- Use a reachable LAN IP or emulator host alias, not the phone's own `localhost`.

**Password-reset email is not sent**
- Configure a valid Brevo API key and sender verified with Brevo in the server environment.

## Contributing

1. Keep changes focused and avoid committing secrets or real account data.
2. Run the relevant test, lint, and build commands.
3. Describe behavior changes and any new environment variables in the pull request.
4. Update this README and `docs/SECURITY.md` when security behavior or encryption claims change.

## License

Check the applicable license and project ownership before redistributing or deploying this application. The API package currently declares ISC, but that package-level declaration may not by itself define the license of the entire repository.
