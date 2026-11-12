package com.tanush.stashr.hub.whatsapp

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.MediaStore
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.ScreenGuard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * One WhatsApp Business message to one number, with the sheet's picture: wakes the screen, puts the picture in the
 * gallery (so it is the newest photo in WhatsApp's picker), opens the chat by number with the text filled in, and lets
 * [WhatsAppAccessibility] attach the picture and press Send. WhatsApp Business only; normal WhatsApp is never used.
 * The result goes back to Stashr as the command's answer, and Stashr counts a message as sent only from that answer.
 */
object WaLeadSender {
    const val PACKAGE = "com.whatsapp.w4b"
    private const val JOB_MS = 80_000L

    class Job(val phone: String, val text: String, val withImage: Boolean, val deadline: Long) {
        @Volatile var stage = 0            // 0 attach button, 1 Gallery, 2 newest photo, 3 preview Send, 4 wait for the chat, 5 text Send
        @Volatile var stageAt = 0L
        @Volatile var done = false
        @Volatile var error: String? = null
        @Volatile var clicks = 0
        @Volatile var lastClick = 0L
        @Volatile var startedAt = System.currentTimeMillis()
    }

    @Volatile var job: Job? = null

    private fun installed(ctx: Context): Boolean = try { ctx.packageManager.getPackageInfo(PACKAGE, 0); true } catch (e: PackageManager.NameNotFoundException) { false }

    /** Returns "Sent to <number>" or throws with a message Stashr can show ("That number is not on WhatsApp", ...). */
    @Suppress("DEPRECATION")
    suspend fun send(ctx: Context, args: JSONObject): String {
        val phone = args.optString("phone").filter { it.isDigit() }
        val text = args.optString("text").trim()
        val sendId = args.optString("sendId")
        val withImage = args.optBoolean("image", false)
        if (phone.length !in 10..14) throw IllegalArgumentException("That is not a valid number")
        if (text.isEmpty() && !withImage) throw IllegalArgumentException("Nothing to send")
        if (WhatsAppAccessibility.instance == null) throw IllegalStateException("Turn on Stashr Hub in Accessibility settings")
        if (!installed(ctx)) throw IllegalStateException("WhatsApp Business is not installed")
        val running = job
        if (running != null && !running.done && running.error == null && System.currentTimeMillis() < running.deadline) throw IllegalStateException("Another message is being sent")
        if (WhatsAppSender.job?.done == false) throw IllegalStateException("Another message is being sent")

        if (withImage) {
            val bytes = withContext(Dispatchers.IO) { Api(ctx).waImage(sendId) }
            publishToGallery(ctx, bytes)
        }
        val wasOff = ScreenGuard.wasOff(ctx)
        val j = Job(phone, text, withImage, System.currentTimeMillis() + JOB_MS)
        job = j
        val wl = (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(
            PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE, "stashr:wa-lead")
        try {
            wl.acquire(JOB_MS + 5_000)
            WhatsAppAccessibility.instance?.hideKeyboard(true)
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$phone?text=" + Uri.encode(text))).setPackage(PACKAGE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
            while (System.currentTimeMillis() < j.deadline) {
                j.error?.let { throw IllegalStateException(it) }
                if (j.done) return "Sent to +$phone"
                WhatsAppAccessibility.instance?.poke()
                delay(500)
            }
            throw IllegalStateException(if (j.clicks > 0) "Pressed Send but WhatsApp did not confirm" else "Timed out before pressing Send (step ${j.stage})")
        } finally {
            j.done = true
            if (job === j) job = null
            WhatsAppAccessibility.instance?.hideKeyboard(false)
            try { if (wl.isHeld) wl.release() } catch (e: Exception) { }
            ScreenGuard.restore(ctx, wasOff)
        }
    }

    /** Copies the picture into Pictures/StashrWA under a fixed name, replacing the last one, so it is the newest photo. */
    private fun publishToGallery(ctx: Context, bytes: ByteArray) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw IllegalStateException("This Android version cannot attach the picture")
        val resolver = ctx.contentResolver
        val mime = if (bytes.size > 3 && bytes[0] == 0x89.toByte()) "image/png" else if (bytes.size > 11 && String(bytes, 8, 4) == "WEBP") "image/webp" else "image/jpeg"
        val name = "stashr-wa." + (if (mime == "image/png") "png" else if (mime == "image/webp") "webp" else "jpg")
        try {
            resolver.delete(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "${MediaStore.Images.Media.DISPLAY_NAME} LIKE ?", arrayOf("stashr-wa.%"))
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, name)
                put(MediaStore.Images.Media.MIME_TYPE, mime)
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/StashrWA")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val out = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: throw IllegalStateException("Could not save the picture")
            resolver.openOutputStream(out)?.use { it.write(bytes) }
            resolver.update(out, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
        } catch (e: SecurityException) {
            throw IllegalStateException("Could not save the picture: " + (e.message ?: "no permission"))
        }
    }
}
