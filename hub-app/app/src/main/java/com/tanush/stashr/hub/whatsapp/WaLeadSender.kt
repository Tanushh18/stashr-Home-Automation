package com.tanush.stashr.hub.whatsapp

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.PowerManager
import androidx.core.content.FileProvider
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.ScreenGuard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * One WhatsApp Business message to one number, with the sheet's picture: wakes the screen, opens the chat by number, and
 * (with a picture) shares that exact picture file into the chat with the text as its caption, then lets
 * [WhatsAppAccessibility] press Send. The picture is a private file of this app, named for this message, so nothing else
 * saved to the gallery meanwhile can be sent by mistake (the old way picked "the newest photo" from the gallery).
 * WhatsApp Business only; normal WhatsApp is never used.
 * The result goes back to Stashr as the command's answer, and Stashr counts a message as sent only from that answer.
 */
object WaLeadSender {
    const val PACKAGE = "com.whatsapp.w4b"
    private const val JOB_MS = 80_000L

    class Job(val phone: String, val text: String, val withImage: Boolean, val deadline: Long) {
        @Volatile var stage = 0            // 0 wait for the chat (then share the picture), 3 the picture preview's Send, 4 wait for the chat to come back
        @Volatile var shareWanted = false  // the chat is open: the picture file can be shared into it now
        @Volatile var shared = false       // the share was started
        @Volatile var seen = ""            // the view ids last seen on WhatsApp's screen (shown in a failure, so the steps can be tuned from afar)
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

        val shareFile: File? = if (withImage) {
            val bytes = withContext(Dispatchers.IO) { Api(ctx).waImage(sendId) }
            withContext(Dispatchers.IO) { writeShareFile(ctx, bytes, sendId) }
        } else null
        val wasOff = ScreenGuard.wasOff(ctx)
        val j = Job(phone, text, withImage, System.currentTimeMillis() + JOB_MS)
        job = j
        val wl = (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(
            PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE, "stashr:wa-lead")
        try {
            wl.acquire(JOB_MS + 5_000)
            WhatsAppAccessibility.instance?.hideKeyboard(true)
            // With a picture the chat is opened empty (the text goes in as the picture's caption); without one the text is pre-filled.
            val link = if (withImage) "https://wa.me/$phone" else "https://wa.me/$phone?text=" + Uri.encode(text)
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(PACKAGE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
            while (System.currentTimeMillis() < j.deadline) {
                j.error?.let { throw IllegalStateException(it) }
                if (j.done) return "Sent to +$phone"
                if (j.shareWanted && !j.shared && shareFile != null) {
                    // The chat is open, so the number is on WhatsApp: share this message's own picture into that chat.
                    j.shared = true
                    ctx.startActivity(shareIntent(ctx, shareFile, text, phone))
                    j.stageAt = System.currentTimeMillis()
                }
                WhatsAppAccessibility.instance?.poke()
                delay(500)
            }
            throw IllegalStateException(if (j.clicks > 0) "Pressed Send but WhatsApp did not confirm" else "Timed out before pressing Send (step ${j.stage}${if (j.shared) ", picture shared" else ""}; screen: ${j.seen.ifEmpty { "nothing from WhatsApp" }})")
        } finally {
            j.done = true
            if (job === j) job = null
            try { shareFile?.delete() } catch (e: Exception) { }
            WhatsAppAccessibility.instance?.hideKeyboard(false)
            try { if (wl.isHeld) wl.release() } catch (e: Exception) { }
            ScreenGuard.restore(ctx, wasOff)
        }
    }

    /** The picture as a private file in this app's own folder (cache/wa-share), named for this message. */
    private fun writeShareFile(ctx: Context, bytes: ByteArray, sendId: String): File {
        val dir = File(ctx.cacheDir, WaImage.FOLDER).apply { mkdirs() }
        val now = System.currentTimeMillis()
        dir.listFiles()?.forEach { if (WaImage.isStale(it.lastModified(), now)) it.delete() }          // leftovers of a crashed send
        val f = File(dir, WaImage.fileName(sendId, WaImage.mimeOf(bytes), now))
        try { f.writeBytes(bytes) } catch (e: Exception) { throw IllegalStateException("Could not save the picture: " + (e.message ?: "no space")) }
        if (!f.isFile || f.length() == 0L) throw IllegalStateException("Could not save the picture")
        return f
    }

    /** "Send this file to that chat": the picture with the text as its caption, straight into the chat of this number. */
    private fun shareIntent(ctx: Context, file: File, text: String, phone: String): Intent {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file)
        return Intent(Intent.ACTION_SEND).setPackage(PACKAGE).setType(WaImage.mimeOfExt(file.extension))
            .putExtra(Intent.EXTRA_STREAM, uri)
            .apply { if (text.isNotEmpty()) putExtra(Intent.EXTRA_TEXT, text) }
            .putExtra("jid", "$phone@s.whatsapp.net")
            .apply { clipData = ClipData.newRawUri("", uri) }
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
