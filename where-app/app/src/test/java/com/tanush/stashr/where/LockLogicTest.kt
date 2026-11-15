package com.tanush.stashr.where

import com.tanush.stashr.where.core.HealthLogic
import com.tanush.stashr.where.core.HealthLogic.Flags
import com.tanush.stashr.where.core.LockLogic
import com.tanush.stashr.where.core.LockLogic.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LockLogicTest {
    private val now = 1_800_000_000_000L

    @Test fun locksOnlyWhenLinkedAllowedAndFresh() {
        assertEquals(Verdict.LOCK, LockLogic.decide(true, true, now - 5_000, now))
        assertEquals(Verdict.LOCK, LockLogic.decide(true, true, 0, now))                       // unknown send time: fresh
        assertEquals(Verdict.LOCK, LockLogic.decide(true, true, now + 3_000, now))             // a slightly fast server clock is fine
    }

    @Test fun neverLocksWhenRemoteLockIsOff() {
        assertEquals(Verdict.ADMIN_OFF, LockLogic.decide(true, false, now - 1_000, now))
    }

    @Test fun neverLocksAPhoneThatIsNotLinked() {
        assertEquals(Verdict.NOT_LINKED, LockLogic.decide(false, true, now - 1_000, now))
        assertEquals(Verdict.NOT_LINKED, LockLogic.decide(false, false, now - 1_000, now))
    }

    @Test fun aRequestOlderThanTwoMinutesIsIgnored() {
        assertEquals(Verdict.LOCK, LockLogic.decide(true, true, now - LockLogic.MAX_AGE_MS, now))
        assertEquals(Verdict.STALE, LockLogic.decide(true, true, now - LockLogic.MAX_AGE_MS - 1, now))
        assertEquals(Verdict.STALE, LockLogic.decide(true, true, now - 3 * 3600_000L, now))   // sat in a queue while the phone was off
    }

    @Test fun onlyUsefulFailuresShowANotice() {
        assertNull(LockLogic.notice(Verdict.LOCK))
        assertNull(LockLogic.notice(Verdict.NOT_LINKED))
        assertNotNull(LockLogic.notice(Verdict.ADMIN_OFF))
        assertTrue(LockLogic.notice(Verdict.STALE)!!.contains("too late"))
    }

    @Test fun theHealthReportCarriesRemoteLockAndTheLastResult() {
        val j = HealthLogic.build("1.11.0", 1, 34, "CPH2579", null, Flags(remoteLock = true), "OPPO", HealthLogic.LastLock(1_000L, false, "admin_off"))
        assertTrue(j.getBoolean("remoteLock"))
        assertEquals(1_000L, j.getJSONObject("lastLock").getLong("at"))
        assertFalse(j.getJSONObject("lastLock").getBoolean("ok"))
        assertEquals("admin_off", j.getJSONObject("lastLock").getString("reason"))
        // never reported when nothing has been asked yet, and not-known stays out
        val quiet = HealthLogic.build("1.11.0", 1, 34, "m", null, Flags(), "", HealthLogic.LastLock(0, false, ""))
        assertFalse(quiet.has("lastLock"))
        assertFalse(quiet.has("remoteLock"))
    }
}
