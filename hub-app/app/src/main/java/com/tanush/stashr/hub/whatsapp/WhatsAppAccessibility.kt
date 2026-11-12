package com.tanush.stashr.hub.whatsapp

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.util.Log
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Looks at WhatsApp only while [WhatsAppSender] has a message waiting: taps the group in the share list (scrolling,
 * then searching if it is not visible) and presses Send. It never reads or stores anything else.
 */
class WhatsAppAccessibility : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private var lastAttempt = 0L

    override fun onServiceConnected() { instance = this }
    override fun onUnbind(intent: android.content.Intent?): Boolean { if (instance === this) instance = null; return super.onUnbind(intent) }
    override fun onInterrupt() {}
    override fun onDestroy() { if (instance === this) instance = null; super.onDestroy() }

    override fun onAccessibilityEvent(e: AccessibilityEvent?) { if (WhatsAppSender.job != null || WaLeadSender.job != null) poke() }

    /** Called by events and by the sender's 500 ms loop; one attempt at a time, at most every 250 ms. */
    fun poke() { main.post { attempt() } }

    private fun attempt() {
        WaLeadSender.job?.let { wj -> if (!wj.done && wj.error == null) { waStep(wj); return } }
        val job = WhatsAppSender.job ?: return
        if (job.done || job.error != null) return
        val now = System.currentTimeMillis()
        if (now - lastAttempt < 250) return
        lastAttempt = now
        val root = rootInActiveWindow ?: return
        try {
            val pkg = root.packageName?.toString() ?: return
            if (pkg != "com.whatsapp" && pkg != "com.whatsapp.w4b") return
            if (!job.picked) pickGroup(root, job) else pressSend(root, job)
        } finally { try { root.recycle() } catch (e: Exception) { } }
    }

    /** Hides the on-screen keyboard while a number send runs, so it cannot cover or change WhatsApp's screens. */
    fun hideKeyboard(hidden: Boolean) {
        try { softKeyboardController.showMode = if (hidden) AccessibilityService.SHOW_MODE_HIDDEN else AccessibilityService.SHOW_MODE_AUTO }
        catch (e: Throwable) { Log.w(TAG, "keyboard mode failed: ${e.message}") }
    }

    /** The root of the first on-screen window of this package (WhatsApp can show the chat list and the chat as two windows). */
    private fun windowRoot(pkg: String): AccessibilityNodeInfo? {
        for (w in windows) { val r = w.root ?: continue; if (r.packageName?.toString() == pkg) return r }
        return null
    }

    /** The first node with this id in any WhatsApp Business window. */
    private fun findAcross(id: String): AccessibilityNodeInfo? {
        for (w in windows) {
            val r = w.root ?: continue
            if (r.packageName?.toString() != WaLeadSender.PACKAGE) continue
            r.findAccessibilityNodeInfosByViewId("${WaLeadSender.PACKAGE}:id/$id").orEmpty().firstOrNull()?.let { return it }
        }
        return null
    }

    /**
     * One step of a number send. With a picture: attach button, Gallery, the newest photo, the preview's Send, then wait for
     * the chat to come back. Without: the composer's Send. A number WhatsApp says is invalid ends the job at once.
     */
    private fun waStep(j: WaLeadSender.Job) {
        val now = System.currentTimeMillis()
        windowRoot("com.google.android.permissioncontroller")?.let { perm ->
            perm.findAccessibilityNodeInfosByText("Allow").orEmpty().firstOrNull()?.let { if (clickUp(it)) j.stageAt = now }
            return
        }
        val root = windowRoot(WaLeadSender.PACKAGE) ?: return
        if (j.clicks == 0 && j.stage == 0) {
            val bad = root.findAccessibilityNodeInfosByText("isn't on WhatsApp").orEmpty() + root.findAccessibilityNodeInfosByText("not on WhatsApp").orEmpty() +
                root.findAccessibilityNodeInfosByText("invalid").orEmpty()
            if (bad.isNotEmpty()) {
                root.findAccessibilityNodeInfosByText("OK").orEmpty().firstOrNull()?.let { clickUp(it) }
                j.error = "That number is not on WhatsApp"
                return
            }
        }
        if (now - j.stageAt < 900) return
        Log.d(TAG, "wa stage=${j.stage} image=${j.withImage}")
        when (j.stage) {
            0 -> if (j.withImage) {
                val att = findAcross("input_attach_button") ?: return
                if (clickUp(att)) { j.stage = 1; j.stageAt = now }
            } else {
                val send = findAcross("send") ?: return
                if (clickUp(send)) { j.clicks++; j.lastClick = now; j.stage = 4; j.stageAt = now }
            }
            1 -> { val g = findAcross("pickfiletype_gallery_holder") ?: return; if (clickUp(g)) { j.stage = 2; j.stageAt = now } }
            2 -> { val t = findAcross("media_item_view") ?: return; if (clickUp(t)) { j.stage = 3; j.stageAt = now } }
            3 -> { val b = findAcross("send_media_btn") ?: return; if (clickUp(b)) { j.clicks++; j.lastClick = now; j.stage = 4; j.stageAt = now } }
            4 -> {
                val chat = findAcross("input_attach_button") != null
                val busy = findAcross("send_media_btn") != null || findAcross("send") != null
                if (chat && !busy && now - j.stageAt > 2_000) j.done = true
            }
        }
    }

    private fun pickGroup(root: AccessibilityNodeInfo, job: WhatsAppSender.Job) {
        val hit = root.findAccessibilityNodeInfosByText(job.group).orEmpty().firstOrNull { !it.isEditable && it.className?.toString()?.contains("EditText") != true }
        if (hit != null && clickUp(hit)) { Log.d(TAG, "group row pressed"); job.picked = true; job.pickedAt = System.currentTimeMillis(); return }
        // Not visible: scroll a few times, then use the search box.
        if (job.scrolls < 5) {
            job.scrolls++
            val list = firstScrollable(root)
            if (list != null && list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) return
            job.scrolls = 5
        }
        if (!job.searched) {
            val s = root.findAccessibilityNodeInfosByText("Search").orEmpty().firstOrNull { it.contentDescription?.toString().equals("Search", true) && !it.isEditable }
            if (s != null && clickUp(s)) job.searched = true else job.misses++
        } else if (!job.typed) {
            val edit = findEditable(root)
            if (edit != null) {
                val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, job.group) }
                if (edit.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) job.typed = true
            } else job.misses++
        } else job.misses++
        if (job.misses > 12 || (job.typed && ++job.misses > 12)) job.error = "Group not found"
    }

    /**
     * WhatsApp's share flow can have two Send steps (a bar under the chosen chat, then the preview with the text), so one
     * click is not "sent". After a click it waits 1.5 s for the next screen; the message counts as sent once no Send button
     * has shown for 2.5 s after at least one click. The same button is never pressed twice within 1.5 s.
     */
    private fun pressSend(root: AccessibilityNodeInfo, job: WhatsAppSender.Job) {
        val now = System.currentTimeMillis()
        if (job.clicks > 0 && now - job.lastClick < 1_500) return
        val btn = findSendButton(root)
        if (btn != null) {
            if (clickUp(btn)) { job.clicks++; job.lastClick = now; job.misses = 0 }
            return
        }
        if (job.clicks > 0) { if (now - job.lastClick > 2_500) job.done = true }
        else if (now - job.pickedAt > 4_000) {
            // The group press did not lead to a Send button: choose the group again, a few times at most.
            if (++job.repicks > 3) job.error = "Could not select the group in WhatsApp"
            else { job.picked = false; job.pickedAt = 0 }
        }
    }

    private fun findSendButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        for (id in SEND_IDS) root.findAccessibilityNodeInfosByViewId(id).orEmpty().firstOrNull { it.isVisibleToUser }?.let { return it }
        for (w in SEND) {
            val n = root.findAccessibilityNodeInfosByText(w).orEmpty().firstOrNull {
                it.isVisibleToUser && !it.isEditable && (it.text?.toString().equals(w, true) || it.contentDescription?.toString().equals(w, true))
            }
            if (n != null) return n
        }
        return null
    }

    /** Presses the nearest clickable parent; when none is exposed (WhatsApp's newer lists), taps the middle of the view itself. */
    private fun clickUp(n: AccessibilityNodeInfo): Boolean {
        var cur: AccessibilityNodeInfo? = n
        var hops = 0
        while (cur != null && hops < 7) {
            if (cur.isClickable && cur.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
            cur = cur.parent; hops++
        }
        return tap(n)
    }

    private fun tap(n: AccessibilityNodeInfo): Boolean {
        val r = Rect(); n.getBoundsInScreen(r)
        if (r.isEmpty) return false
        val path = Path().apply { moveTo(r.exactCenterX(), r.exactCenterY()) }
        val ok = dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 80)).build(), null, null)
        Log.d(TAG, "tap at ${r.centerX()},${r.centerY()} dispatched=$ok")
        return ok
    }

    private fun firstScrollable(n: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (n.isScrollable) return n
        for (i in 0 until n.childCount) { val c = n.getChild(i) ?: continue; firstScrollable(c)?.let { return it } }
        return null
    }

    private fun findEditable(n: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (n.isEditable) return n
        for (i in 0 until n.childCount) { val c = n.getChild(i) ?: continue; findEditable(c)?.let { return it } }
        return null
    }

    companion object {
        @Volatile var instance: WhatsAppAccessibility? = null
        private const val TAG = "StashrWA"
        private val SEND = listOf("Send", "भेजें", "Enviar", "Envoyer")
        private val SEND_IDS = listOf("com.whatsapp:id/send", "com.whatsapp.w4b:id/send")
    }
}
