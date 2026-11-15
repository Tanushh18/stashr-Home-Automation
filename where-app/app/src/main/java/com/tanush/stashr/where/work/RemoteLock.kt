package com.tanush.stashr.where.work

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import com.tanush.stashr.where.core.LockLogic
import com.tanush.stashr.where.core.Prefs

/** Android's "device admin" hook. It is only here so the phone may lock its own screen on request; see res/xml/lock_admin.xml. */
class LockAdmin : DeviceAdminReceiver()

object RemoteLock {
    private fun dpm(ctx: Context) = ctx.applicationContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
    private fun component(ctx: Context) = ComponentName(ctx.applicationContext, LockAdmin::class.java)

    /** True when the owner switched Remote lock on. */
    fun isOn(ctx: Context): Boolean = try { dpm(ctx)?.isAdminActive(component(ctx)) == true } catch (_: Exception) { false }

    /** The Android screen that asks the owner to allow it (the only way to switch it on; nothing happens without a tap there). */
    fun askIntent(ctx: Context): Intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
        .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, component(ctx))
        .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "Lets Stashr lock this phone's screen when you press Lock in Stashr. It cannot erase or read anything.")

    fun turnOff(ctx: Context) { try { dpm(ctx)?.removeActiveAdmin(component(ctx)) } catch (_: Exception) { } }

    /**
     * Called by the push. Locks when allowed, remembers what happened (which travels to Stashr with the next report, so the other
     * phone's screen says "locked at 21:04" or why not) and asks for that report right away.
     */
    fun handle(ctx: Context, sentAtMs: Long) {
        val app = ctx.applicationContext
        val prefs = Prefs(app)
        val verdict = LockLogic.decide(prefs.linked, isOn(app), sentAtMs, System.currentTimeMillis())
        var ok = false
        var reason = verdict.reason
        if (verdict == LockLogic.Verdict.LOCK) {
            try { dpm(app)?.lockNow(); ok = true } catch (e: Exception) { reason = "lock_failed" }
        }
        prefs.lastLockAt = System.currentTimeMillis()
        prefs.lastLockOk = ok
        prefs.lastLockReason = reason
        LockLogic.notice(verdict)?.let { Notices.show(app, listOf("lock-${prefs.lastLockAt}" to it)) }
        if (prefs.linked) Scheduler.pushed(app, force = true)
    }
}
