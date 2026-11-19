package com.tanush.stashr.hub.whatsapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * A way to test the number sender from a computer over adb, without the server:
 *   adb shell am broadcast -n com.tanush.stashr.hub/.whatsapp.ShellSend -a com.tanush.stashr.hub.SHELL_SEND --es phone 919810012345 --es text "hi" --es account normal
 * Only the adb shell (the DUMP permission) can call it; the answer is in logcat under "StashrShellSend".
 */
class ShellSend : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val args = JSONObject().put("phone", i.getStringExtra("phone") ?: "").put("text", i.getStringExtra("text") ?: "").put("account", i.getStringExtra("account") ?: "business")
        val app = ctx.applicationContext
        val pending = goAsync()
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val group = i.getStringExtra("group")
                Log.i("StashrShellSend", "OK: " + if (group != null) WhatsAppSender.send(app, group, i.getStringExtra("text") ?: "") else WaLeadSender.send(app, args))
            }
            catch (e: Exception) { Log.i("StashrShellSend", "FAILED: " + (e.message ?: "")) }
            finally { pending.finish() }
        }
    }
}
