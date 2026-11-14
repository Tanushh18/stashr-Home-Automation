package com.tanush.stashr.hub

import com.tanush.stashr.hub.whatsapp.WaHuman
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WaHumanTest {
    @Test fun thePauseStashrChoseIsUsedWithinTwentySeconds() {
        assertEquals(7_345L, WaHuman.pauseMs(7_345L, 0.5))
        assertEquals(0L, WaHuman.pauseMs(0L, 0.5))
        assertEquals(20_000L, WaHuman.pauseMs(90_000L, 0.5))
    }

    @Test fun withoutOneTheTabletPicksThreeToEightSeconds() {
        assertEquals(3_000L, WaHuman.pauseMs(-1L, 0.0))
        assertEquals(8_000L, WaHuman.pauseMs(-1L, 1.0))
        assertEquals(5_500L, WaHuman.pauseMs(-1L, 0.5))
    }

    @Test fun sendIsPressedOnlyAfterTheButtonWasOnScreenForThePause() {
        assertFalse(WaHuman.ready(0L, 10_000L, 3_000L))           // not seen yet
        assertFalse(WaHuman.ready(10_000L, 12_999L, 3_000L))
        assertTrue(WaHuman.ready(10_000L, 13_000L, 3_000L))
    }
}
