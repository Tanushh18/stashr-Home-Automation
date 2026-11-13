package com.tanush.stashr.where.work

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import com.tanush.stashr.where.core.Answer
import com.tanush.stashr.where.core.Api
import com.tanush.stashr.where.core.ApiError
import com.tanush.stashr.where.core.Health
import com.tanush.stashr.where.core.Logic
import com.tanush.stashr.where.core.Prefs
import org.json.JSONObject
import java.io.IOException
import java.net.Inet4Address

/** Takes a fix (or uses the one it is given), sends it, remembers the answer, shows notices, schedules the next check. */
object Reporter {
    sealed class Result {
        data class Sent(val text: String) : Result()
        data class Failed(val message: String) : Result()
        object NoFix : Result()
        object Unlinked : Result()
    }

    /**
     * One check. Saves battery and calls by not asking again when nothing has plausibly changed:
     *  - no connection: nothing is asked, the check is tried again in 5 minutes;
     *  - the same Wi-Fi access point as at the last upload (under 6 h ago), or a fix within 40 m of it: the small "still here" call;
     *  - a fix taken (or passively received) under 4 minutes ago is reused;
     *  - battery 15% or less and not charging: network fix only, and the next check is twice as far away.
     * force = the person pressed "Update my location now": a real fix is taken and sent.
     */
    suspend fun run(ctx: Context, given: Fix? = null, live: Boolean = false, force: Boolean = false): Result {
        return runChecked(ctx, given, live, force)
    }

