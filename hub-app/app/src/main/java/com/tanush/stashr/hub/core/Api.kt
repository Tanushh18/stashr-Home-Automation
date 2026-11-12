package com.tanush.stashr.hub.core

import android.content.Context
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Talks to the Stashr server with the device token. Every call is blocking: call it from a background thread or a
 * coroutine on Dispatchers.IO. Errors throw ApiError with the server's own message.
 */
class ApiError(val status: Int, message: String) : IOException(message)

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

    private fun open(path: String, method: String, auth: Boolean = true, timeoutMs: Int = 20000): HttpURLConnection {
        val c = URL(base + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = timeoutMs
        c.readTimeout = timeoutMs
        c.setRequestProperty("Accept", "application/json")
        c.setRequestProperty("User-Agent", "StashrHub/" + com.tanush.stashr.hub.BuildConfig.VERSION_NAME)
        if (auth) c.setRequestProperty("Authorization", "Bearer " + prefs.token)
        return c
    }

    private fun read(c: HttpURLConnection): JSONObject {
        val code = c.responseCode
        val stream = if (code in 200..299) c.inputStream else c.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
        val json = try { if (text.isBlank()) JSONObject() else JSONObject(text) } catch (e: Exception) { JSONObject() }
        if (code !in 200..299) throw ApiError(code, json.optString("error", "The server answered HTTP $code."))
        return json
    }

    fun get(path: String, auth: Boolean = true): JSONObject = failover {
        val c = open(path, "GET", auth)
        try { read(c) } finally { c.disconnect() }
    }

    fun post(path: String, body: JSONObject, auth: Boolean = true, timeoutMs: Int = 20000): JSONObject = failover {
        val c = open(path, "POST", auth, timeoutMs)
        try {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            read(c)
        } finally { c.disconnect() }
    }

    /** POST /home/agent/pair: the 8-letter code in, the device token out. */
    fun pair(code: String, name: String): JSONObject = post("/home/agent/pair", JSONObject().put("code", code).put("name", name), auth = false)

    /** POST /home/agent/link: the tablet's fixed code from the Stashr website and a name in; { token, device } out. */
    fun linkTablet(code: String, name: String): JSONObject = post("/home/agent/link", JSONObject().put("code", code).put("name", name).put("kind", "hub"), auth = false)

    /** POST /home/agent/report: status in, { commands: [{ id, type, args }], childCommands } out. */
    fun report(body: JSONObject): JSONObject = post("/home/agent/report", body, timeoutMs = 45000)

    fun dashboard(): JSONObject = get("/home/agent/dashboard")
    fun assistant(text: String): JSONObject = post("/home/agent/assistant", JSONObject().put("text", text))
    fun runScene(id: String): JSONObject = post("/home/agent/scene/" + URLEncoder.encode(id, "UTF-8"), JSONObject())
    fun today(): JSONObject = get("/home/agent/today")
    fun houseMap(): JSONObject = get("/home/agent/map")
    /** The room model: everything it knows now (GET), and Start / Stop (POST). The website shows the same numbers. */
    fun roomLive(): JSONObject = get("/home/agent/room/live")
    fun roomModel(on: Boolean): JSONObject = post("/home/agent/room/model", JSONObject().put("on", on))
    fun slideshow(): JSONObject = get("/home/agent/slideshow")

    /** The picture for one queued WhatsApp message (GET /wa/agent/image/:sendId), as bytes. */
    fun waImage(sendId: String): ByteArray = failover {
        val c = open("/wa/agent/image/" + URLEncoder.encode(sendId, "UTF-8"), "GET", timeoutMs = 60000)
        try {
            if (c.responseCode !in 200..299) throw ApiError(c.responseCode, "The picture is not available")
            c.inputStream.use { it.readBytes() }
        } finally { c.disconnect() }
    }

    /** A slideshow photo's bytes. */
    fun slideshowFile(id: String): ByteArray = failover {
        val c = open("/home/agent/slideshow/file?id=" + URLEncoder.encode(id, "UTF-8"), "GET", timeoutMs = 60000)
        try {
            if (c.responseCode !in 200..299) throw ApiError(c.responseCode, "Photo not available")
            c.inputStream.use { it.readBytes() }
        } finally { c.disconnect() }
    }

    /** POST /home/agent/media: a JPEG photo or an MP4 clip from the camera. reason: motion | snapshot | clip. */
    fun uploadMedia(kind: String, reason: String, bytes: ByteArray): JSONObject = failover {
        val c = open("/home/agent/media?kind=$kind&reason=$reason", "POST", timeoutMs = 120000)
        try {
            c.doOutput = true
            c.setRequestProperty("Content-Type", if (kind == "video") "video/mp4" else "image/jpeg")
            c.setFixedLengthStreamingMode(bytes.size)
            c.outputStream.use { it.write(bytes) }
            read(c)
        } finally { c.disconnect() }
    }

    /** POST /home/agent/live: one small JPEG frame of the live view. */
    fun uploadLive(bytes: ByteArray): JSONObject = failover {
        val c = open("/home/agent/live", "POST", timeoutMs = 15000)
        try {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "image/jpeg")
            c.setFixedLengthStreamingMode(bytes.size)
            c.outputStream.use { it.write(bytes) }
            read(c)
        } finally { c.disconnect() }
    }

    /** GET /api/mobile-updates/hub/latest. */
    fun hubLatest(currentVersionCode: Int): JSONObject = get("/api/mobile-updates/hub/latest?currentVersionCode=$currentVersionCode", auth = true)   // the device token tells Stashr which tablet is asking

    /** Downloads a URL into a file (the update APK). */
    fun download(url: String, into: File) {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20000; c.readTimeout = 120000
        try {
            if (c.responseCode !in 200..299) throw ApiError(c.responseCode, "Download failed: HTTP ${c.responseCode}")
            c.inputStream.use { input -> into.outputStream().use { input.copyTo(it) } }
        } finally { c.disconnect() }
    }
}

@Suppress("unused")
private fun ByteArrayOutputStream.bytes() = toByteArray()
