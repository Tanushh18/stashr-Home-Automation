package com.tanush.stashr.where

import com.tanush.stashr.where.core.Logic
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogicTest {
    @Test fun theServerCanStartAndStopTheRoomModelThroughAnAnswer() {
        assertEquals(true, Logic.parseAnswer(JSONObject("""{"state":"home","roomOn":true}""")).roomOn)
        assertEquals(false, Logic.parseAnswer(JSONObject("""{"state":"home","roomOn":false}""")).roomOn)
        assertNull(Logic.parseAnswer(JSONObject("""{"state":"home"}""")).roomOn)          // an older server says nothing: the phone keeps its own choice
        assertEquals(false, Logic.parseAnswer(JSONObject("""{"state":"home","roomAuto":false}""")).roomAuto)
        assertNull(Logic.parseAnswer(JSONObject("""{"state":"home"}""")).roomAuto)
    }

    @Test fun pushIsDroppedOnlyWhenTheServerWasJustCalled() {
        assertTrue(Logic.pushWorthIt(5 * 60_000, false))
        assertFalse(Logic.pushWorthIt(30_000, false))
        assertTrue(Logic.pushWorthIt(30_000, true))
        assertFalse(Logic.pushWorthIt(5_000, true))
    }

    @Test fun delayIsClamped() {
        assertEquals(900, Logic.clampDelay(null))
        assertEquals(900, Logic.clampDelay(0))
        assertEquals(60, Logic.clampDelay(5))
        assertEquals(300, Logic.clampDelay(300))
        assertEquals(1800, Logic.clampDelay(99999))
    }

    @Test fun liveDelayIsFiveToThirtySeconds() {
        assertEquals(8, Logic.clampDelay(null, true))
        assertEquals(8, Logic.clampDelay(0, true))
        assertEquals(5, Logic.clampDelay(1, true))
        assertEquals(8, Logic.clampDelay(8, true))
        assertEquals(30, Logic.clampDelay(600, true))
        // not live: the old 1 to 30 minutes
        assertEquals(60, Logic.clampDelay(8, false))
        assertEquals(900, Logic.clampDelay(null, false))
        assertEquals(1800, Logic.clampDelay(9999, false))
    }

    @Test fun preciseFlagIsParsed() {
        // near one of the family's places during an arrive/leave time the server asks for a real fix every check
        assertEquals(true, Logic.parseAnswer(JSONObject("""{"ok":true,"state":"away","precise":true,"nextCheckSec":180}""")).precise)
        assertEquals(false, Logic.parseAnswer(JSONObject("""{"ok":true,"state":"away","nextCheckSec":900}""")).precise)
        // an older server never sends it: that means no
        assertEquals(false, Logic.parseAnswer(JSONObject("""{"ok":true,"state":"home"}""")).precise)
    }

    @Test fun liveFlagIsParsed() {
        assertEquals(true, Logic.parseAnswer(JSONObject("""{"ok":true,"state":"coming","live":true,"nextCheckSec":8}""")).live)
        assertEquals(false, Logic.parseAnswer(JSONObject("""{"ok":true,"state":"home"}""")).live)
    }

    @Test fun answerIsParsed() {
        val a = Logic.parseAnswer(JSONObject("""{"ok":true,"state":"coming","distanceKm":12.4,"etaMinutes":25,"nextCheckSec":120,"home":{"set":true},"notices":[{"id":"n1","text":"Open the door"},{"id":"n2","text":" "}]}"""))
        assertEquals("coming", a.state); assertEquals(12.4, a.distanceKm!!, 0.001); assertEquals(25, a.etaMinutes); assertEquals(120, a.nextCheckSec)
        assertEquals(listOf("n1" to "Open the door"), a.notices); assertTrue(a.homeSet)
        val b = Logic.parseAnswer(JSONObject("""{"ok":true,"state":"unset","home":{"set":false}}"""))
        assertNull(b.distanceKm); assertNull(b.nextCheckSec); assertFalse(b.homeSet); assertTrue(b.notices.isEmpty())
    }

    @Test fun statusInFriendlyWords() {
        assertEquals("At home", Logic.statusText("home", 0.0, null))
        assertEquals("12.4 km from home · about 25 min away", Logic.statusText("coming", 12.4, 25))
        assertEquals("30.0 km from home", Logic.statusText("away", 30.0, null))
        assertEquals("Home location not set on Stashr yet", Logic.statusText("unset", null, null))
        assertEquals("2 h 5 min", Logic.minutes(125))
    }

    @Test fun passiveFixesNeedMovementAndTime() {
        assertTrue(Logic.passiveWorthUploading(500.0, 3 * 60_000))
        assertFalse(Logic.passiveWorthUploading(100.0, 10 * 60_000))
        assertFalse(Logic.passiveWorthUploading(900.0, 60_000))
        assertTrue(Logic.passiveWorthUploading(null, 3 * 60_000))
    }

    @Test fun distanceAndCode() {
        assertEquals(1112.0, Logic.distanceM(28.0, 77.0, 28.01, 77.0), 5.0)
        assertEquals("ABCD1234", Logic.cleanCode("abcd 1234 xyz"))
    }

    @Test fun sameCallRules() {
        val min = 60_000L
        // same access point, upload 3 h ago: still here
        assertTrue(Logic.shouldSendSame(true, 180 * min, null, false, 20 * min))
        // same access point but the last upload is 7 h old: take a real fix
        assertFalse(Logic.shouldSendSame(true, 7 * 60 * min, null, false, 20 * min))
        // live mode never says "same"
        assertFalse(Logic.shouldSendSame(true, 5 * min, 0.0, true, 1 * min))
        // different access point: only a near fix (<= 40 m) with a recent upload counts
        assertTrue(Logic.shouldSendSame(false, 10 * min, 25.0, false, 10 * min))
        assertFalse(Logic.shouldSendSame(false, 10 * min, 80.0, false, 10 * min))
        assertFalse(Logic.shouldSendSame(false, 30 * min, 10.0, false, 10 * min))
        // a real fix must go out at least every 25 minutes
        assertFalse(Logic.shouldSendSame(false, 15 * min, 10.0, false, 26 * min))
        // never uploaded: nothing to be "the same" as
        assertFalse(Logic.shouldSendSame(true, 0, null, false, 0))
    }

    @Test fun lowBatteryDoublesTheDelay() {
        assertEquals(1200, Logic.batteryDelay(15, false, false, 600))
        assertEquals(1800, Logic.batteryDelay(10, false, false, 1500))
        assertEquals(1200, Logic.batteryDelay(20, false, false, 600))      // 20% counts as low now
        assertEquals(600, Logic.batteryDelay(21, false, false, 600))
        assertEquals(600, Logic.batteryDelay(10, true, false, 600))     // charging
        assertEquals(8, Logic.batteryDelay(5, false, true, 8))           // live mode is left alone
        assertEquals(600, Logic.batteryDelay(-1, false, false, 600))     // unknown level
    }

    @Test fun nearATimedPlaceTheServerMayAskEvery30Seconds() {
        assertEquals(30, Logic.clampDelay(30, false, true))
        assertEquals(60, Logic.clampDelay(30, false, false))      // normally 60 seconds is the least
        assertEquals(30, Logic.clampDelay(5, false, true))
        assertEquals(8, Logic.clampDelay(null, true, true))       // live mode is unchanged
        assertEquals(Logic.DEFAULT_DELAY_SEC, Logic.clampDelay(null, false, true))
    }

    @Test fun lastLocationGoesOutOnceWhenTheBatteryIsLow() {
        assertEquals(true, Logic.finalFixDue(20, false, false, false))
        assertEquals(false, Logic.finalFixDue(20, false, false, true))      // already sent in this spell
        assertEquals(false, Logic.finalFixDue(21, false, false, false))
        assertEquals(false, Logic.finalFixDue(10, true, false, false))      // charging
        assertEquals(false, Logic.finalFixDue(10, false, true, false))      // live mode
        assertEquals(false, Logic.lowSpellOver(25, false))
        assertEquals(true, Logic.lowSpellOver(30, false))
        assertEquals(true, Logic.lowSpellOver(5, true))
    }

    @Test fun aWifiChangeAsksForAFixUnlessBatteryIsLowOrOneJustWentOut() {
        assertEquals(true, Logic.wifiTriggerWorthIt(60, false, 120_000))
        assertEquals(false, Logic.wifiTriggerWorthIt(60, false, 30_000))     // debounce: Wi-Fi flaps
        assertEquals(false, Logic.wifiTriggerWorthIt(15, false, 600_000))    // low battery
        assertEquals(true, Logic.wifiTriggerWorthIt(15, true, 600_000))      // charging
    }

    @Test fun bssidPlaceholdersAreIgnored() {
        assertEquals("", Logic.usableBssid(null))
        assertEquals("", Logic.usableBssid("02:00:00:00:00:00"))
        assertEquals("", Logic.usableBssid("00:00:00:00:00:00"))
        assertEquals("aa:bb:cc:dd:ee:ff", Logic.usableBssid(" AA:BB:CC:DD:EE:FF "))
    }
}
