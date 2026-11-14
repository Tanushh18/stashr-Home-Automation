package com.tanush.stashr.hub.whatsapp

/**
 * A person looks at a chat for a few seconds before pressing Send; a machine presses it the moment it appears. The tablet waits
 * on the open chat (or the picture's preview) for a pause Stashr picks for each message (3 to 12 seconds, never the same twice).
 */
object WaHuman {
    const val MAX_PAUSE_MS = 20_000L

    /** The pause Stashr chose for this message (held to 0..20 s), or 3 to 8 s at random when it sent none (an older Stashr). */
    fun pauseMs(given: Long, random: Double): Long =
        if (given >= 0) given.coerceIn(0L, MAX_PAUSE_MS) else 3_000L + (random.coerceIn(0.0, 1.0) * 5_000).toLong()

    /** True once the Send button has been on screen for the whole pause (`seenAt` is when it was first seen, 0 for not yet). */
    fun ready(seenAt: Long, now: Long, pauseMs: Long): Boolean = seenAt > 0 && now - seenAt >= pauseMs
}
