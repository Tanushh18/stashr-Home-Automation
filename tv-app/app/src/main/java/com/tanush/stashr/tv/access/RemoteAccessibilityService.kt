package com.tanush.stashr.tv.access

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.provider.Settings
import android.content.Intent
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Lets Stashr press Home / Back on the TV and learn which app is open. It reads no screen content
 * (canRetrieveWindowContent is off): only the package name of the window that just came forward.
 */
class RemoteAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() { instance = this }
    override fun onUnbind(intent: android.content.Intent?): Boolean { if (instance === this) instance = null; return super.onUnbind(intent) }
    override fun onInterrupt() {}

    /**
     * The remote's Google Play button (KEYCODE_BUTTON_2): the TV's own system code would open the Play Store before any app sees it.
     * The key filter sees it first, so Stashr takes it and opens the pendrive folder instead. Every other key passes through untouched.
     */
    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode != KeyEvent.KEYCODE_BUTTON_2) return false
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            try { startActivity(Intent(this, com.tanush.stashr.tv.ui.UsbBrowserActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { return false }
        }
        return true
    }

    override fun onAccessibilityEvent(e: AccessibilityEvent?) {
        if (e?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = e.packageName?.toString() ?: return
        if (pkg == "android" || pkg == "com.android.systemui" || pkg.contains("inputmethod") || pkg.contains("keyboard")) return
        val label = try { val pm = packageManager; pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() } catch (x: Exception) { pkg }
        foreground = pkg to label
    }

    companion object {
        @Volatile var instance: RemoteAccessibilityService? = null
        /** (package, label) of the app that came forward last, or null. */
        @Volatile var foreground: Pair<String, String>? = null

        fun enabled(ctx: Context): Boolean {
            val want = ctx.packageName + "/" + RemoteAccessibilityService::class.java.name
            val list = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            return list.split(':').any { it.equals(want, true) || it.equals(ctx.packageName + "/" + RemoteAccessibilityService::class.java.name.removePrefix(ctx.packageName), true) }
        }

        fun home(): Boolean = instance?.performGlobalAction(GLOBAL_ACTION_HOME) ?: false
        fun back(): Boolean = instance?.performGlobalAction(GLOBAL_ACTION_BACK) ?: false
    }
}
