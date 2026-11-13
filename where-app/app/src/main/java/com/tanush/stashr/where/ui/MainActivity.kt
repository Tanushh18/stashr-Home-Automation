package com.tanush.stashr.where.ui

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.LinearLayout
import com.tanush.stashr.where.BuildConfig
import com.tanush.stashr.where.core.Api
import com.tanush.stashr.where.core.Logic
import com.tanush.stashr.where.core.Health
import com.tanush.stashr.where.core.HealthLogic
import com.tanush.stashr.where.core.Prefs
import com.tanush.stashr.where.core.Ui
import com.tanush.stashr.where.update.Updater
import com.tanush.stashr.where.work.Locator
import com.tanush.stashr.where.work.Reporter
import com.tanush.stashr.where.work.Scheduler
import com.tanush.stashr.where.work.StatusService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.concurrent.thread

/** After linking: the name, where you are in relation to home, the permissions it needs, and Disconnect. */
class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var ui: Ui
    private lateinit var prefs: Prefs
    private lateinit var body: LinearLayout
    private var busy = false
    private var note = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        if (!prefs.linked) { startActivity(Intent(this, SetupActivity::class.java)); finish(); return }
        ui = Ui(this)
        val (root, col) = ui.page()
        body = col
        setContentView(root)
        Scheduler.start(this)
        scope.launch { Updater.check(this@MainActivity); render() }
        render()
    }

    override fun onResume() {
        super.onResume()
        if (!Prefs(this).linked) { startActivity(Intent(this, SetupActivity::class.java)); finish(); return }
        Scheduler.registerPassive(this)
        StatusService.sync(this)
        render()
        if (Prefs(this).alwaysOn) autoAsk()
        // Opening the app is a good moment to check at once (a pending live-map request is picked up), at most every 20 s.
        if (!busy && System.currentTimeMillis() - Prefs(this).upAt > 20_000 && Prefs(this).lastActivityCheck(20_000)) {
            scope.launch { withContext(Dispatchers.IO) { Reporter.run(this@MainActivity) }; render() }
        }
    }

    override fun onDestroy() { scope.cancel(); main.removeCallbacksAndMessages(null); super.onDestroy() }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        Scheduler.registerPassive(this)
        StatusService.sync(this)
        render()
        if (Prefs(this).alwaysOn) autoAsk()
    }

    /**
     * Always-on is compulsory unless switched off here: whenever the app opens, the next missing Android permission pops up by itself
     * (location, then notifications, then the battery-saver exemption). "Allow all the time" and the autostart screens need the
     * settings app, so they have their own buttons below.
     */
    private var asking = false
    private fun autoAsk() {
        if (asking || Build.VERSION.SDK_INT < 23) return
        val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        when {
            !(fine || coarse) -> { asking = true; requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 1) }
            Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS) -> { asking = true; requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2) }
            !batteryExempt() -> { asking = true; askBatteryExemption() }
        }
        main.postDelayed({ asking = false }, 1500)
    }

    private fun batteryExempt() = (getSystemService(PowerManager::class.java))?.isIgnoringBatteryOptimizations(packageName) != false

    @android.annotation.SuppressLint("BatteryLife")
    private fun askBatteryExemption() = open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))

    /* ───────── screen ───────── */

    private fun render() {
        if (!::body.isInitialized) return
        body.removeAllViews()
        body.addView(ui.eyebrow("Stashr Location"))
        body.addView(ui.h1(prefs.name.ifBlank { "This phone" }))

        val status = ui.card("Where you are", "Shared with your Stashr only")
        val line = when {
            prefs.state.isEmpty() -> "Waiting for the first check"
            else -> Logic.statusText(prefs.state, prefs.distanceKm.takeIf { it >= 0 }?.toDouble(), prefs.etaMinutes.takeIf { it >= 0 })
        }
        status.addView(ui.text(line, 18f, ui.c.text, bold = true))
        status.addView(ui.dim("Last shared: " + Logic.ago(maxOf(prefs.upAt, prefs.callAt)) + if (prefs.fixAcc > 0) " · accuracy about ${prefs.fixAcc.toInt()} m" else ""))
        if (prefs.lastWasSame && prefs.callAt > 0) status.addView(ui.dim("Last check: still at the same place (no new location needed)"))
        if (prefs.live && System.currentTimeMillis() - prefs.upAt < 2 * 60_000) status.addView(ui.dim("Live view is on (your family is looking at the map)"))
        if (prefs.lastError.isNotEmpty()) status.addView(ui.text(prefs.lastError, 13f, ui.c.warn))
        if (note.isNotEmpty()) status.addView(ui.dim(note))
        status.addView(ui.primary(if (busy) "Updating…" else "Update my location now") { updateNow() }.apply { isEnabled = !busy })
        body.addView(status)

        if (prefs.updateVersion.isNotEmpty()) {
            val up = ui.card("Update available", "Stashr Location ${prefs.updateVersion} (you have ${BuildConfig.VERSION_NAME})")
            up.addView(ui.primary("Install update") { installUpdate() })
            body.addView(up)
        }

        body.addView(permissionsCard())

        val room = ui.card("Room Lab", "Kamre ki pehchan: har kamre mein khade hoke phone ko sikhao, phir Stashr bata sakta hai ki aap kaun se kamre mein ho.")
        room.addView(ui.primary("Room Lab kholo") { startActivity(Intent(this, RoomLabActivity::class.java)) })
        body.addView(room)

        val always = ui.card("Always work in background", if (prefs.alwaysOn) "ON: Stashr Location keeps running all the time, even when the app is closed or the phone restarts. A quiet “connected to your home” notification stays in the shade; Android needs it to keep the app alive." else "OFF: this phone only shares its location when Android lets the app run. Your family may see old locations.")
        always.addView(ui.dim("This setting is only for this phone."))
        always.addView(if (prefs.alwaysOn) ui.quiet("Turn off on this phone") { confirmAlwaysOff() } else ui.primary("Turn on (recommended)") { setAlways(true) })
        if (prefs.alwaysOn) {
            always.addView(ui.primary("Fix all permissions now") { fixAll() })
            always.addView(ui.quiet("Autostart / background settings (Xiaomi, Oppo, Vivo, Samsung…)") { openAutostart() })
        }
        body.addView(always)

        val help = ui.card("If updates stop", "Some phones (Xiaomi, Oppo, Vivo, Samsung, OnePlus) close background apps to save battery. If your location stops updating, let Stashr Location run in the background.")
        help.addView(ui.quiet("Battery optimisation list") { open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) })
        help.addView(ui.quiet("This app’s settings") { open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) })
        body.addView(help)

        val privacy = ui.card("Private by design")
        privacy.addView(ui.dim("Only your location (latitude, longitude, accuracy, speed), battery level and Wi-Fi connected yes/no are sent, only to your Stashr server. No passwords, contacts or messages. The only notification it keeps is a quiet “connected to your home” one, which you can switch off here. While a family TV shows the live map, your location is sent every few seconds until it is closed. The owner of your Stashr can turn on a location history (places and trips) on their own website; nothing from it is shown on this phone. If you turn on Room location (Room Lab), the Wi-Fi networks and Bluetooth devices this phone hears are sent too, as unreadable codes with their signal strength, so Stashr can tell which room you are in."))
        body.addView(privacy)

        body.addView(ui.danger("Disconnect") { confirmDisconnect() })
        body.addView(ui.dim("Version ${BuildConfig.VERSION_NAME}"))
    }

    /** The same four items the website's Health tab checks for this app, in the same order (see core/Health.kt). */
    private fun permissionsCard(): View {
        val card = ui.card("Permissions", "What this app needs to keep working in the background")
        val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        val flags = Health.flags(this)
        for (item in HealthLogic.items(flags, approximateOnly = coarse && !fine)) {
            card.addView(row(item.label, item.value, item.ok))
            if (item.ok) continue
            when (item.id) {
                "location" -> when {
                    !(fine || coarse) -> card.addView(ui.primary("Allow location") { requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 1) })
                    else -> {
                        card.addView(ui.dim("To tell your family you are on the way, Android must let this app read your location when it is closed: choose “Allow all the time”."))
                        card.addView(ui.primary("Allow all the time") { askBackground() })
                    }
                }
                "gpsEnabled" -> card.addView(ui.quiet("Open location settings") { open(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) })
                "notifications" -> card.addView(ui.quiet("Allow messages") {
                    if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)
                    else open(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                })
                "batteryUnrestricted" -> {
                    card.addView(ui.primary("Allow to run in background") { askBatteryExemption() })
                    card.addView(ui.quiet("Battery optimisation list") { open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) })
                }
            }
        }
        return card
    }

    private fun row(label: String, value: String, ok: Boolean): View = ui.row(8).apply {
        addView(ui.dot(if (ok) ui.c.ok else ui.c.warn))
        addView(ui.fill(ui.column(2).apply { addView(ui.body(label)); addView(ui.dim(value)) }))
    }

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun askBackground() {
        if (Build.VERSION.SDK_INT == 29) { requestPermissions(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), 3); return }
        AlertDialog.Builder(this).setTitle("Allow all the time")
            .setMessage("Android will open this app’s settings. Choose Permissions → Location → “Allow all the time”.")
            .setPositiveButton("Open settings") { _, _ -> open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
            .setNegativeButton("Not now", null).show()
    }

    private fun open(i: Intent) { try { startActivity(i) } catch (e: Exception) { startActivity(Intent(Settings.ACTION_SETTINGS)) } }

    /* ───────── actions ───────── */

    private fun updateNow() {
        if (busy) return
        busy = true; note = ""; render()
        scope.launch {
            val r = withContext(Dispatchers.IO) { Reporter.run(this@MainActivity, force = true) }
            busy = false
            note = when (r) {
                is Reporter.Result.Sent -> "Shared just now."
                is Reporter.Result.NoFix -> "Could not get a location. Turn on location and try outside."
                is Reporter.Result.Failed -> ""
                Reporter.Result.Unlinked -> ""
            }
            if (!Prefs(this@MainActivity).linked) { startActivity(Intent(this@MainActivity, SetupActivity::class.java)); finish(); return@launch }
            render()
        }
    }

    private fun setAlways(on: Boolean) {
        prefs.alwaysOn = on
        StatusService.sync(this)
        if (on) { Scheduler.start(this); autoAsk() }
        render()
    }

    private fun confirmAlwaysOff() {
        AlertDialog.Builder(this).setTitle("Turn off always-on?")
            .setMessage("This phone will stop running in the background all the time. Android may pause Stashr Location, and your family can see old or missing locations. You can turn it back on here any time.")
            .setPositiveButton("Turn off") { _, _ -> setAlways(false) }
            .setNegativeButton("Keep on", null).show()
    }

    /** Goes through every missing permission in order: runtime pop-ups first, then the settings screens. */
    private fun fixAll() {
        val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        val bg = Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        when {
            !(fine || coarse) -> requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 1)
            Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS) -> requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)
            !bg -> askBackground()
            !batteryExempt() -> askBatteryExemption()
            else -> { note = "All permissions are on."; render() }
        }
    }

    private fun openAutostart() {
        val tries = listOf(
            "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
            "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
            "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
            "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
            "com.samsung.android.lool" to "com.samsung.android.sm.battery.ui.BatteryActivity",
            "com.oneplus.security" to "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity",
        )
        for ((pkg, cls) in tries) {
            try { startActivity(Intent().setClassName(pkg, cls)); return } catch (_: Exception) { }
        }
        open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
    }

    private fun installUpdate() {
        scope.launch { note = Updater.install(this@MainActivity); render() }
    }

    private fun confirmDisconnect() {
        AlertDialog.Builder(this).setTitle("Disconnect?")
            .setMessage("Stashr will stop seeing where you are and this phone leaves the family list. You can link it again with a new code.")
            .setPositiveButton("Disconnect") { _, _ ->
                thread {
                    try { Api(this).unlink() } catch (e: Exception) { /* the link is removed on this phone either way */ }
                    Reporter.disconnect(this, "Disconnected. Link again with a new code any time.")
                    main.post { startActivity(Intent(this, SetupActivity::class.java)); finish() }
                }
            }
            .setNegativeButton("Cancel", null).show()
    }
}
