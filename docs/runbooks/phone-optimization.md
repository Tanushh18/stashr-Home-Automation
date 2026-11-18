# Android Phone Optimization Runbook

How to make the family Android phones fast over ADB, without root, without losing data, and without breaking calls, banking or messaging. It covers what was done on 2026-11-18 to a **Redmi 9 Prime (MIUI 13, Android 12)** and an **OPPO CPH2579 (ColorOS 15, Android 15)**, what worked, what the OS blocked, and the recurring maintenance that keeps them fast.

Re-run this runbook every 1–2 months, and update the "Results log" at the bottom each time.

---

## 0. Ground rules (never break these)

- **Never touch:** Phone or Dialer, Telecom, SIM and IMS (VoLTE) services, System UI, Contacts, SMS, Google Play Services, HeyTap or Xiaomi push services, the security center, Find My Device, fingerprint or face unlock, payment and biometric helpers (Soter, IFAA, Mi Pay, Oplus Pay).
- **Never restrict or uninstall:** banking, UPI or investment apps (Paytm, BHIM, bank apps, Groww, FamPay and similar), WhatsApp, Telegram, Facebook, Instagram and other social apps, authenticators, work apps, smart-home apps, Android Auto (used in the car), or music apps that play in the background.
- **Never delete:** photos, videos, documents, downloaded songs, WhatsApp or YouTube Music offline data, or the MIUI local backups in `/sdcard/MIUI/backup`.
- **Never** root the phone, unlock the bootloader, downgrade the OS, or factory reset without a full backup.
- **Prefer reversible actions.** Use `pm disable-user` rather than uninstalling system apps, and use background restrictions rather than disabling apps. Record every change in a rollback script.
- **Only uninstall user apps after confirming they're unused.** Check `dumpsys usagestats` first, and check how far back the history goes (see 2.2).

---

## 1. Connect

```bash
ADB=~/Library/Android/sdk/platform-tools/adb

# Wireless debugging (Android 11+): Developer options -> Wireless debugging -> Pair with code
$ADB pair <ip>:<pairing-port> <6-digit-code>
$ADB mdns services             # shows the *connect* port, which differs from the pairing port
$ADB connect <ip>:<connect-port>

# USB: set the USB mode to "File transfer" and accept the "Allow USB debugging" prompt
$ADB devices -l
export ANDROID_SERIAL=<serial>  # required when one phone shows up twice (USB + mDNS)
```

**OEM switches that unlock more of this runbook:**

| OEM | Setting (Developer options) | What it unlocks |
|---|---|---|
| Xiaomi MIUI | **Install via USB** | `adb install` (otherwise `INSTALL_FAILED_USER_RESTRICTED`) |
| Xiaomi MIUI | **USB debugging (Security settings)** | `settings put` (animations), `input` taps |
| OPPO ColorOS | **Disable permission monitoring** | `cmd appops set` (background restriction) |

The MIUI switches only stay on when a **Mi account is signed in** and **mobile data is on** with a SIM inserted.

---

## 2. Audit (read-only)

### 2.1 Device report
```bash
for p in ro.product.manufacturer ro.product.model ro.build.version.release ro.build.version.sdk \
         ro.build.version.security_patch ro.miui.ui.version.name ro.build.version.oplusrom; do
  echo "$p=$($ADB shell getprop $p)"; done
$ADB shell free -m; $ADB shell df -h /data; $ADB shell dumpsys battery
$ADB shell dumpsys thermalservice | grep -E "Thermal Status|mValue"
```

### 2.2 App usage (find really unused apps)
```bash
$ADB shell dumpsys usagestats > usagestats.txt
grep -oE 'time="20[0-9-]+ ' usagestats.txt | sort | head -1   # how far back the history goes
$ADB shell pm list packages -3                                 # user apps
```
Parse `package=... lastTimeUsed="..."` and take the latest date per package. If the history is only a few days long (for example after restoring from another phone), **"never used" means no data**. In that case, restrict apps in the background instead of uninstalling them.

### 2.3 RAM, CPU and background work
```bash
$ADB shell dumpsys meminfo | sed -n '/Total PSS by process/,/Total PSS by OOM/p' | head -25
$ADB shell dumpsys cpuinfo | head -15
$ADB shell dumpsys batterystats --charged | grep -A15 "All partial wake locks"
$ADB shell dumpsys activity services | grep -oE "ServiceRecord\{[^ ]+ u0 [^/]+" | awk '{print $3}' | sort | uniq -c | sort -rn
$ADB shell settings get secure enabled_notification_listeners
$ADB shell settings get secure enabled_accessibility_services
$ADB shell dumpsys dropbox | grep -E "app_crash|app_anr"
```

### 2.4 Storage
```bash
$ADB shell 'du -sk /sdcard/* /sdcard/Android/data/* /sdcard/Android/media/*' | sort -rn | head -20
# Python one-liner over `dumpsys diskstats` -> zip(Package Names, App Sizes, App Data Sizes, Cache Sizes)
```

