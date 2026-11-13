package com.tanush.stashr.where.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * The pure part of Room Lab (no Android types, unit-tested): what a scan looks like when it leaves the phone, and the small bits of
 * wording. The guess itself (which room?) is made on the server, see server/utils/roomModel.js.
 *
 * A SCAN is "what this phone hears right now": Wi-Fi networks and Bluetooth devices, each with its signal strength in dBm
 * (about -30 = very close, -90 = barely heard). Ids are the raw addresses here; the server turns them into unreadable codes at once.
 */
object RoomLogic {
    data class Hear(val id: String, val rssi: Int)

    const val MAX_IDS = 40          // the strongest ones are enough, and keep the upload small
    const val MAX_SCANS = 12        // one tap sends at most this many scans (Android only allows a few new Wi-Fi scans a minute anyway)
    const val MIN_HEARD = 2         // a scan that heard fewer than this is useless

    /** One entry per id (the strongest reading wins), loudest first, at most [n]. */
    fun strongest(list: List<Hear>, n: Int = MAX_IDS): List<Hear> =
        list.filter { it.id.isNotBlank() && it.rssi in -127..-1 }.groupBy { it.id.lowercase() }
            .map { (id, v) -> Hear(id, v.maxOf { it.rssi }) }.sortedByDescending { it.rssi }.take(n)

    fun scanJson(wifi: List<Hear>, ble: List<Hear>): JSONObject {
        fun arr(l: List<Hear>) = JSONArray().also { a -> strongest(l).forEach { a.put(JSONObject().put("b", it.id).put("r", it.rssi)) } }
        return JSONObject().put("wifi", arr(wifi)).put("ble", arr(ble))
    }

    fun heardEnough(wifi: List<Hear>, ble: List<Hear>) = strongest(wifi).size + strongest(ble).size >= MIN_HEARD

    /**
     * Turns what one tap collected into scans to upload. Every DIFFERENT Wi-Fi result becomes its own scan (all of them are used), each with the
     * Bluetooth devices heard during the tap. No Wi-Fi result at all but Bluetooth heard: one scan. Nothing usable: empty.
     */
    fun buildScans(wifiSets: List<List<Hear>>, ble: List<Hear>): List<JSONObject> {
        val distinct = ArrayList<List<Hear>>()
        for (w in wifiSets) if (distinct.none { sameSet(it, w) }) distinct.add(w)
        val sets = if (distinct.isEmpty()) listOf(emptyList()) else distinct
        return sets.filter { heardEnough(it, ble) }.take(MAX_SCANS).map { scanJson(it, ble) }
    }

    private fun sameSet(a: List<Hear>, b: List<Hear>): Boolean {
        val x = strongest(a).associate { it.id to it.rssi }; val y = strongest(b).associate { it.id to it.rssi }
        return x == y
    }

    /** Readings of Bluetooth devices over a few seconds -> one entry per device with its strongest reading. */
    fun mergeReadings(readings: List<Hear>): List<Hear> = strongest(readings)

    fun parseCounts(j: JSONObject?): Map<String, Int> = if (j == null) emptyMap() else j.keys().asSequence().associateWith { j.optInt(it) }

    fun rooms(j: JSONObject): List<String> = j.optJSONArray("rooms")?.let { a -> (0 until a.length()).map { a.getString(it) } } ?: emptyList()

    /** Rooms with too little training (fewer than [min] scans). */
    fun thin(rooms: List<String>, counts: Map<String, Int>, min: Int = 5): List<String> = rooms.filter { (counts[it] ?: 0) < min }

    fun summary(rooms: List<String>, counts: Map<String, Int>): String =
        if (rooms.isEmpty()) "Abhi koi kamra nahi: neeche ek kamra add karo." else rooms.joinToString(" · ") { "$it ${counts[it] ?: 0}" }

    fun newSession(now: Long) = "s$now"

    /* ───────── auto-improve (docs/ROOM_MODEL_AUTO_IMPROVE_PLAN.md, part D) ───────── */

    const val FRESH_SEC = 120                   // the server only learns from scans whose Wi-Fi readings are this new
    const val AUTO_SCAN_EVERY_MS = 10 * 60_000L // at most one extra Wi-Fi scan for auto-improve this often (Android allows few anyway)

