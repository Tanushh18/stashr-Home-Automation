package com.tanush.stashr.tv.core

import android.content.Context

/** What the app remembers: the two servers, the device token, the TV's name and where each movie was left. */
class Prefs(ctx: Context) {
    private val p = ctx.applicationContext.getSharedPreferences("stashr-tv", Context.MODE_PRIVATE)

    var server: String
        get() = p.getString("server", null) ?: com.tanush.stashr.tv.BuildConfig.DEFAULT_SERVER
        set(v) = p.edit().putString("server", v.trim().trimEnd('/')).apply()

    /** The backup server. Both servers share one database, so the same device token works on either. */
    var server2: String
        get() = p.getString("server2", null) ?: com.tanush.stashr.tv.BuildConfig.DEFAULT_SERVER2
        set(v) = p.edit().putString("server2", v.trim().trimEnd('/')).apply()

    private var good: String
        get() = p.getString("serverGood", "") ?: ""
        set(v) = p.edit().putString("serverGood", v).apply()

    /** Both servers, the one that worked last first. */
    val servers: List<String>
        get() {
            // The built-in addresses always come after the saved ones: an address saved by an older version of the app (say, only the old
            // server) must never hide the current servers. The one that answered last is tried first.
            val all = (listOf(server, server2) + com.tanush.stashr.tv.BuildConfig.DEFAULT_SERVERS.split(",")).map { it.trim() }.filter { it.startsWith("https://") }.distinct()
            return if (good in all) listOf(good) + all.filter { it != good } else all
        }

    fun serverWorked(url: String) { if (good != url) good = url }

    /** The Drive link from the server (refresh token, Google client, folder, mode) as JSON: the TV downloads with it on its own. */
    var driveGrant: String
        get() = p.getString("driveGrant", "") ?: ""
        set(v) = p.edit().putString("driveGrant", v).apply()

    var token: String
        get() = p.getString("token", "") ?: ""
        set(v) = p.edit().putString("token", v).apply()
    var deviceName: String
        get() = p.getString("deviceName", "") ?: ""
        set(v) = p.edit().putString("deviceName", v).apply()
    var lastUploadAt: Long
        get() = p.getLong("lastUploadAt", 0)
        set(v) = p.edit().putLong("lastUploadAt", v).apply()
    var lastUploadName: String
        get() = p.getString("lastUploadName", "") ?: ""
        set(v) = p.edit().putString("lastUploadName", v).apply()
    var lastReportOk: Long
        get() = p.getLong("lastReportOk", 0)
        set(v) = p.edit().putLong("lastReportOk", v).apply()
    var lastError: String
        get() = p.getString("lastError", "") ?: ""
        set(v) = p.edit().putString("lastError", v).apply()

    /** The local date (yyyy-MM-dd) on which the morning panel was last shown. */
    /** The home screen scene: "auto" (festival by date, snow when it is cold), or one fixed scene, or "off". */
    var scene: String
        get() = p.getString("scene", "auto") ?: "auto"
        set(v) = p.edit().putString("scene", v).apply()

    var morningShown: String
        get() = p.getString("morningShown", "") ?: ""
        set(v) = p.edit().putString("morningShown", v).apply()
    /** The last good answer of /home/agent/tv-home, kept so the launcher is not empty while offline. */
    var homeCache: String
        get() = p.getString("homeCache", "") ?: ""
        set(v) = p.edit().putString("homeCache", v).apply()

    /** Local mode: the shared key the server gave this TV, and where the tablet was last found on the Wi-Fi. */
    var localKey: String
        get() = p.getString("localKey", "") ?: ""
        set(v) = p.edit().putString("localKey", v).apply()
    var localAddr: String
        get() = p.getString("localAddr", "") ?: ""
        set(v) = p.edit().putString("localAddr", v).apply()
    var localAddrAt: Long
        get() = p.getLong("localAddrAt", 0)
        set(v) = p.edit().putLong("localAddrAt", v).apply()
    /** When homeCache was saved (the cached home screen is shown for 24 hours at most). */
    var homeCacheAt: Long
        get() = p.getLong("homeCacheAt", 0)
        set(v) = p.edit().putLong("homeCacheAt", v).apply()

    /** Screen mirror: the phones that may cast without the PIN (JSON list) and the current 4-digit PIN. */
    var castTokens: String
        get() = p.getString("castTokens", "") ?: ""
        set(v) = p.edit().putString("castTokens", v).apply()
    private var castPinValue: String
        get() = p.getString("castPin", "") ?: ""
        set(v) = p.edit().putString("castPin", v).apply()
    private var castPinAt: Long
        get() = p.getLong("castPinAt", 0)
        set(v) = p.edit().putLong("castPinAt", v).apply()

    /** The PIN a phone must type (new every 24 hours and every time one is used). */
    @Synchronized fun castPin(): String {
        val now = System.currentTimeMillis()
        if (castPinValue.length != 4 || com.tanush.stashr.tv.cast.Pin.needsNew(castPinAt, now)) { castPinValue = com.tanush.stashr.tv.cast.Pin.generate(); castPinAt = now }
        return castPinValue
    }
    @Synchronized fun rotateCastPin() { castPinValue = com.tanush.stashr.tv.cast.Pin.generate(); castPinAt = System.currentTimeMillis() }

    /** The last error worth showing on the website's health check (a crash, or a report/cast/sync failure), kept 7 days. */
    fun healthError(): HealthError? {
        val raw = p.getString("healthError", "") ?: ""
        if (raw.isEmpty()) return null
        return try { org.json.JSONObject(raw).let { HealthError(it.optLong("at"), it.optString("where"), it.optString("text")) } } catch (e: Exception) { null }
    }
    fun setHealthError(e: HealthError) {
        p.edit().putString("healthError", org.json.JSONObject().put("at", e.at).put("where", e.where).put("text", e.text.take(Health.MAX_TEXT)).toString()).commit()   // commit: a crash may follow
    }

    fun position(name: String): Long = p.getLong("pos_" + name.hashCode(), 0)
    fun savePosition(name: String, ms: Long) = p.edit().putLong("pos_" + name.hashCode(), ms).apply()

    val linked get() = token.startsWith("sh_")

    fun unlink() = p.edit().remove("token").remove("deviceName").apply()
}
