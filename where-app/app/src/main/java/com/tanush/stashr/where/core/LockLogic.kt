package com.tanush.stashr.where.core

/**
 * The remote-lock decision, with no Android in it so it can be tested. A lock request arrives by Firebase push; the phone locks only
 * when (1) it is linked to Stashr, (2) its owner switched Remote lock on (Android "device admin", lock-screen policy only) and
 * (3) the request is fresh: a push that sat in a queue while the phone was off must not lock it minutes later.
 */
object LockLogic {
    const val MAX_AGE_MS = 120_000L

    enum class Verdict(val reason: String) { LOCK("ok"), NOT_LINKED("not_linked"), ADMIN_OFF("admin_off"), STALE("stale") }

    /** [sentAtMs] is when Firebase says the message was sent (0 = unknown, treated as fresh). */
    fun decide(linked: Boolean, adminActive: Boolean, sentAtMs: Long, nowMs: Long): Verdict = when {
        !linked -> Verdict.NOT_LINKED
        sentAtMs > 0 && nowMs - sentAtMs > MAX_AGE_MS -> Verdict.STALE
        !adminActive -> Verdict.ADMIN_OFF
        else -> Verdict.LOCK
    }

    /** The phone's own words for the notification when a request could not be carried out. */
    fun notice(v: Verdict): String? = when (v) {
        Verdict.ADMIN_OFF -> "Someone asked to lock this phone, but Remote lock is off. Open Stashr Location and switch it on."
        Verdict.STALE -> "A request to lock this phone arrived too late (over 2 minutes) and was ignored."
        else -> null
    }
}
