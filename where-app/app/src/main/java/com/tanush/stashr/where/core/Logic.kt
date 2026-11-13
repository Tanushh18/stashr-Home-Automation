package com.tanush.stashr.where.core

import org.json.JSONObject
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** What the server answered to a location upload. */
data class Answer(
    val state: String,          // home | away | coming | unset
    val distanceKm: Double?,
    val etaMinutes: Int?,
    val nextCheckSec: Int?,
    val notices: List<Pair<String, String>>,   // (id, text)
    val homeSet: Boolean,
    val live: Boolean = false,  // a family TV is showing the live map: look every few seconds
    val precise: Boolean = false, // near one of the family's places during an arrive/leave time: a real, fresh fix every check, no "same Wi-Fi" shortcut
    val roomOn: Boolean? = null,  // the server's Start / Stop of the room model for this phone (null: an older server that does not say)
    val roomAuto: Boolean? = null // auto-improve for this phone, switched on the website (null: an older server that does not say)
)

/** Pure helpers (no Android), so they can be unit-tested. */
object Logic {
    const val DEFAULT_DELAY_SEC = 900
    const val MIN_DELAY_SEC = 60
    const val MAX_DELAY_SEC = 1800

    /** The server says when to look again; keep it between 1 and 30 minutes, 15 when it says nothing. */
    fun clampDelay(sec: Int?): Int = if (sec == null || sec <= 0) DEFAULT_DELAY_SEC else sec.coerceIn(MIN_DELAY_SEC, MAX_DELAY_SEC)

    const val LIVE_MIN_DELAY_SEC = 5
    const val LIVE_MAX_DELAY_SEC = 30
    const val LIVE_DEFAULT_DELAY_SEC = 8

    /** In live mode the server asks for a few seconds: keep it between 5 and 30 s (8 when it says nothing). Otherwise as above. */
    /** Near a place with an arrive/leave time the server may ask for a check every 30 seconds (otherwise the minimum is 60). */
    const val PRECISE_MIN_DELAY_SEC = 30

    fun clampDelay(sec: Int?, live: Boolean, precise: Boolean = false): Int =
        if (live) { if (sec == null || sec <= 0) LIVE_DEFAULT_DELAY_SEC else sec.coerceIn(LIVE_MIN_DELAY_SEC, LIVE_MAX_DELAY_SEC) }
        else if (precise && sec != null && sec > 0) sec.coerceIn(PRECISE_MIN_DELAY_SEC, MAX_DELAY_SEC)
        else clampDelay(sec)

    fun parseAnswer(json: JSONObject): Answer {
        val notices = ArrayList<Pair<String, String>>()
        val arr = json.optJSONArray("notices")
        if (arr != null) for (i in 0 until arr.length()) {
            val n = arr.optJSONObject(i) ?: continue
            val text = n.optString("text").trim()
            if (text.isNotEmpty()) notices.add(n.optString("id", text).ifEmpty { text } to text)
        }
        return Answer(
            state = json.optString("state", "unset"),
            distanceKm = if (json.has("distanceKm") && !json.isNull("distanceKm")) json.optDouble("distanceKm") else null,
            etaMinutes = if (json.has("etaMinutes") && !json.isNull("etaMinutes")) json.optInt("etaMinutes") else null,
            nextCheckSec = if (json.has("nextCheckSec") && !json.isNull("nextCheckSec")) json.optInt("nextCheckSec") else null,
            notices = notices,
            homeSet = json.optJSONObject("home")?.optBoolean("set", true) ?: (json.optString("state") != "unset"),
            live = json.optBoolean("live", false),
            precise = json.optBoolean("precise", false),
            roomOn = if (json.has("roomOn") && !json.isNull("roomOn")) json.optBoolean("roomOn") else null,
            roomAuto = if (json.has("roomAuto") && !json.isNull("roomAuto")) json.optBoolean("roomAuto") else null
        )
    }

    fun km(v: Double): String = if (v >= 100) "%.0f".format(v) else "%.1f".format(v)

    fun minutes(m: Int): String = if (m >= 60) "${m / 60} h ${m % 60} min" else "$m min"

    /** The line shown on the main screen. */
    fun statusText(state: String, distanceKm: Double?, etaMinutes: Int?): String = when (state) {
        "unset" -> "Home location not set on Stashr yet"
        "home" -> "At home"
        "coming" -> if (distanceKm != null && etaMinutes != null && etaMinutes > 0) "${km(distanceKm)} km from home · about ${minutes(etaMinutes)} away"
                    else if (distanceKm != null) "${km(distanceKm)} km from home · on the way" else "On the way home"
        "away" -> if (distanceKm != null) "${km(distanceKm)} km from home" else "Away from home"
        else -> "Waiting for the first check"
    }

