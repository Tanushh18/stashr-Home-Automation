package com.tanush.stashr.hub.whatsapp

import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log
import kotlinx.coroutines.delay

/**
 * After an app update Android sometimes leaves the Accessibility service listed as "on" but not connected, so every WhatsApp send fails
 * until someone toggles it. When the tablet has been given the one-time permission
 *   adb shell pm grant com.tanush.stashr.hub android.permission.WRITE_SECURE_SETTINGS
 * the app switches its own service off and on and waits for it to connect. Without the permission nothing changes.
 */
object AccessibilityHeal {
    private const val TAG = "StashrWA"

    /** True when the service is connected (after trying to reconnect it if it was not running). */
    suspend fun ensure(ctx: Context): Boolean {
        if (WhatsAppAccessibility.instance != null) return true
        if (ctx.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) return false
        return try {
            val me = "${ctx.packageName}/${WhatsAppAccessibility::class.java.name}"
            val cr = ctx.contentResolver
            val cur = Settings.Secure.getString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
            val others = cur.split(":").filter { it.isNotBlank() && it != me }
            Settings.Secure.putString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, others.joinToString(":"))
            delay(700)
            Settings.Secure.putString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, (listOf(me) + others).joinToString(":"))
            Settings.Secure.putString(cr, Settings.Secure.ACCESSIBILITY_ENABLED, "1")
            var waited = 0
            while (WhatsAppAccessibility.instance == null && waited < 6_000) { delay(250); waited += 250 }
            Log.i(TAG, "accessibility reconnected=${WhatsAppAccessibility.instance != null}")
            WhatsAppAccessibility.instance != null
        } catch (e: Exception) { Log.w(TAG, "accessibility heal failed: ${e.message}"); false }
    }
}
