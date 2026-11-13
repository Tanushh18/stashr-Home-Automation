package com.tanush.stashr.where.work

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import com.tanush.stashr.where.R
import com.tanush.stashr.where.core.Prefs
import com.tanush.stashr.where.core.StatusText
import com.tanush.stashr.where.ui.MainActivity

/**
 * The always-on service. While the phone is linked and "Always work in background" is on (the default; it can be switched off on
 * each phone inside the app), this foreground service runs all the time: it shows the quiet "connected to your home" notification,
 * listens for location in the background and hands every fix to the uploader, re-arms the scheduled checks, and is restarted by a
 * watchdog alarm if the phone's battery manager ever kills it.
 */
class StatusService : Service() {
    private var listening = false
    private val listener = object : LocationListener {
        override fun onLocationChanged(loc: Location) {
            val prefs = Prefs(this@StatusService)
            if (!prefs.linked) return
            val f = Locator.toFix(loc)
            prefs.pendingLat = f.lat; prefs.pendingLon = f.lon; prefs.pendingAcc = f.acc; prefs.pendingAt = f.at; prefs.pendingSpeed = f.speed ?: -1f
            Scheduler.uploadPassive(this@StatusService)
        }
        @Deprecated("Deprecated in Java") override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = Prefs(this)
        if (!wanted(prefs)) { stopListening(); stopForeground(STOP_FOREGROUND_REMOVE); cancelWatchdog(this); stopSelf(); return START_NOT_STICKY }
        val nm = getSystemService(NotificationManager::class.java)
        nm?.createNotificationChannel(NotificationChannel(CHANNEL, "Connected to your home", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        val open = PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val text = StatusText.message(prefs.name)
        val n = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat).setContentTitle(StatusText.TITLE).setContentText(text)
            .setOngoing(true).setShowWhen(false).setContentIntent(open).setCategory(Notification.CATEGORY_SERVICE).build()
        if (!startAsForeground(n, prefs.alwaysOn && Locator.hasPermission(this))) { stopSelf(); return START_NOT_STICKY }
        if (prefs.alwaysOn) {
            startListening()
            Scheduler.start(this)
            armWatchdog(this)
        } else { stopListening(); cancelWatchdog(this) }
        return START_STICKY
    }

    /** Location-type first (keeps location alive in the background); when Android refuses that, the plain notification type. */
    private fun startAsForeground(n: Notification, withLocation: Boolean): Boolean {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                val type = if (withLocation) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                startForeground(ID, n, type)
            } else if (Build.VERSION.SDK_INT >= 29 && withLocation) {
                startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            } else startForeground(ID, n)
            return true
        } catch (_: Exception) { }
        return try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(ID, n)
            true
        } catch (_: Exception) { false }
    }

    @SuppressLint("MissingPermission")
    private fun startListening() {
        if (listening || !Locator.hasPermission(this)) return
        try {
            val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            // Network provider every minute (cheap); GPS is not held on, the scheduled checks ask for it when needed.
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 60_000L, 50f, listener, mainLooper)
            lm.requestLocationUpdates(LocationManager.PASSIVE_PROVIDER, 0L, 0f, listener, mainLooper)
            listening = true
        } catch (_: Exception) { }
    }

    private fun stopListening() {
        if (!listening) return
        try { (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(listener) } catch (_: Exception) { }
        listening = false
    }

    /** Swiping the app away must not stop it: come back at once. */
    override fun onTaskRemoved(rootIntent: Intent?) { if (wanted(Prefs(this)) && Prefs(this).alwaysOn) armWatchdog(this, 2_000L); super.onTaskRemoved(rootIntent) }

    override fun onDestroy() { stopListening(); super.onDestroy() }

    companion object {
        private const val CHANNEL = "status"
        private const val ID = 4001
        private const val WATCHDOG_MS = 10 * 60_000L

        private fun wanted(p: Prefs) = p.linked && (p.alwaysOn || p.statusOn)

        private fun watchdogIntent(ctx: Context) =
            PendingIntent.getBroadcast(ctx, 21, Intent(ctx, BootReceiver::class.java).setPackage(ctx.packageName).setAction("com.tanush.stashr.where.WATCHDOG"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        /** A repeating "are you still there?" alarm: the receiver restarts the service if the phone killed it. */
        fun armWatchdog(ctx: Context, afterMs: Long = WATCHDOG_MS) {
            try {
                (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + afterMs, watchdogIntent(ctx))
            } catch (_: Exception) { }
        }

        fun cancelWatchdog(ctx: Context) { try { (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(watchdogIntent(ctx)) } catch (_: Exception) { } }

        /** Starts the service when the phone is linked and always-on (or the notification) is wanted, stops it otherwise. Never throws. */
        fun sync(ctx: Context) {
            val app = ctx.applicationContext
            val prefs = Prefs(app)
            try {
                val i = Intent(app, StatusService::class.java)
                if (wanted(prefs)) app.startForegroundService(i) else { app.stopService(i); cancelWatchdog(app) }
            } catch (_: Exception) { }
        }
    }
}