---

## 3. Optimize (in this order)

### 3.1 Back up state first
```bash
mkdir -p backup
$ADB shell pm list packages -d > backup/disabled.txt
$ADB shell pm list packages -e > backup/enabled.txt
for ns in global secure system; do $ADB shell settings list $ns > backup/settings-$ns.txt; done
$ADB shell dumpsys deviceidle whitelist > backup/deviceidle.txt
for r in DIALER SMS HOME; do echo "$r: $($ADB shell cmd role get-role-holders android.app.role.$r)"; done > backup/roles.txt
```
This records settings only. It does **not** back up personal data, so photos, WhatsApp and contacts need Google or app backups.

### 3.2 Incoming call screen (top priority)
Calls arrive late when the dialer is in a low standby bucket, killed by the OEM, cold-starting, or competing with caller-ID apps.
```bash
DIALER=$($ADB shell cmd role get-role-holders android.app.role.DIALER)
for p in $DIALER com.android.incallui com.android.contacts com.android.phone com.android.server.telecom; do
  $ADB shell am set-standby-bucket $p active; done
$ADB shell dumpsys deviceidle whitelist +$DIALER
$ADB shell cmd package compile -m speed -f $DIALER        # works on ColorOS 15; MIUI 13 ignores it
# Verify: incoming-call channel importance=4, USE_FULL_SCREEN_INTENT granted, zen_mode=0
$ADB shell dumpsys notification | grep -A1 "phone_incoming_call"
$ADB shell settings get global zen_mode
```
**Found on the Redmi:** the MIUI dialer was in standby bucket **40 (rare)**, so the call screen took a long time to wake up. Moving it to `active` fixed this.
**Watch for:** Truecaller, or any app with overlay permission that listens to phone state, wakes up on every call and competes for CPU. If it isn't used, restrict or remove it.
**On the phone:** lock the Phone app in recents (on ColorOS, long-press the card and tap the lock icon) so the OEM's memory manager never kills it.

### 3.3 Animations (biggest change to how fast it *feels*)
```bash
for k in window_animation_scale transition_animation_scale animator_duration_scale; do
  $ADB shell settings put global $k 0.5; done
```
If MIUI blocks this, set it by hand: Developer options → Drawing → all three to **.5x**.

### 3.4 Storage cleanup (safe)
```bash
$ADB shell pm trim-caches 999G                         # all app caches; freed 19 GB on the Redmi
$ADB shell rm -rf /sdcard/DCIM/.thumbnails /sdcard/Android/data/com.miui.gallery/files/gallery_disk_cache
```
Also delete:
- Installer `.apk` files in `Download/` for apps that are already installed.
- Exact duplicates in `Download/`, checked with `md5sum`.
- `/sdcard/Android/{data,media,obb}/<pkg>` folders for packages that are no longer installed.
- MIUI `debug_log`, `BugReportCache` and old `MIUI/Video` thumbnails.

Then trim caches again once the apps settle.

### 3.5 Turn off OEM ads and telemetry (`pm disable-user --user 0 <pkg>`)

**MIUI 13 (done):** `com.miui.msa.global`, `com.miui.analytics`, `com.miui.daemon`, `com.miui.hybrid`, `com.miui.hybrid.accessory`, `com.xiaomi.mipicks`, `com.miui.player`, `com.miui.bugreport`, `com.xiaomi.midrop`, `com.miui.miservice`, `com.indus.appstore`, `com.mi.globalminusscreen`, `com.xiaomi.mi_connect_service`, `com.miui.touchassistant`, `com.xiaomi.discover`, `com.xiaomi.barrage`, `com.miui.mishare.connectivity`, `com.facebook.appmanager`, `com.android.fmradio`, `com.miui.fm`, `com.facemoji.lite.xiaomi` (when Gboard is the keyboard), `com.google.android.videos`, `com.google.android.apps.subscriptions.red`.

**ColorOS 15 (done):** `com.oplus.postmanservice`, `com.oplus.uxdesign`, `com.coloros.healthcheck`. `com.nearme.instant.platform` is protected and can't be turned off.

**Do NOT disable**, even though some GitHub lists call them safe:
- `com.heytap.mcs` (push; breaks notifications)
- `com.oplus.sau` (security updates)
- `com.heytap.cloud` and `usercenter` (backup, Find My Device)
- `com.oplus.melody` (Oppo earbuds)
- `com.oplus.athena` and `com.oplus.cosa` (memory and performance management)
- `com.xiaomi.joyose` (heat management)
- `com.miui.securitycenter`
- `com.xiaomi.xmsf` (push)
- `com.miui.yellowpage` (caller info in the dialer)
- `com.android.stk` (SIM toolkit)
- `com.mediatek.ims` (VoLTE)
- `com.milink.service` (casting)
- `com.google.android.projection.gearhead` (Android Auto)