    private suspend fun runChecked(ctx: Context, given: Fix?, live: Boolean, force0: Boolean): Result {
        val app = ctx.applicationContext
        val prefs = Prefs(app)
        if (!prefs.linked) return Result.Unlinked
        val liveMode = live || prefs.live
        // near a place with an automation, at the time it matters: a real fix every time (no "same Wi-Fi" shortcut, no reusing a fix)
        val precise = prefs.precise && !liveMode
        val now = System.currentTimeMillis()
        if (!online(app)) {
            // No internet is no reason to lose where the phone is: GPS works offline. Keep the newest fix and send it, with its real time, once back online.
            if (!liveMode && Locator.hasPermission(app)) {
                Locator.one(app, false, networkOnly = false)?.let { f ->
                    prefs.offLat = f.lat; prefs.offLon = f.lon; prefs.offAcc = f.acc; prefs.offAt = f.at; prefs.offSpeed = f.speed ?: -1f
                }
            }
            prefs.lastError = "No connection; will try again soon"
            Scheduler.next(app, if (liveMode) 10 else 300, liveMode)
            return Result.Failed(prefs.lastError)
        }
        val (pct, charging) = battery(app)
        val bssid = currentBssid(app)
        // Room location on: what this phone hears goes along with the check (Wi-Fi Android already measured; Bluetooth only if allowed).
        // Auto-improve, on the home Wi-Fi: a fresh Wi-Fi scan now and then, so Stashr can also learn from it when it is very sure.
        val roomScan = if (prefs.roomOn && !liveMode) RoomScan.light(app, prefs.roomBle, auto = prefs.roomAuto && bssid.isNotEmpty()) else null
        if (Logic.lowSpellOver(pct, charging)) prefs.lowSent = false
        // 20% or less: one real fix goes out now (the last known place), before the phone stops reporting.
        val finalFix = given == null && Logic.finalFixDue(pct, charging, liveMode, prefs.lowSent)
        val force = force0 || finalFix

        // 0) A fix kept while there was no connection goes first, so the server sees where the phone really was and when.
        if (prefs.offAt > 0 && !prefs.offLat.isNaN() && given == null) {
            try {
                val old = Fix(prefs.offLat, prefs.offLon, prefs.offAcc, prefs.offAt, prefs.offSpeed.takeIf { it >= 0 })
                Api(app).location(body(app, old, pct, charging))
                prefs.offAt = 0L
            } catch (e: ApiError) {
                if (e.status == 401) { disconnect(app, "Stashr disconnected this phone. Link it again with a new code."); return Result.Unlinked }
                prefs.offAt = 0L           // the server refused it: do not keep sending it
            } catch (e: IOException) { /* still cannot reach Stashr: keep it and let the normal path below report the failure */ }
        }

        // 1) Same access point as at the last upload: the phone has not gone far. No fix at all.
        if (given == null && !force && !liveMode && !precise && bssid.isNotEmpty() && bssid == prefs.upBssid &&
            Logic.shouldSendSame(true, now - prefs.upAt, null, false, now - prefs.callAt)) {
            sameCall(app, prefs, pct, charging, liveMode, roomScan)?.let { return it }
        }

        // 2) A fix that is only minutes old is reused instead of asking again.
        var fix = given
        if (fix == null && !force && !liveMode && !precise) {
            val mine = if (prefs.fixAt > 0) Fix(prefs.fixLat, prefs.fixLon, prefs.fixAcc, prefs.fixAt, prefs.fixSpeed.takeIf { it >= 0 }) else null
            val pend = if (prefs.pendingAt > 0) Fix(prefs.pendingLat, prefs.pendingLon, prefs.pendingAcc, prefs.pendingAt, prefs.pendingSpeed.takeIf { it >= 0 }) else null
            val newest = listOfNotNull(mine, pend).maxByOrNull { it.at }
            if (newest != null && now - newest.at < Logic.REUSE_FIX_MS && !newest.lat.isNaN()) fix = newest
        }
        if (fix == null) fix = Locator.one(app, liveMode, networkOnly = Logic.lowBattery(pct, charging, liveMode) && !finalFix, precise = precise)
        if (fix == null) {
            prefs.lastError = if (Locator.hasPermission(app)) "Could not get a location fix" else "Location is not allowed"
            Health.noteStreak("location", "No location fix in 3 checks in a row: ${prefs.lastError}")
            Scheduler.next(app, Logic.batteryDelay(pct, charging, liveMode, prefs.lastDelaySec), prefs.live)
            return Result.NoFix
        }
        Health.success("location")
        prefs.fixLat = fix.lat; prefs.fixLon = fix.lon; prefs.fixAcc = fix.acc; prefs.fixAt = fix.at; prefs.fixSpeed = fix.speed ?: -1f

        // 3) Within 40 m of the last upload, recently: say "still here" instead of sending the position again.
        if (!force && !liveMode && !precise && prefs.upAt > 0 && !prefs.upLat.isNaN()) {
            val moved = Logic.distanceM(prefs.upLat, prefs.upLon, fix.lat, fix.lon)
            if (Logic.shouldSendSame(false, now - prefs.upAt, moved, false, now - prefs.callAt)) sameCall(app, prefs, pct, charging, liveMode, roomScan)?.let { return it }
        }

        return try {
            val answer = Logic.parseAnswer(Api(app).location(body(app, fix, pct, charging, roomScan)))
            prefs.upLat = fix.lat; prefs.upLon = fix.lon; prefs.upAt = System.currentTimeMillis(); prefs.upBssid = bssid
            if (finalFix) prefs.lowSent = true
            prefs.callAt = prefs.upAt; prefs.lastWasSame = false
            apply(app, prefs, answer, pct, charging)
        } catch (e: ApiError) {
            if (e.status == 401) { disconnect(app, "Stashr disconnected this phone. Link it again with a new code."); Result.Unlinked }
            else { prefs.live = false; prefs.lastError = e.message ?: "Server error"; Health.noteStreak("report", "Upload to Stashr failed 3 times in a row: ${prefs.lastError}"); Scheduler.next(app, 300); Result.Failed(prefs.lastError) }
        } catch (e: IOException) {
            prefs.lastError = "No connection to Stashr; will try again soon"
            Health.noteStreak("report", "Upload to Stashr failed 3 times in a row: ${e.message ?: e.javaClass.simpleName}")
            val wasLive = prefs.live
            prefs.live = false
            Scheduler.next(app, if (wasLive) 10 else 300, wasLive)
            Result.Failed(prefs.lastError)
        }
    }

    /** The small "still here" call. Returns null when the server has no earlier location for this phone (then a normal upload follows). */
    private fun sameCall(app: Context, prefs: Prefs, pct: Int, charging: Boolean, live: Boolean, scan: JSONObject? = null): Result? {
        return try {
            val answer = Logic.parseAnswer(Api(app).location(sameBody(app, pct, charging, scan)))
            prefs.callAt = System.currentTimeMillis(); prefs.lastWasSame = true
            apply(app, prefs, answer, pct, charging)
        } catch (e: ApiError) {
            if (e.status == 401) { disconnect(app, "Stashr disconnected this phone. Link it again with a new code."); Result.Unlinked }
            else if (e.status == 400) null
            else { prefs.lastError = e.message ?: "Server error"; Health.noteStreak("report", "Upload to Stashr failed 3 times in a row: ${prefs.lastError}"); Scheduler.next(app, 300); Result.Failed(prefs.lastError) }
        } catch (e: IOException) {
            prefs.lastError = "No connection to Stashr; will try again soon"
            Health.noteStreak("report", "Upload to Stashr failed 3 times in a row: ${e.message ?: e.javaClass.simpleName}")
            Scheduler.next(app, 300)
            Result.Failed(prefs.lastError)
        }
    }