    /** Metres between two points. */
    fun distanceM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1); val dLon = Math.toRadians(lon2 - lon1)
        val h = sin(dLat / 2) * sin(dLat / 2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * asin(min(1.0, sqrt(h)))
    }

    /** A passive fix is worth an upload only after moving more than 300 m and 2 minutes since the last upload. */
    fun passiveWorthUploading(movedM: Double?, sinceLastUploadMs: Long): Boolean =
        sinceLastUploadMs > 2 * 60_000 && (movedM == null || movedM > 300)

    const val SAME_MAX_AGE_MS = 6 * 3600_000L          // the same access point counts as "has not moved" for 6 hours
    const val SAME_NEAR_M = 40.0                      // a new fix this close to the last uploaded one is the same place
    const val SAME_NEAR_MAX_AGE_MS = 20 * 60_000L     // ... if the last upload is not older than this
    const val CALL_MAX_AGE_MS = 25 * 60_000L          // at least one real fix every 25 minutes while only "near" decides
    const val REUSE_FIX_MS = 4 * 60_000L              // a fix younger than this is reused instead of asking again

    /**
     * True when the phone can say "I am still where I was" (the small `same` call) instead of taking and sending a new location.
     * Never in live mode. Same Wi-Fi access point as at the last upload (and that upload under 6 h old) is enough; otherwise the new
     * fix must be within 40 m of the last upload, which must be under 20 minutes old, and a full fix must have gone out in the last 25 minutes.
     */
    fun shouldSendSame(sameBssid: Boolean, lastUploadAgeMs: Long, distanceM: Double?, live: Boolean, lastCallAgeMs: Long): Boolean {
        if (live || lastUploadAgeMs <= 0) return false
        if (sameBssid && lastUploadAgeMs < SAME_MAX_AGE_MS) return true
        return distanceM != null && distanceM <= SAME_NEAR_M && lastUploadAgeMs < SAME_NEAR_MAX_AGE_MS && lastCallAgeMs < CALL_MAX_AGE_MS
    }

    /** Battery 15% or less and not charging (not live): look half as often, at most every 30 minutes. */
    /** 20% or less and not charging: the phone is about to stop reporting, so it saves what it has left. */
    fun lowBattery(pct: Int, charging: Boolean, live: Boolean) = !live && !charging && pct in 0..20

    /** The last location before the battery dies goes out at once, one time per low-battery spell (it starts again after charging or 30%). */
    fun finalFixDue(pct: Int, charging: Boolean, live: Boolean, alreadySent: Boolean) = lowBattery(pct, charging, live) && !alreadySent
    fun lowSpellOver(pct: Int, charging: Boolean) = charging || pct >= 30

    /**
     * The server asked this phone for its location by push. A normal ask is dropped when the phone talked to the server in the last
     * minute (the ask crossed a check that was already on its way); "Refresh location" (force) only needs 15 seconds.
     */
    fun pushWorthIt(sinceLastCallMs: Long, force: Boolean): Boolean = sinceLastCallMs >= (if (force) 15_000L else 60_000L)

    const val WIFI_DEBOUNCE_MS = 90_000L
    /** A Wi-Fi change (left home, came back) asks for a real fix now, unless the battery is low or one just went out. */
    fun wifiTriggerWorthIt(pct: Int, charging: Boolean, sinceUploadMs: Long) = !lowBattery(pct, charging, false) && sinceUploadMs >= WIFI_DEBOUNCE_MS
    fun batteryDelay(pct: Int, charging: Boolean, live: Boolean, delaySec: Int): Int =
        if (lowBattery(pct, charging, live)) (delaySec * 2).coerceAtMost(MAX_DELAY_SEC) else delaySec

    /** A Wi-Fi BSSID that identifies an access point (not empty, not the placeholder Android returns without permission). */
    fun usableBssid(b: String?): String =
        b?.trim()?.lowercase()?.takeIf { it.isNotEmpty() && it != "02:00:00:00:00:00" && it != "00:00:00:00:00:00" && it != "<unknown ssid>" } ?: ""

    fun cleanCode(raw: String): String = raw.uppercase().filter { it.isLetterOrDigit() }.take(8)

    fun ago(ms: Long, now: Long = System.currentTimeMillis()): String {
        val s = (now - ms) / 1000
        return when {
            ms <= 0 -> "never"
            s < 60 -> "just now"
            s < 3600 -> "${s / 60} min ago"
            s < 86400 -> "${s / 3600} h ago"
            else -> "${s / 86400} d ago"
        }
    }
}
