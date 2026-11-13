package com.tanush.stashr.hub.whatsapp

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.PowerManager
import kotlinx.coroutines.delay

/**
 * Sends a text to a WhatsApp group from the tablet: wakes the screen, opens WhatsApp's share list with the text, and
 * lets [WhatsAppAccessibility] pick the group and press Send. One message at a time; the result goes back as an ack.
 */
object WhatsAppSender {
    class Job(val group: String, val text: String, val deadline: Long) {
        @Volatile var picked = false
        @Volatile var done = false
        @Volatile var error: String? = null
        var scrolls = 0
        var searched = false
        var typed = false
        var misses = 0
        @Volatile var clicks = 0
        @Volatile var pickedAt = 0L
        @Volatile var repicks = 0
        @Volatile var lastClick = 0L
    }

    @Volatile var job: Job? = null

    /** Group messages (Stashr Smart home) use normal WhatsApp only. WhatsApp Business is the lead sender's app and is never used here, so a
     *  group message can never go out from the business number, even when normal WhatsApp is missing. */
    private const val PACKAGE = "com.whatsapp"

    private fun installed(ctx: Context): String? =
        try { ctx.packageManager.getPackageInfo(PACKAGE, 0); PACKAGE } catch (e: PackageManager.NameNotFoundException) { null }

    /** Returns "Sent to <group>" or throws with a message you can show. */
    @Suppress("DEPRECATION")
    suspend fun send(ctx: Context, group: String, text: String): String {
        val g = group.trim(); val t = text.trim()
        if (g.isEmpty() || t.isEmpty()) throw IllegalArgumentException("Group name and message are needed")
        if (WhatsAppAccessibility.instance == null) throw IllegalStateException("Turn on Stashr Hub in Accessibility settings")
        val pkg = installed(ctx) ?: throw IllegalStateException("WhatsApp is not installed (Smart home messages use normal WhatsApp, not WhatsApp Business)")
        if (job != null && job?.done == false && System.currentTimeMillis() < job!!.deadline) throw IllegalStateException("Another message is being sent")
        // A lead message may be going out through WhatsApp Business. Opening this app now would pull WhatsApp to the front and break it,
        // so wait for it to finish (at most 90 s; it ends itself within 80 s) instead of failing a time-sensitive group message.
        val waitUntil = System.currentTimeMillis() + 90_000
        while (WaLeadSender.isBusy() && System.currentTimeMillis() < waitUntil) delay(500)
        if (WaLeadSender.isBusy()) throw IllegalStateException("Another message is being sent")
        val wasOff = com.tanush.stashr.hub.core.ScreenGuard.wasOff(ctx)
        val j = Job(g, t, System.currentTimeMillis() + 60_000)
        job = j
        val wl = (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(
            PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE, "stashr:whatsapp")
        try {
            wl.acquire(65_000)
            ctx.startActivity(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, t).setPackage(pkg)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
            while (System.currentTimeMillis() < j.deadline) {
                j.error?.let { throw IllegalStateException(it) }
                if (j.done) return "Sent to $g"
                WhatsAppAccessibility.instance?.poke()
                delay(500)
            }
            throw IllegalStateException(if (j.picked) (if (j.clicks > 0) "Pressed Send but WhatsApp did not confirm" else "Timed out before pressing Send") else "Timed out. Allow “Display over other apps” for Stashr Hub")
        } finally {
            job = null
            if (wl.isHeld) wl.release()
            if (j.done) try { ctx.startActivity(Intent(ctx, com.tanush.stashr.hub.ui.DashboardActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { }
            com.tanush.stashr.hub.core.ScreenGuard.restore(ctx, wasOff)
        }
    }

    fun serviceOn() = WhatsAppAccessibility.instance != null
}