    private fun apply(app: Context, prefs: Prefs, answer: Answer, pct: Int, charging: Boolean): Result {
        Health.success("report")
        prefs.state = answer.state; prefs.distanceKm = answer.distanceKm?.toFloat() ?: -1f; prefs.etaMinutes = answer.etaMinutes ?: -1
        prefs.lastError = ""
        prefs.live = answer.live
        prefs.precise = answer.precise
        answer.roomOn?.let { prefs.roomOn = it }          // the model was started or stopped on the website or the tablet: follow it
        answer.roomAuto?.let { prefs.roomAuto = it }      // auto-improve switched on the website: follow it
        val delay = Logic.batteryDelay(pct, charging, answer.live, Logic.clampDelay(answer.nextCheckSec, answer.live, answer.precise))
        prefs.lastDelaySec = delay
        Notices.show(app, answer.notices)
        Scheduler.next(app, delay, answer.live)
        return Result.Sent(Logic.statusText(answer.state, answer.distanceKm, answer.etaMinutes))
    }

    /** Forgets the link and stops all work. */
    fun disconnect(ctx: Context, message: String) {
        val prefs = Prefs(ctx)
        prefs.unlink()
        prefs.message = message
        Scheduler.stop(ctx)
    }

    fun battery(ctx: Context): Pair<Int, Boolean> {
        val bat = ctx.registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = bat?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = bat?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = bat?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        return (if (level >= 0 && scale > 0) level * 100 / scale else -1) to charging
    }

    private fun extras(ctx: Context, json: JSONObject, pct: Int, charging: Boolean, scan: JSONObject? = null): JSONObject {
        val (wifi, ip) = wifi(ctx)
        json.put("battery", JSONObject().put("pct", if (pct >= 0) pct else JSONObject.NULL).put("charging", charging))
        json.put("wifi", JSONObject().put("connected", wifi).put("ip", ip).put("bssid", if (wifi) currentBssid(ctx) else ""))
        json.put("health", Health.collect(ctx))
        Prefs(ctx).fcmToken.takeIf { it.isNotEmpty() }?.let { json.put("fcm", it) }
        if (scan != null) json.put("scan", scan)
        return json
    }

    private fun body(ctx: Context, fix: Fix, pct: Int, charging: Boolean, scan: JSONObject? = null): JSONObject {
        val json = JSONObject().put("lat", fix.lat).put("lon", fix.lon).put("acc", fix.acc.toDouble()).put("at", fix.at)
        if (fix.speed != null) json.put("speed", fix.speed.toDouble())
        return extras(ctx, json, pct, charging, scan)
    }

    private fun sameBody(ctx: Context, pct: Int, charging: Boolean, scan: JSONObject? = null) = extras(ctx, JSONObject().put("same", true), pct, charging, scan)

    /** True when the phone has any network at all. */
    private fun online(ctx: Context): Boolean = try {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        cm.activeNetwork != null
    } catch (e: Exception) { true }

    /** The Wi-Fi access point the phone is on ("" when it is not on Wi-Fi). Needs location permission, which the app has. */
    @Suppress("DEPRECATION")
    private fun currentBssid(ctx: Context): String = try {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return "")
        if (caps == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) "" else {
            val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
            Logic.usableBssid(wm.connectionInfo?.bssid)
        }
    } catch (e: Exception) { "" }

    /** (connected to Wi-Fi, the phone's own IPv4 on it). No extra permission needed. */
    private fun wifi(ctx: Context): Pair<Boolean, String> {
        return try {
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val net = cm.activeNetwork ?: return false to ""
            val caps = cm.getNetworkCapabilities(net) ?: return false to ""
            if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return false to ""
            val ip = cm.getLinkProperties(net)?.linkAddresses?.map { it.address }?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress ?: ""
            true to ip
        } catch (e: Exception) { false to "" }
    }
}
