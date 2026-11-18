<#
 Stashr phone optimizer (Windows PowerShell + ADB). Read-only audit first, backup + restore script, then changes ONLY after you approve each category.
 Run:  powershell -ExecutionPolicy Bypass -File optimize.ps1           (audit only)
       powershell -ExecutionPolicy Bypass -File optimize.ps1 -Apply    (audit, then ask category by category)
 Needs: platform-tools (adb) on PATH, USB debugging on, the phone unlocked and "Allow USB debugging" accepted.
 Writes to .\reports\<timestamp>\ : device-report.txt installed-apps.txt application-analysis.csv memory-report.txt call-screen-report.txt
                                    storage-report.txt backup-report.txt restore-commands.ps1 changes-applied.md
 Nothing leaves your computer. Nothing is deleted, no data is cleared, nothing is rooted. Every change has a rollback line in restore-commands.ps1.
#>
param([switch]$Apply)
$ErrorActionPreference = "Stop"
function Adb { param([string]$cmd) (& adb shell $cmd 2>&1 | Out-String).Trim() }
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { throw "adb was not found. Install Android platform-tools and add it to PATH." }
$devs = (& adb devices) | Select-String "\tdevice$"
if (-not $devs) { throw "No authorised phone found. Unlock it, enable USB debugging and accept the prompt on the phone." }
$out = Join-Path (Join-Path $PSScriptRoot "reports") (Get-Date -Format "yyyyMMdd-HHmmss")
New-Item -ItemType Directory -Force -Path $out | Out-Null

# Packages that are never touched, whatever the list says (calling, security, payments, notifications, the system itself).
$PROTECTED = @("com.android.phone","com.android.server.telecom","com.android.providers.telephony","com.android.providers.contacts","com.android.contacts","com.android.dialer","com.google.android.dialer",
 "com.android.systemui","android","com.android.settings","com.google.android.gms","com.google.android.gsf","com.android.vending","com.android.emergency","com.android.mms","com.google.android.apps.messaging",
 "com.whatsapp","com.google.android.apps.nbu.paisa.user","net.one97.paytm","com.phonepe.app","com.android.inputmethod.latin","com.google.android.inputmethod.latin","com.android.bluetooth","com.android.nfc","com.tanush.stashr.com","com.tanush.stashr.launcher","com.tanush.stashr.where")

# ---------- PHASE 1: device ----------
$props = @("ro.product.manufacturer","ro.product.model","ro.build.version.release","ro.build.version.sdk","ro.build.display.id","ro.build.version.security_patch","ro.build.version.opporom","ro.miui.ui.version.name","ro.build.version.oneui","ro.oxygen.version")
$dev = @("== Device ==") + ($props | ForEach-Object { "$_ = " + (Adb "getprop $_") })
$dev += "== RAM =="; $dev += (Adb "cat /proc/meminfo | head -4")
$dev += "== Storage =="; $dev += (Adb "df -h /data")
$dev += "== CPU =="; $dev += (Adb "cat /proc/cpuinfo | grep -i -m3 'hardware\|model name\|processor'")
$dev += "== Battery (temperature is tenths of a degree C) =="; $dev += (Adb "dumpsys battery")
$dev | Set-Content (Join-Path $out "device-report.txt")

# ---------- PHASE 2: installed apps ----------
$all = (Adb "pm list packages -f -u") -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
$enabled = (Adb "pm list packages -e") -split "`n" | ForEach-Object { ($_ -replace "package:","").Trim() }
$system = (Adb "pm list packages -s") -split "`n" | ForEach-Object { ($_ -replace "package:","").Trim() }
$dialer = Adb "cmd role get-role-holders android.app.role.DIALER"
$rows = foreach ($l in $all) {
  if ($l -notmatch "^package:(.+)=([^=]+)$") { continue }
  $pkg = $Matches[2]
  $isSys = $system -contains $pkg
  $prot = ($PROTECTED -contains $pkg) -or ($pkg -like "com.google.android.gms*") -or ($pkg -like "com.android.*" -and $isSys)
  [pscustomobject]@{ Package=$pkg; Type=$(if($isSys){"system"}else{"user"}); Enabled=($enabled -contains $pkg); Protected=$prot; SafeToConsiderDisabling=($isSys -and -not $prot -and $pkg -notlike "com.android.*" -and $pkg -notlike "com.google.*") }
}
$rows | Export-Csv (Join-Path $out "application-analysis.csv") -NoTypeInformation
($rows | ForEach-Object { "$($_.Type)`t$($_.Enabled)`t$($_.Package)" }) | Set-Content (Join-Path $out "installed-apps.txt")

# ---------- PHASE 3: memory / background ----------
@("== meminfo ==", (Adb "dumpsys meminfo | head -60"), "== procstats (last 3h) ==", (Adb "dumpsys procstats --hours 3 | head -60"), "== deviceidle ==", (Adb "dumpsys deviceidle | head -40"),
  "Android uses spare RAM for caching on purpose: do not kill background apps. Look only for apps near the top of the lists above that you do not use.") | Set-Content (Join-Path $out "memory-report.txt")

