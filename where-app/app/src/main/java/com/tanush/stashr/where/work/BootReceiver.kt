package com.tanush.stashr.where.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a restart, an update or a watchdog alarm the schedule and the always-on service are set up again; a linked phone stays linked. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) { Scheduler.start(ctx); StatusService.sync(ctx) }
}
