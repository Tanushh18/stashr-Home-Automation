package com.tanush.stashr.where.core

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * The pure parts of the health report (no Android types, unit-tested): the last error and how long it is kept, the
 * "3 failures in a row" rule, the location state, the JSON the website reads (see server/utils/home.js cleanHealth) and the
 * lines of the permission checklist. The website's Health tab words the same fixes (client/src/lib/smartHome.js healthItems).
 */
object HealthLogic {
    const val KEEP_MS = 7L * 24 * 3600 * 1000
    const val MAX_TEXT = 300

    data class LastError(val at: Long, val where: String, val text: String)
    data class Item(val id: String, val label: String, val ok: Boolean, val value: String, val fix: String, val red: Boolean)

    fun clip(s: String, max: Int = MAX_TEXT): String = s.replace(Regex("[\\u0000-\\u001f]+"), " ").trim().take(max)

    /** "java.lang.IllegalStateException: boom @ A.run(A.kt:12) < B.go(B.kt:30) < C.x(C.kt:4)", at most 300 characters. */
    fun crashText(t: Throwable): String {
        val frames = t.stackTrace.take(3).joinToString(" < ") { "${it.className.substringAfterLast('.')}.${it.methodName}(${it.fileName ?: "?"}:${it.lineNumber})" }
        return clip("${t.javaClass.name}: ${t.message ?: ""}${if (frames.isNotEmpty()) " @ $frames" else ""}")
    }

    /** The error while it is still worth showing (7 days), else null. */
    fun alive(e: LastError?, now: Long): LastError? = if (e != null && e.text.isNotEmpty() && now - e.at in 0..KEEP_MS) e else null

    /** The newer of two errors; a newer one replaces the older. */
    fun newer(a: LastError?, b: LastError?): LastError? = when { a == null -> b; b == null -> a; b.at >= a.at -> b; else -> a }

    /** Counts failures in a row. [fail] is true each time the count reaches [threshold] (then it starts over); [ok] resets it. */
    class Streak(private val threshold: Int = 3) {
        private var n = 0
        @Synchronized fun fail(): Boolean { n++; if (n >= threshold) { n = 0; return true }; return false }
        @Synchronized fun ok() { n = 0 }
    }

    /** "always" = location is allowed and, from Android 10, also in the background; "whileInUse"; "denied". */
    fun locationState(fine: Boolean, coarse: Boolean, background: Boolean, sdk: Int): String = when {
        !(fine || coarse) -> "denied"
        sdk < 29 || background -> "always"
        else -> "whileInUse"
    }

    /** Flags are null when not known; the website shows "unknown" for those. */
    data class Flags(val location: String? = null, val gpsEnabled: Boolean? = null, val notifications: Boolean? = null, val batteryUnrestricted: Boolean? = null, val remoteLock: Boolean? = null)

    /** The phone's own word on the last remote lock: when, whether it really locked, and why not. */
    data class LastLock(val at: Long, val ok: Boolean, val reason: String)

    fun build(appVersion: String, versionCode: Int, sdk: Int, model: String, err: LastError?, flags: Flags, brand: String = "", lastLock: LastLock? = null): JSONObject {
        val j = JSONObject().put("appVersion", appVersion).put("versionCode", versionCode).put("sdk", sdk).put("model", clip(model, 40))
        if (brand.isNotBlank()) j.put("brand", clip(brand, 30))
        flags.location?.let { j.put("location", it) }
        flags.gpsEnabled?.let { j.put("gpsEnabled", it) }
        flags.notifications?.let { j.put("notifications", it) }
        flags.batteryUnrestricted?.let { j.put("batteryUnrestricted", it) }
        flags.remoteLock?.let { j.put("remoteLock", it) }
        if (lastLock != null && lastLock.at > 0) j.put("lastLock", JSONObject().put("at", lastLock.at).put("ok", lastLock.ok).put("reason", clip(lastLock.reason, 40)))
        j.put("lastError", err?.let { JSONObject().put("at", it.at).put("where", clip(it.where, 40)).put("text", clip(it.text)) } ?: JSONObject.NULL)
        return j
    }

