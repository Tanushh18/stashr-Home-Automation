package com.tanush.stashr.where.core

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** An error answer from the server, with its own message. 401 means this phone is no longer linked. */
class ApiError(val status: Int, message: String) : IOException(message)

/** Talks to the Stashr server. Blocking: call from a background thread or Dispatchers.IO. */
class Api(ctx: Context) {
    private val prefs = Prefs(ctx)
    /** The server this call is going to; Api tries the other one when it cannot be reached (see failover). */
    @Volatile var base: String = prefs.servers.firstOrNull() ?: prefs.server
        private set

    /** Tries each server in turn: the one that worked last, then the other. Only a missing connection or a 502-504 moves on. */
    private fun <T> failover(block: () -> T): T {
        var last: IOException? = null
        for (s in prefs.servers.ifEmpty { listOf(prefs.server) }) {
            base = s
            try { val r = block(); prefs.serverWorked(s); return r }
            catch (e: ApiError) { if (e.status !in 502..504) throw e; last = e }
            catch (e: IOException) { last = e }
        }
        throw last ?: IOException("No server to reach.")
    }

    private fun open(path: String, method: String, auth: Boolean, timeoutMs: Int): HttpURLConnection {
        val c = URL(base + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = timeoutMs; c.readTimeout = timeoutMs
        c.setRequestProperty("Accept", "application/json")
        c.setRequestProperty("User-Agent", "StashrLocation/" + com.tanush.stashr.where.BuildConfig.VERSION_NAME)
        if (auth) c.setRequestProperty("Authorization", "Bearer " + prefs.token)
        return c
    }

    private fun read(c: HttpURLConnection): JSONObject {
        val code = c.responseCode
        val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        val json = try { if (text.isBlank()) JSONObject() else JSONObject(text) } catch (e: Exception) { JSONObject() }
        if (code !in 200..299) throw ApiError(code, json.optString("error", "The server answered HTTP $code."))
        return json
    }

    private fun get(path: String, auth: Boolean): JSONObject = failover {
        val c = open(path, "GET", auth, 20000)
        try { read(c) } finally { c.disconnect() }
    }

    private fun post(path: String, body: JSONObject, auth: Boolean, timeoutMs: Int = 20000): JSONObject = failover {
        val c = open(path, "POST", auth, timeoutMs)
        try {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            read(c)
        } finally { c.disconnect() }
    }

    /** POST /home/agent/link: the code from the Stashr website and the person's name in; { token, name, deviceId } out. */
    fun link(code: String, name: String): JSONObject = post("/home/agent/link", JSONObject().put("code", code).put("name", name), auth = false)

    /** POST /home/agent/unlink: tells Stashr this phone disconnected itself. */
    fun unlink(): JSONObject = post("/home/agent/unlink", JSONObject(), auth = true)

    /** POST /home/agent/location. */
    fun location(body: JSONObject): JSONObject = post("/home/agent/location", body, auth = true, timeoutMs = 30000)

    /** Room Lab: the rooms, whether room location is on for this phone, how many scans each room has, and the room now. */
    fun roomConfig(): JSONObject = get("/home/agent/room/config", auth = true)
    fun roomAdd(name: String): JSONObject = post("/home/agent/room/add", JSONObject().put("name", name), auth = true)
    fun roomOn(on: Boolean): JSONObject = post("/home/agent/room/on", JSONObject().put("on", on), auth = true)
    /** The scans of one tap, saved under a room (training). */
    fun roomSample(room: String, session: String, scans: List<JSONObject>): JSONObject = post("/home/agent/room/sample", JSONObject().put("room", room).put("session", session).put("scans", org.json.JSONArray(scans)), auth = true, timeoutMs = 40000)
    /** "That was wrong, I am in <room>": the scans are saved as a correction. */
    fun roomFix(room: String, scans: List<JSONObject>): JSONObject = post("/home/agent/room/fix", JSONObject().put("room", room).put("session", "fix" + System.currentTimeMillis()).put("scans", org.json.JSONArray(scans)), auth = true, timeoutMs = 40000)
    fun roomReport(): JSONObject = get("/home/agent/room/report", auth = true)
    /** "Sahi hai": the room Stashr showed was right (counted for the real-life accuracy). With a short scan it also teaches the model. */
    fun roomConfirm(room: String = "", scans: List<JSONObject> = emptyList()): JSONObject =
        post("/home/agent/room/confirm", JSONObject().apply { if (room.isNotEmpty() && scans.isNotEmpty()) { put("room", room); put("scans", org.json.JSONArray(scans)) } }, auth = true, timeoutMs = 40000)
    /** Auto-improve on or off for this phone. */
    fun roomAuto(on: Boolean): JSONObject = post("/home/agent/room/auto", JSONObject().put("on", on), auth = true)
    /** "Kamra hatao": deletes a room for the whole home (every phone's training for it). */
    fun roomDelete(name: String): JSONObject = post("/home/agent/room/delete", JSONObject().put("name", name), auth = true)

    /** GET /api/mobile-updates/where/latest. */
    fun latest(currentVersionCode: Int): JSONObject = get("/api/mobile-updates/where/latest?currentVersionCode=$currentVersionCode", auth = true)   // the device token tells Stashr which phone is asking, so an update can be offered to chosen devices only

    fun download(url: String, into: File) {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20000; c.readTimeout = 120000
        try {
            if (c.responseCode !in 200..299) throw ApiError(c.responseCode, "Download failed: HTTP ${c.responseCode}")
            c.inputStream.use { input -> into.outputStream().use { input.copyTo(it) } }
        } finally { c.disconnect() }
    }
}
