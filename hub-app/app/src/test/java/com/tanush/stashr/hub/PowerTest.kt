package com.tanush.stashr.hub

import com.tanush.stashr.hub.core.Power
import org.junit.Assert.assertEquals
import org.junit.Test

class PowerTest {
    @Test fun reportsOftenOnTheChargerAndEveryHalfMinuteOnBatteryAboveTwentyPercent() {
        assertEquals(10_000L, Power.reportEveryMs(true, 5))
        assertEquals(10_000L, Power.reportEveryMs(true, 100))
        assertEquals(30_000L, Power.reportEveryMs(false, 21))
        assertEquals(30_000L, Power.reportEveryMs(false, 90))
    }

    @Test fun slowsDownOnlyAtTwentyPercentOrLessOnBattery() {
        assertEquals(60_000L, Power.reportEveryMs(false, 20))
        assertEquals(60_000L, Power.reportEveryMs(false, 3))
    }
}