# ---------- PHASE 4: incoming call screen ----------
$call = @("== Default dialer ==", $dialer,
  "== Battery optimisation whitelist (the dialer should NOT be restricted) ==", (Adb "dumpsys deviceidle whitelist | grep -i 'dialer\|phone\|telecom'"),
  "== Full-screen intent / notification permission for the dialer ==", (Adb "dumpsys package com.google.android.dialer | grep -i 'USE_FULL_SCREEN_INTENT\|POST_NOTIFICATIONS'"),
  "== Do Not Disturb ==", (Adb "settings get global zen_mode"),
  "== Overlay / caller-ID / spam apps that can delay the call screen ==", (Adb "pm list packages | grep -i 'truecaller\|hiya\|callapp\|whoscall\|callerid\|spam'"),
  "== Recent crashes and ANRs (phone / telecom / systemui) ==", (Adb "logcat -d -b crash | grep -i 'phone\|telecom\|systemui' | tail -20"), (Adb "dumpsys activity processes | grep -i 'anr' | head -10"),
  "== Telephony errors ==", (Adb "logcat -d | grep -i 'telecom.*error\|InCallActivity.*exception' | tail -20"),
  "Findings guide: dialer restricted by battery optimisation -> allow it (Settings > Battery > Phone > Unrestricted); full-screen permission off -> turn on; a caller-ID/overlay app -> test with it off; high RAM pressure -> see memory-report.txt.")
$call | Set-Content (Join-Path $out "call-screen-report.txt")

# ---------- PHASE 6: storage ----------
@("== df ==", (Adb "df -h"), "== Largest user apps (APK paths) ==", (Adb "pm list packages -3 -f"), "Review these yourself. Nothing is deleted by this script.") | Set-Content (Join-Path $out "storage-report.txt")

# ---------- PHASE 8: backup + restore ----------
$anim = "window_animation_scale","transition_animation_scale","animator_duration_scale" | ForEach-Object { [pscustomobject]@{ Key=$_; Value=(Adb "settings get global $_") } }
$disabledNow = (Adb "pm list packages -d") -split "`n" | ForEach-Object { ($_ -replace "package:","").Trim() } | Where-Object { $_ }
@("Recorded (settings and package states only; photos, chats and app data are NOT backed up by this script):",
  "Default dialer: $dialer", "Animation scales: " + (($anim | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ", "), "Disabled packages now: " + ($disabledNow -join ", ")) | Set-Content (Join-Path $out "backup-report.txt")
$restore = @("# Restore: run each line you need. Generated $(Get-Date -Format s).")
foreach ($a in $anim) { if ($a.Value -and $a.Value -ne "null") { $restore += "adb shell settings put global $($a.Key) $($a.Value)" } else { $restore += "adb shell settings delete global $($a.Key)" } }
$restore | Set-Content (Join-Path $out "restore-commands.ps1")
$changes = @("# Changes applied", "")

Write-Host "`nAudit finished. Reports are in: $out" -ForegroundColor Green
if (-not $Apply) { Write-Host "Nothing was changed. Run again with -Apply to be asked, category by category."; "No changes were made." | Add-Content (Join-Path $out "changes-applied.md"); exit 0 }

function Ask($text) { (Read-Host "$text [y/N]") -match "^(y|yes)$" }

# ---------- PHASE 9: approval-based ----------
Write-Host "`nCATEGORY A (safe, reversible): animation scale 0.5x (windows, transitions, animators). Risk: none."
if (Ask "Apply A?") {
  foreach ($a in $anim) { & adb shell settings put global $a.Key 0.5 | Out-Null }
  $changes += "- A: animation scales set to 0.5 (rollback in restore-commands.ps1)"
}
Write-Host "`nCATEGORY B (optional): restrict background use of apps YOU choose. Protected packages (dialer, SMS, WhatsApp, banking/UPI, Google services, Stashr) are refused."
if (Ask "Apply B?") {
  $pk = (Read-Host "Package names separated by spaces (see installed-apps.txt, user apps)") -split "\s+" | Where-Object { $_ }
  foreach ($p in $pk) {
    if ($PROTECTED -contains $p) { Write-Host "  skipped $p (protected)" -ForegroundColor Yellow; continue }
    & adb shell cmd appops set $p RUN_ANY_IN_BACKGROUND ignore | Out-Null
    $restore += "adb shell cmd appops set $p RUN_ANY_IN_BACKGROUND allow"; $changes += "- B: background restricted for $p"
  }
}
Write-Host "`nCATEGORY C (manufacturer apps): disable named system apps for this user (reversible with pm enable). You confirm every package; protected ones are refused. Read application-analysis.csv first."
if (Ask "Apply C?") {
  $pk = (Read-Host "Package names (only ones you recognise and do not use)") -split "\s+" | Where-Object { $_ }
  foreach ($p in $pk) {
    if ($PROTECTED -contains $p -or $p -like "com.google.android.gms*") { Write-Host "  skipped $p (protected)" -ForegroundColor Yellow; continue }
    if (-not (Ask "  Disable $p ?")) { continue }
    & adb shell pm disable-user --user 0 $p | Out-Null
    $restore += "adb shell pm enable $p"; $changes += "- C: disabled $p (rollback: adb shell pm enable $p)"
  }
}
Write-Host "`nCATEGORY D (advanced system changes) is intentionally not automated: no root, no bootloader, no security services, no undocumented vendor tweaks."
$restore | Set-Content (Join-Path $out "restore-commands.ps1"); $changes | Set-Content (Join-Path $out "changes-applied.md")

# ---------- PHASE 10: recheck ----------
@("== After ==", (Adb "cat /proc/meminfo | head -3"), (Adb "df -h /data")) | Add-Content (Join-Path $out "changes-applied.md")
Write-Host "Done. Rollback lines: $out\restore-commands.ps1" -ForegroundColor Green
