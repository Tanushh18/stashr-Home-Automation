# Stashr roadmap: what to add next

Written 26 Oct 2026 after a full review of the web app, API, Android app and browser extension.
The feature ideas come from what mature password managers (Bitwarden, 1Password, Proton Pass) offer,
filtered by what fits Stashr's own shape: a vault **plus** a project/infrastructure manager.
This is a planning list, not a record of live competitor research.

## Shipped in this upgrade (web + Android + API)
| Area | Web | Android | API |
|---|---|---|---|
| Trash (30-day restore) and per-item password history | yes | yes | stored in the item (no schema change) |
| Bulk select: favourite, move, trash | yes | yes | - |
| Folder rename / merge | yes | yes | - |
| Delta sync (only what changed) | yes | yes | `GET /vault/changes?since=` |
| Live updates between devices | yes | yes | `GET /vault/events` (Server-Sent Events) |
| Command palette (`Ctrl/Cmd+K`), clipboard auto-clear | yes | clipboard clear already existed | - |
| Incident bell with desktop notifications | yes | not yet | uses `/render/ops/incidents` |
| Opt-in weekly breach check | yes | not yet | - |
| Control Center tab bar (Control Center / Usage / Map / Cron) | yes | n/a | - |
| Photo Cloud: multi-select (favourite, share link, remove) | yes | - | - |
| Secure notes, cards and identities as item types | yes | yes | stored inside the item |
| Devices list with per-device sign-out, security activity log | yes | - | `GET /account/sessions`, `DELETE /account/sessions/:id`, `GET /account/audit` |
| Sign-in rate limits that survive restarts, per-account lockout | n/a | n/a | MongoDB `rate_hits` (TTL) |
| Opt-in weekly breach check, open-incident banner | web | yes | - |

## Still open, and why it was not built yet
| Item | Why it is not done |
|---|---|
| Passkeys (WebAuthn) sign-in | Security-critical; needs a real authenticator to test end to end. A bug would weaken sign-in, so it needs a careful, separately reviewed change. |
| Shared folders between users | Needs a sharing/ACL model decision first (items are encrypted with a per-account key). |
| Attachments | Needs blob storage and size/abuse limits chosen. |
| Emergency access | Needs outbound email and a waiting-period workflow. |
| Vault entries in their own collection | Rewrites every route that touches `passwords`; needs a backup and a reversible migration. Delta sync already removes the main performance pain. |
| Offline web vault | A readable local copy of the vault is a security trade-off that needs a decision. |
| Android notifications / APK pipeline | Needs the build and push credentials. |

## Next, in priority order

### 1. Security foundations (do before adding more features)
- **Decide the encryption model and say it plainly.** Today items are encrypted on the server with a server-wrapped
  per-account key. True end-to-end encryption (key derived from a master password on the device) would make the
  "zero-knowledge" claim real, but costs server-side features (Render env sync, background monitoring need secrets).
  A realistic middle path: keep server-side encryption for infrastructure secrets, offer an **optional end-to-end
  vault** for passwords only.
- **Passkeys (WebAuthn) for sign-in**, then store passkeys as vault items.
- **Persistent rate limiting and per-account lockout** (MongoDB TTL collection) instead of the in-memory counter.
- **Active sessions page** (list devices, revoke one) and an **audit log** of sensitive actions.

### 2. Vault features
- **Secure notes, cards, identities and documents** as first-class item types (today everything is a login).
- **Item sharing and shared folders** between Stashr users, with read-only / edit roles.
- **Emergency access**: a trusted contact can request access after a delay.
- **Password health 2.0**: flag items without 2FA where the site supports it, expiring items, and duplicates to merge.
- **Browser extension autofill improvements**: save-on-submit prompt, per-site matching rules, TOTP autofill.
- **Encrypted export / scheduled backups** to a connected Drive, with a restore test.
- **Attachments** (small files) on items.

### 3. Infrastructure side (Stashr's differentiator)
- **One Infrastructure area** (tabs are in place; next merge the data models behind Render and Services).
- **Alerts everywhere**: Web Push + the Android notification channel, alongside Telegram; quiet hours.
- **Env diff and rollback** before "Push to Render" (show what changes, keep the previous values).
- **Activity timeline per project**: deploys, env changes, incidents, syncs in one list.
- **More providers** behind the existing adapter pattern (Vercel, Netlify, Fly.io, Cloudflare).

### 4. Photos
- Albums, timeline by month, multi-select and bulk share, duplicate finder, slideshow.

### 5. Platform and scale
- **Move vault entries out of the single User document** into their own collection (removes the 16 MB document
  ceiling and whole-document rewrites). Delta sync is already in place and does not need to change; this is a data
  migration, so take a backup and ship a reversible migration script first.
- **Offline mode on the web** (read-only vault from an encrypted local cache through the service worker).
- **Android and iOS build pipeline**: the committed `client/public/apps/stashr.apk` is a manual upload. Build it in CI
  (GitHub Actions) and publish to GitHub Releases instead of storing 80 MB in git.
- **Shared code package** for item/crypto/sync logic. `items.js` and `sync.js` are currently copied between
  `client/src/lib` and `mobile/src/lib`; a test that fails when the two diverge is the cheap first step.
- **Observability**: request IDs in logs, error tracking, richer `/health`.

## Not planned
- Anything that needs the vault to stay readable by the server for features it does not need.
- Replacing the existing importers (Chrome, Bitwarden, 1Password, LastPass CSV already work).
