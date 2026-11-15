package expo.modules.stashrwidget

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Keeps the Stashr widgets live: every 15 seconds, but ONLY while the screen is on and a Stashr widget is on the home screen.
 * Screen off = no timer, no network, nothing. It asks the server for the dashboard with a read-only widget key (it can read the
 * dashboard and do nothing else), works out the lines natively (BoardText) and redraws the widgets. Failures back off to once a
 * minute and the widgets keep their last lines; a key the server no longer accepts stops it until the app makes a new one.
 */
class LiveService : Service() {
  private lateinit var thread: HandlerThread
  private lateinit var worker: Handler
  @Volatile private var screenOn = true
  private var failures = 0
  private var serverIdx = 0

  private val screenReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action == Intent.ACTION_SCREEN_ON) {
        screenOn = true
        if (Board.total(this@LiveService) == 0) { stopSelf(); return }
        worker.removeCallbacks(tick); worker.post(tick)
      } else if (intent.action == Intent.ACTION_SCREEN_OFF) {
        screenOn = false
        worker.removeCallbacks(tick)
      }
    }
  }

  private val tick = object : Runnable {
    override fun run() {
      if (!screenOn) return
      if (Board.total(this@LiveService) == 0 || WidgetStore.keyBad(this@LiveService)) { stopSelf(); return }
      refreshOnce()
      val wait = if (failures == 0) EVERY_MS else minOf(EVERY_MS shl minOf(failures, 2), 60_000L)
      worker.postDelayed(this, wait)
    }
  }

  override fun onCreate() {
    super.onCreate()
    thread = HandlerThread("stashr-live").also { it.start() }
    worker = Handler(thread.looper)
    screenOn = (getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isInteractive != false
    val nm = getSystemService(NotificationManager::class.java)
    nm?.createNotificationChannel(NotificationChannel(CHANNEL, "Stashr widgets live", NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false) })
    val open = PendingIntent.getActivity(this, 0, Intent(Intent.ACTION_VIEW, Uri.parse("stashr://stashr-home")).setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
    val n = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.stashr_sc_home).setContentTitle("Stashr widgets are live")
      .setContentText("Updating every 15 seconds while the screen is on").setContentIntent(open).setOngoing(true).build()
    if (Build.VERSION.SDK_INT >= 34) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(NOTE_ID, n)
    registerReceiver(screenReceiver, IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF) })
    if (screenOn) worker.post(tick)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (screenOn) { worker.removeCallbacks(tick); worker.post(tick) }
    return START_STICKY
  }

  override fun onDestroy() {
    try { unregisterReceiver(screenReceiver) } catch (_: Exception) { }
    worker.removeCallbacksAndMessages(null)
    thread.quitSafely()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  /** One request: the servers in order, the last good one first. */
  private fun refreshOnce() {
    val key = WidgetStore.liveKey(this)
    val servers = WidgetStore.liveServers(this)
    if (key.isEmpty() || servers.isEmpty()) { failures++; return }
    for (i in servers.indices) {
      val base = servers[(serverIdx + i) % servers.size].trimEnd('/')
      try {
        val c = URL("$base/home/widget/dashboard").openConnection() as HttpURLConnection
        c.connectTimeout = 6000; c.readTimeout = 8000; c.requestMethod = "GET"
        c.setRequestProperty("X-Widget-Key", key); c.setRequestProperty("Accept", "application/json")
        try {
          val code = c.responseCode
          if (code == 401) { WidgetStore.markKeyBad(this); return }
          if (code != 200) continue
          val dash = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
          val merged = BoardText.merge(dash, WidgetStore.json(this), System.currentTimeMillis())
          WidgetStore.save(this, merged.toString())
          Board.renderAll(this)
          serverIdx = (serverIdx + i) % servers.size
          failures = 0
          return
        } finally { c.disconnect() }
      } catch (_: Exception) { /* try the next server */ }
    }
    failures++
  }

  companion object {
    private const val CHANNEL = "stashr_live"
    private const val NOTE_ID = 7415
    private const val EVERY_MS = 15_000L

    /** Starts the service when there is a key and a widget; false when Android would not allow it from here (the app then retries when it opens). */
    fun start(context: Context): Boolean {
      val app = context.applicationContext
      if (WidgetStore.liveKey(app).isEmpty() || WidgetStore.keyBad(app) || Board.total(app) == 0) return false
      return try { app.startForegroundService(Intent(app, LiveService::class.java)); true } catch (_: Exception) { false }
    }

    fun stop(context: Context) { try { context.applicationContext.stopService(Intent(context.applicationContext, LiveService::class.java)) } catch (_: Exception) { } }
  }
}

/** After a restart or an app update the service comes back by itself (a boot start is allowed for this kind of service). */
class LiveBoot : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) { LiveService.start(context) }
}