    /** The checklist on the main screen: exactly the items the website's Health tab shows for this app, in the same order. */
    fun items(f: Flags, approximateOnly: Boolean = false): List<Item> = listOf(
        Item("location", "Location: Allow all the time",
            f.location == "always",
            when (f.location) { "always" -> if (approximateOnly) "Allowed all the time (approximate: ETA will be rough)" else "Allowed all the time"; "whileInUse" -> "Only while the app is open"; "denied" -> "Not allowed"; else -> "Unknown" },
            "Settings → Apps → Stashr Location → Permissions → Location → Allow all the time (and Precise).", true),
        Item("gpsEnabled", "Location services on", f.gpsEnabled != false, if (f.gpsEnabled == false) "Switched off" else "On", "Turn on Location in the quick settings.", true),
        Item("notifications", "Messages from Stashr", f.notifications != false, if (f.notifications == false) "Not allowed (you will not see “arrived” messages)" else "Allowed", "Settings → Apps → Stashr Location → Notifications → allow.", false),
        Item("batteryUnrestricted", "Not stopped by the battery saver", f.batteryUnrestricted != false, if (f.batteryUnrestricted == false) "The battery saver may pause the app" else "Allowed to run in the background", "Settings → Apps → Stashr Location → Battery → Unrestricted (Xiaomi/Oppo/Vivo: also allow autostart).", false)
    )
}

/** The Android side: reads the real permissions, keeps the last error across crashes, installs the crash handler. */
object Health {
    private const val FILE = "stashr-health"
    @Volatile private var app: Context? = null
    private val streaks = HashMap<String, HealthLogic.Streak>()
    @Volatile private var lastNote = ""
    @Volatile private var lastNoteAt = 0L

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Call once from Application.onCreate. */
    fun install(application: Application) {
        app = application
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            try { save(application, HealthLogic.LastError(System.currentTimeMillis(), "crash", HealthLogic.crashText(e)), sync = true) } catch (_: Throwable) { }
            previous?.uncaughtException(t, e)
        }
    }

    private fun save(ctx: Context, e: HealthLogic.LastError, sync: Boolean) {
        val ed = prefs(ctx).edit().putLong("errAt", e.at).putString("errWhere", e.where).putString("errText", HealthLogic.clip(e.text))
        if (sync) ed.commit() else ed.apply()
    }

    /** A failure worth knowing about; the newest one is kept for 7 days. Same text within a minute is not written again. */
    fun note(where: String, text: String) {
        val ctx = app ?: return
        val now = System.currentTimeMillis()
        val key = "$where:$text"
        if (key == lastNote && now - lastNoteAt < 60_000) return
        lastNote = key; lastNoteAt = now
        try { save(ctx, HealthLogic.LastError(now, where, text), sync = false) } catch (_: Throwable) { }
    }

    /** [note], but only on the [threshold]-th failure in a row for this [where]; [success] resets the count. */
    fun noteStreak(where: String, text: String, threshold: Int = 3) {
        val s = synchronized(streaks) { streaks.getOrPut(where) { HealthLogic.Streak(threshold) } }
        if (s.fail()) note(where, text)
    }
    fun success(where: String) { synchronized(streaks) { streaks[where] }?.ok() }

    fun lastError(ctx: Context): HealthLogic.LastError? {
        val p = prefs(ctx)
        val at = p.getLong("errAt", 0L)
        if (at == 0L) return null
        val e = HealthLogic.LastError(at, p.getString("errWhere", "") ?: "", p.getString("errText", "") ?: "")
        val alive = HealthLogic.alive(e, System.currentTimeMillis())
        if (alive == null) p.edit().clear().apply()
        return alive
    }

    private fun granted(ctx: Context, perm: String) = ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED

    fun flags(ctx: Context): HealthLogic.Flags {
        val c = ctx.applicationContext
        val fine = granted(c, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = granted(c, Manifest.permission.ACCESS_COARSE_LOCATION)
        val bg = Build.VERSION.SDK_INT < 29 || granted(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        val gps = try {
            val lm = c.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            if (Build.VERSION.SDK_INT >= 28) lm.isLocationEnabled else lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
        } catch (_: Exception) { null }
        return HealthLogic.Flags(
            location = HealthLogic.locationState(fine, coarse, bg, Build.VERSION.SDK_INT),
            gpsEnabled = gps,
            notifications = try { NotificationManagerCompat.from(c).areNotificationsEnabled() } catch (_: Exception) { null },
            batteryUnrestricted = try { (c.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(c.packageName) } catch (_: Exception) { null },
            remoteLock = try { com.tanush.stashr.where.work.RemoteLock.isOn(c) } catch (_: Exception) { null }
        )
    }

    /** The `health` object sent with every location call. */
    fun collect(ctx: Context): JSONObject =
        HealthLogic.build(com.tanush.stashr.where.BuildConfig.VERSION_NAME, com.tanush.stashr.where.BuildConfig.VERSION_CODE, Build.VERSION.SDK_INT, Build.MODEL ?: "", lastError(ctx), flags(ctx), Build.MANUFACTURER ?: "",
            Prefs(ctx.applicationContext).let { HealthLogic.LastLock(it.lastLockAt, it.lastLockOk, it.lastLockReason) })
}

/** Starts the crash handler before anything else runs. */
class StashrWhereApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Health.install(this)
    }
}