### 3.6 Background limits (keeps RAM free all the time)
```bash
# Preferred (MIUI; ColorOS needs "Disable permission monitoring" on):
$ADB shell cmd appops set <pkg> RUN_ANY_IN_BACKGROUND ignore
# Works everywhere without extra permission (ColorOS fallback):
$ADB shell am set-standby-bucket <pkg> restricted     # bucket 45
```
Apply this to shopping, ride-hailing, travel, OTT, games and one-off utility apps. Push notifications still arrive.

**Exceptions:** keep heavily used shopping and delivery apps unrestricted so order and delivery notifications are timely. On the Redmi, Flipkart and Meesho were unrestricted again after usage showed hundreds of opens.

**Do not use "Background process limit"** (Developer options) as a RAM cap. It forces every app to reload from scratch and delays WhatsApp and bank notifications, which makes the phone feel *slower*. Background limits per app plus Android's cached-app freezer are the right way to keep RAM free.

### 3.7 Precompile
```bash
$ADB shell cmd package bg-dexopt-job        # all apps, based on usage profiles (10–20 min, phone gets warm)
$ADB shell cmd package compile -m speed -f <pkg>    # full compile of key apps
$ADB shell dumpsys package dexopt | grep -A3 "\[<pkg>\]"   # verify status=speed
```
MIUI 13 accepts `compile -m speed` but keeps `speed-profile`, and ColorOS 15 applies it. Don't run `bg-dexopt-job` in parallel with manual compiles, because it overwrites them.

### 3.8 Launcher
Install Stashr Launcher (release `stashr-launcher-v*` on GitHub) and make it the home screen:
```bash
$ADB install -r stashr-launcher.apk
$ADB shell cmd role add-role-holder android.app.role.HOME com.tanush.stashr.launcher
$ADB shell appwidget grantbind --package com.tanush.stashr.launcher --user 0
```
The system wallpaper is kept automatically, because the launcher draws over the system wallpaper.

### 3.9 Stashr Location reliability
The app wakes up on a server push (FCM), reads the location and replies; there's no always-on service. Requirements:
- Location set to "Allow all the time"
- Battery-optimization exempt
- Standby bucket `active`
- **MIUI Autostart allowed**: `cmd appops set com.tanush.stashr.where 10008 allow`. MIUI resets this, so check it every time.
- The server must send **high-priority** FCM, or Doze delays it.

### 3.10 Clear RAM once at the end
```bash
$ADB shell am kill-all      # cached background processes only; never loop this
```

---

## 4. Verify

Recheck `free -m`, `df -h /data`, the dialer bucket, the HOME role, Android Auto being enabled, and the animation scales. Then compare against the backup and update the results log.

## 5. Monthly maintenance (keep improving)

1. `pm trim-caches 999G` and remove leftover installer APKs.
2. Re-run the usage audit (2.2) and restrict or uninstall newly unused apps, after confirming with the owner.
3. Check the dialer bucket and MIUI Autostart for Stashr Location, since OEMs reset these after updates.
4. Run `dumpsys meminfo` to look for new RAM hogs; Instagram and Facebook often use 300 MB or more, and their Lite versions save a lot.
5. Check `dropbox` for new crash loops.
6. Restart the phone weekly.
7. After OS updates, run `bg-dexopt-job` and re-apply 3.2.
8. Look for new ideas in community lists (below), but check each package against the "Do NOT disable" list first.

## 6. References
- [Ankodee/cleanyourphone](https://github.com/Ankodee/cleanyourphone): ColorOS and Oppo debloat lists (check them, as not everything there is safe)
- [fadeltd/xiaomi-debloater](https://github.com/fadeltd/xiaomi-debloater): MIUI/HyperOS packages with safety ratings
- [MIUI 13/14 bloatware list](https://gist.github.com/mcxiaoke/ade05718f590bcd574b807c4706a00b1)
- [ColorOS 15 debloat (XDA)](https://xdaforums.com/t/coloros-15-debloat.4709960/)
- [ADB performance commands (Technastic)](https://technastic.com/adb-commands-improve-performance-android/). Many are Samsung-only, and "fixed performance mode" is unsafe on budget phones.

---

## Results log

| Date | Device | Before | After | Notes |
|---|---|---|---|---|
| 2026-11-18 | Redmi 9 Prime, MIUI 13 | 1.7 GB free (97%), swap 1.8 GB, dialer bucket 40 | 22 GB free (54%), swap ~1.1 GB, dialer bucket 5 | 7 unused apps removed, 23 OEM packages disabled, Stashr Launcher set as home, gallery cache 302 MB cleared. Animations had to be set by hand. |
| 2026-11-18 | OPPO CPH2579, ColorOS 15 | 158 MB RAM free, animations 1.0x | 533 MB RAM free, animations 0.5x, dialer and telecom fully compiled | 51 apps put in the restricted bucket, 3 telemetry apps disabled. Only 1 day of usage history, so nothing uninstalled. |
