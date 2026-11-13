package com.tanush.stashr.hub.core

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager

/** Power saving for the home tablet. Always on (plugged in or not) unless the switch on the dashboard is turned off. */
object Power {
    fun charging(ctx: Context): Boolean {
        val i = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return true
        val st = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        return st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL || i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
    }

    fun percent(ctx: Context): Int {
        val i = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return 100
        val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1); val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        return if (level >= 0 && scale > 0) level * 100 / scale else 100
    }

    /** Power saving is on (the default). It no longer depends on the charger. */
    fun saving(ctx: Context) = Prefs(ctx).batterySaver

    /**
     * How often the whole Wi-Fi is swept. On the charger: every 30 seconds (the power is free, so Stashr stays close to real time).
     * On the battery with power saving: every 3 minutes, every 5 at 20% or less. Power saving off: every round.
     */
    fun scanEveryMs(ctx: Context): Long = when {
        charging(ctx) -> 30_000L
        !saving(ctx) -> 0L
        percent(ctx) <= 20 -> 5 * 60_000L
        else -> 3 * 60_000L
    }

    /**
     * How long the tablet waits between two reports (they also fetch the commands from the website, so this is how fast a tap there arrives).
     * On the charger 10 s. Unplugged with more than 20% left 30 s, so the tablet stays online (and keeps sending WhatsApp messages) with a
     * wide margin; at 20% or less 60 s to save the last of the battery.
     */
    fun reportEveryMs(ctx: Context): Long = reportEveryMs(charging(ctx), percent(ctx))
    fun reportEveryMs(charging: Boolean, percent: Int): Long = when {
        charging -> 10_000L
        percent > 20 -> 30_000L
        else -> 60_000L
    }
}
