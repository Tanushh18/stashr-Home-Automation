# Stashr Launcher

A phone launcher (home screen) for the family, built from [Lawnchair](https://github.com/LawnchairLauncher/lawnchair) with Stashr's name,
icon and colour. Lawnchair is large (about 480 MB with its prebuilt libraries), so **this folder holds only the Stashr changes**; the build
fetches Lawnchair at a pinned version and applies them.

| File | What it is |
|---|---|
| `UPSTREAM` | Which Lawnchair repository and commit the launcher is built from |
| `apply.py` | The edits to Lawnchair's own files (name, package id, version, default colour, and "Lawnchair" → "Stashr" in the on-screen text). Stops with a message if Lawnchair has changed that text |
| `overlay/` | Files copied over Lawnchair's: the Stashr icon (adaptive, round, themed) and colour |
| `version.txt` | The launcher's version (`1.0.0`) |
| `NOTICE.md` | Credit to Lawnchair and a list of what is changed |
| `../.github/workflows/launcher-apk.yml` | Builds, signs and publishes the APK |

## Build the APK (no computer setup needed)
GitHub → **Actions** → *Stashr Launcher Android Release* → **Run workflow**. It takes about 25 to 45 minutes. The signed APK appears under
**Releases** as `stashr-launcher-v<version>-build-<number>` (package `com.tanush.stashr.launcher`). It uses the same signing key as the other
Stashr apps. **Updates without a cable:** the Stashr server serves the newest build at `/api/mobile-updates/launcher/latest` and
`/download`; in the Stashr app open Settings → Apps → *Stashr Launcher* → *Download the newest build* (Android asks to confirm; the layout is kept). It installs next to a normal Lawnchair; it never replaces it.

## Work on the look at home (Android Studio)
You need Android Studio, JDK 21 and Git.

1. On GitHub, **Fork** `LawnchairLauncher/lawnchair` into your own account (one click). This is where launcher code changes live.
2. `git clone --recurse-submodules https://github.com/<you>/lawnchair` and `git checkout` the commit in `UPSTREAM`.
3. From inside that folder run `python3 <path to this repo>/launcher-app/apply.py .` to get the Stashr name, icon and colour.
4. Open the folder in Android Studio and run the variant `lawnWithQuickstepGithubDebug` (or `./gradlew assembleLawnWithQuickstepGithubDebug`).
5. Colours, icons and defaults: change `overlay/` or `apply.py` here and push; the workflow above builds it. Real code changes (new screens,
   gestures): make them in your fork, then point `UPSTREAM` at your fork's commit. Delete from `apply.py` any edit your fork already contains.

To move to a newer Lawnchair: change `sha` in `UPSTREAM`, run the workflow, and fix whatever `apply.py` reports.

## First run on an OPPO / ColorOS phone
ColorOS stops background apps. After choosing Stashr Launcher as the Home app (Settings → Apps → Default apps → Home app):
1. Settings → Battery → Stashr Launcher → **Unrestricted** (or "Allow background activity").
2. Settings → Apps → Stashr Launcher → **Auto-start** on.
3. In Recent apps, lock Stashr Launcher (swipe down on its card) so it is not cleared.

If anything looks wrong, Settings → Apps → Default apps → Home app → pick the old launcher; nothing is lost.

## Where each Stashr upgrade lives
| Upgrade | Status | Plan |
|---|---|---|
| Stashr name, icon, green accent | **Done** in `apply.py` and `overlay/` | Built by the workflow above |
| Cleaner OPPO setup | **Done as the checklist above** | A first-run reminder screen would need code inside the launcher: fork work |
| Stashr card on the home screen (who is home, who is on the way, weather, TV) | **Done** as the *Stashr Home* widget in the main Stashr app 2.6.0 (`mobile/modules/stashr-widget`) | Long-press the home screen → Widgets → Stashr, or Smart home → Overview → *Add to phone's home screen*. Shows on this launcher and any other |
| Stashr shortcuts (Smart home, TV remote, Camera, Money, Passwords) | **Done** in the main Stashr app 2.6.0 | Long-press the Stashr icon; drag a shortcut onto the home screen or dock to keep it there. The lock screen still comes first |
| Dock search bar → Stashr Search | **Done** in `overlay/.../StashrSearch.kt` + `apply.py` (launcher 1.1.0). Compiles only in the CI build | It is the default provider when the Stashr app is installed; Settings → Search → provider can change it. Needs the Stashr app 2.9.0+ |
| Faster, cleaner defaults | **Done** in `apply.py` | Squircle icons, no icon reload at every start, no network calls for announcements or nightly updates |
| Search, AI answers and voice | **Done in the Stashr app 2.x** (`mobile/src/app/search.js`), not inside Lawnchair | Search icon on the Passwords tab, or long-press the Stashr icon → *Search*. One box for Stashr screens, saved bank-statement lines, house commands ("tv band karo"), Google results and an AI answer (Claude / ChatGPT / Gemini / Groq). Server keys: see `server/config.env.example` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX`). Voice: the keyboard's mic. Putting this *inside the launcher's own search bar* is Kotlin work in the Lawnchair fork (see "Work on the look at home"), then point `UPSTREAM` at it |
| Search bar on the home screen | **Done**: the *Stashr Search* widget (any launcher) | Long-press the home screen → Widgets → Stashr Search. Tap opens Stashr Search; "ASK AI" too |
| Money widget | **Done** | Now also shows "Matches bank ✓" / "₹ off the bank" and "Salary left" |
