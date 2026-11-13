package com.tanush.stashr.tv.sync

/**
 * One movie's download as the website shows it: how much is here, when it began, how fast it goes and how it ended.
 * [status] is "waiting", "downloading", "done" or "failed". Times are epoch milliseconds, speeds are bytes per second.
 * While downloading, [speedBps] is the recent speed; once finished it is the average over the whole download.
 */
data class Transfer(
    val name: String,
    val size: Long,
    val status: String,
    val done: Long = 0,
    val startedAt: Long = 0,
    val finishedAt: Long = 0,
    val speedBps: Long = 0,
    val error: String = "",
    val fromBytes: Long = 0,      // where this try began (a resumed download does not start at 0)
    val markAt: Long = 0,         // last speed sample
    val markBytes: Long = 0,
) {
    val pct: Int get() = if (size <= 0) 0 else (done * 100 / size).toInt().coerceIn(0, 100)
}

/** The pure bookkeeping behind [Transfer] (no Android types, unit-tested): the newest transfers, kept short. */
class TransferLog(private val keep: Int = 15) {
    private val items = LinkedHashMap<String, Transfer>()

    @Synchronized fun snapshot(): List<Transfer> = items.values.toList()

    /** Brings back transfers saved before a restart: a try that was still running is shown as stopped. */
    @Synchronized fun restore(saved: List<Transfer>, now: Long) {
        items.clear()
        for (t in saved) when (t.status) {
            "done", "failed" -> items[t.name] = t
            "downloading" -> items[t.name] = t.copy(status = "failed", finishedAt = now, speedBps = 0, error = "Stopped before it finished; it continues on the next sync.")
        }
        prune()
    }

    /** A movie the sync is going to download. Does not touch one that is already downloading. */
    @Synchronized fun waiting(name: String, size: Long) {
        if (items[name]?.status == "downloading") return
        items.remove(name)
        items[name] = Transfer(name, size, "waiting")
    }

    @Synchronized fun start(name: String, size: Long, from: Long, now: Long) {
        items.remove(name)
        items[name] = Transfer(name, size, "downloading", done = from, startedAt = now, fromBytes = from, markAt = now, markBytes = from)
    }

    /** Bytes now on the storage. The speed is recomputed at most once a second and smoothed, so the figure does not jump. */
    @Synchronized fun progress(name: String, done: Long, now: Long) {
        val t = items[name] ?: return
        if (t.status != "downloading") return
        var next = t.copy(done = done)
        if (now - t.markAt >= 1000) {
            val inst = (done - t.markBytes) * 1000 / (now - t.markAt)
            val speed = if (t.speedBps <= 0) inst else (t.speedBps * 6 + inst * 4) / 10
            next = next.copy(speedBps = speed.coerceAtLeast(0), markAt = now, markBytes = done)
        }
        items[name] = next
    }

    @Synchronized fun finish(name: String, now: Long) {
        val t = items[name] ?: return
        val ms = (now - t.startedAt).coerceAtLeast(1)
        items[name] = t.copy(status = "done", done = t.size, finishedAt = now, speedBps = ((t.size - t.fromBytes).coerceAtLeast(0) * 1000 / ms), error = "")
        prune()
    }

    @Synchronized fun fail(name: String, size: Long, message: String, now: Long) {
        val t = items[name] ?: Transfer(name, size, "waiting")
        items[name] = t.copy(status = "failed", finishedAt = now, speedBps = 0, error = message.take(200))
        prune()
    }

    /** The sync is over: movies still waiting were not needed after all; one cut off in the middle is shown as stopped. */
    @Synchronized fun endSync(now: Long) {
        for (t in items.values.toList()) when (t.status) {
            "waiting" -> items.remove(t.name)
            "downloading" -> items[t.name] = t.copy(status = "failed", finishedAt = now, speedBps = 0, error = "Stopped before it finished; it continues on the next sync.")
        }
    }

    /** Active ones stay; of the finished ones only the newest [keep]. */
    private fun prune() {
        val finished = items.values.filter { it.status == "done" || it.status == "failed" }.sortedByDescending { it.finishedAt }
        for (old in finished.drop(keep)) items.remove(old.name)
    }
}