    /** How old, in seconds, the oldest of these readings is. ScanResult.timestamp and the clock are both microseconds since boot. -1: none. */
    fun ageSec(nowMicros: Long, stampsMicros: List<Long>): Int =
        if (stampsMicros.isEmpty()) -1 else ((nowMicros - stampsMicros.minOrNull()!!).coerceAtLeast(0L) / 1_000_000L).toInt()

    /** Ask Android for a new Wi-Fi scan for auto-improve now? Only when it is on, the readings are not already fresh, and not too often. */
    fun autoScanDue(on: Boolean, ageSec: Int, now: Long, lastAsk: Long): Boolean =
        on && (ageSec < 0 || ageSec > FRESH_SEC) && now - lastAsk >= AUTO_SCAN_EVERY_MS

    /** The scan as it leaves the phone, with how old its Wi-Fi readings are and whether it may teach the model. */
    fun withMeta(scan: JSONObject, ageSec: Int, auto: Boolean): JSONObject = scan.put("ageSec", if (ageSec >= 0) ageSec else JSONObject.NULL).put("auto", auto)

    /** Why a scan did not teach the model, in plain words (the server's reasons: server/utils/roomModel.js autoGate). */
    fun learnWhy(why: String): String = when (why) {
        "auto-improve is off" -> "apne aap seekhna band hai"
        "paused" -> "ruka hua hai"
        "the scan is not fresh" -> "scan taaza nahi tha"
        "not sure" -> "kamra pakka nahi"
        "not sure enough" -> "75% se kam pakka"
        "two rooms are close" -> "do kamre milte-julte lage"
        "not a familiar spot" -> "ye jagah anjaan lagi"
        "the room is not settled" -> "abhi kamre mein aaye (sthir nahi)"
        "not trained enough by a person" -> "pehle har kamre mein 5+ scan khud train karo"
        "already have this spot" -> "ye jagah pehle se seekhi hui"
        "one a while ago" -> "is kamre ka abhi-abhi seekha (10 min mein ek)"
        "" -> "—"
        else -> why
    }

    /** Auto-improve in one line, from the server's config ("auto"). */
    fun autoSummary(a: JSONObject?, now: Long = System.currentTimeMillis()): String {
        if (a == null) return "Server purana hai: apne aap seekhna abhi nahi."
        if (!a.optBoolean("on", true)) return "Apne aap seekhna band hai."
        if (a.optBoolean("paused")) return "Ruka hua: ${a.optString("why").ifEmpty { "accuracy giri thi" }}. Kuch din baad phir chalega."
        val n = a.optJSONObject("counts")?.let { c -> c.keys().asSequence().sumOf { c.optInt(it) } } ?: a.optInt("added")
        if (n <= 0) return "On: abhi tak kuch nahi seekha (jab Stashr kisi kamre ke baare mein bahut pakka hoga, tab seekhega)."
        val last = a.optLong("lastAt", 0L)
        val ago = if (last > 0) ((now - last) / 60_000L).coerceAtLeast(0L) else -1L
        val agoText = if (ago < 0) "" else if (ago < 1) ", abhi" else if (ago < 60) ", $ago min pehle" else ", ${ago / 60} ghante pehle"
        return "On: $n scan apne aap seekhe" + (if (a.optString("lastRoom").isNotEmpty()) " · aakhri: ${a.optString("lastRoom")}$agoText" else "")
    }

    /** A typed room name made safe and tidy ("  living   room " -> "living room"), or null when it is shorter than 2 letters. */
    fun cleanRoom(raw: String): String? {
        val s = raw.replace(Regex("[\\u0000-\\u001f<>&\"]"), " ").replace(Regex("\\s+"), " ").trim().take(24).trim()
        return if (s.length >= 2) s else null
    }

    /** If the name is already a room (ignoring capital letters) use that room's own spelling, else the typed name (a new room). */
    fun resolveRoom(typed: String, rooms: List<String>): String = rooms.firstOrNull { it.equals(typed, ignoreCase = true) } ?: typed
}
