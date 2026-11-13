package com.tanush.stashr.where.work

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult as BleResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.wifi.ScanResult
import android.net.wifi.WifiManager
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.tanush.stashr.where.core.Prefs
import com.tanush.stashr.where.core.RoomLogic
import com.tanush.stashr.where.core.RoomLogic.Hear
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/**
 * Listens to the air around the phone: Wi-Fi networks (with their signal strength) and Bluetooth devices. Used by Room Lab to learn
 * rooms, and, when Room location is on, by the normal checks (without starting a new Wi-Fi scan, so it costs almost no battery).
 * Android limits how often a new Wi-Fi scan may be started (a few a minute while the app is open, far fewer in the background).
 */
object RoomScan {
    data class Captured(val scans: List<JSONObject>, val wifi: Int, val ble: Int)

    fun hasWifiPermission(ctx: Context) = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    fun hasBlePermission(ctx: Context) = if (Build.VERSION.SDK_INT >= 31) ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        else ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** Wi-Fi results that were measured recently (a result from minutes ago may be from another room), with when each was measured. */
    @SuppressLint("MissingPermission")
    private fun wifiReadings(wm: WifiManager, maxAgeMs: Long): List<Pair<Hear, Long>> = try {
        val now = SystemClock.elapsedRealtimeNanos() / 1000     // ScanResult.timestamp is in microseconds since boot
        wm.scanResults.filter { now - it.timestamp <= maxAgeMs * 1000 }.map { Hear(it.BSSID ?: "", it.level) to it.timestamp }
    } catch (e: Exception) { emptyList() }

    private fun freshWifi(wm: WifiManager, maxAgeMs: Long): List<Hear> = wifiReadings(wm, maxAgeMs).map { it.first }

    /**
     * Asks Android for a new Wi-Fi scan and waits up to [waitMs] for the results. Android may refuse (it allows only a few scans,
     * about one every 30 minutes for an app in the background): then false, and the readings it already has are used.
     */
    @SuppressLint("MissingPermission")
    private suspend fun refresh(app: Context, wm: WifiManager, waitMs: Long = 5_000): Boolean {
        val done = CompletableDeferred<Boolean>()
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) { done.complete(i.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, false)) }
        }
        try { app.registerReceiver(receiver, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION)) } catch (e: Exception) { return false }
        return try {
            @Suppress("DEPRECATION") val asked = try { wm.startScan() } catch (e: Exception) { false }
            if (!asked) false else withTimeoutOrNull(waitMs) { done.await() } ?: false
        } finally { try { app.unregisterReceiver(receiver) } catch (e: Exception) { } }
    }

    /** Bluetooth devices heard for [ms] milliseconds (empty when Bluetooth is off or not allowed). */
    @SuppressLint("MissingPermission")
    private suspend fun listenBle(ctx: Context, ms: Long): List<Hear> {
        val got = ArrayList<Hear>()
        val scanner = try { (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter?.takeIf { it.isEnabled }?.bluetoothLeScanner } catch (e: Exception) { null } ?: return got
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: BleResult) { got.add(Hear(result.device?.address ?: "", result.rssi)) }
            override fun onBatchScanResults(results: MutableList<BleResult>) { results.forEach { got.add(Hear(it.device?.address ?: "", it.rssi)) } }
        }
        try {
            scanner.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), cb)
            delay(ms)
        } catch (e: Exception) { /* no permission or Bluetooth went off: Wi-Fi alone still works */ }
        finally { try { scanner.stopScan(cb) } catch (e: Exception) { } }
        return RoomLogic.mergeReadings(got)
    }

    /**
     * Room Lab: listen for [seconds] seconds, asking for a new Wi-Fi scan every few seconds (Android may refuse some), and keep every
     * different Wi-Fi result. [onTick] says what has been heard so far, for the screen.
     */
    @SuppressLint("MissingPermission")
    suspend fun capture(ctx: Context, seconds: Int, withBle: Boolean, onTick: (String) -> Unit): Captured {
        val app = ctx.applicationContext
        val wm = app.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val sets = ArrayList<List<Hear>>()
        val end = System.currentTimeMillis() + seconds * 1000L
        var ble: List<Hear> = emptyList()
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) { if (wm != null) freshWifi(wm, 12_000).let { if (it.isNotEmpty()) sets.add(it) } }
        }
        try { app.registerReceiver(receiver, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION)) } catch (e: Exception) { }
        try {
            if (wm != null) freshWifi(wm, 8_000).let { if (it.isNotEmpty()) sets.add(it) }
            while (System.currentTimeMillis() < end) {
                @Suppress("DEPRECATION") try { wm?.startScan() } catch (e: Exception) { }
                val slice = minOf(5_000L, end - System.currentTimeMillis())
                if (withBle && hasBlePermission(app)) ble = RoomLogic.mergeReadings(ble + listenBle(app, slice)) else delay(slice)
                onTick("${((end - System.currentTimeMillis()) / 1000).coerceAtLeast(0)} s · Wi-Fi ${sets.lastOrNull()?.size ?: 0} · Bluetooth ${ble.size}")
            }
        } finally { try { app.unregisterReceiver(receiver) } catch (e: Exception) { } }
        return Captured(RoomLogic.buildScans(sets, ble), sets.lastOrNull()?.size ?: 0, ble.size)
    }

    /**
     * The scan sent with a normal check when Room location is on: the Wi-Fi results Android already has (if not older than 10 minutes)
     * and, only if the person allowed it, a 4 second Bluetooth listen. Null when there is nothing worth sending.
     * Auto-improve ([auto], on the home Wi-Fi): when those readings are older than 2 minutes, Android is asked for a new scan first (at most
     * every 10 minutes), and then only the new readings are sent, so the server may learn from them. The scan says how old its readings
     * are (`ageSec`): the server learns only from fresh ones.
     */
    suspend fun light(ctx: Context, withBle: Boolean, auto: Boolean = false): JSONObject? {
        val app = ctx.applicationContext
        if (!hasWifiPermission(app)) return null
        val wm = app.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val nowMicros = { SystemClock.elapsedRealtimeNanos() / 1000 }
        var readings = if (wm != null) wifiReadings(wm, 10 * 60_000L) else emptyList()
        if (wm != null && auto) {
            val prefs = Prefs(app)
            val now = System.currentTimeMillis()
            if (RoomLogic.autoScanDue(true, RoomLogic.ageSec(nowMicros(), readings.map { it.second }), now, prefs.autoScanAt)) {
                prefs.autoScanAt = now
                if (refresh(app, wm)) {
                    val fresh = wifiReadings(wm, RoomLogic.FRESH_SEC * 1000L)
                    if (RoomLogic.strongest(fresh.map { it.first }).size >= RoomLogic.MIN_HEARD) readings = fresh
                }
            } else {
                // readings already fresh: send only those, so the age the server sees is honest
                val fresh = readings.filter { nowMicros() - it.second <= RoomLogic.FRESH_SEC * 1_000_000L }
                if (RoomLogic.strongest(fresh.map { it.first }).size >= RoomLogic.MIN_HEARD) readings = fresh
            }
        }
        val wifi = readings.map { it.first }
        val ble = if (withBle && hasBlePermission(app)) listenBle(app, 4_000) else emptyList()
        if (!RoomLogic.heardEnough(wifi, ble)) return null
        return RoomLogic.withMeta(RoomLogic.scanJson(wifi, ble), RoomLogic.ageSec(nowMicros(), readings.map { it.second }), auto)
    }
}
