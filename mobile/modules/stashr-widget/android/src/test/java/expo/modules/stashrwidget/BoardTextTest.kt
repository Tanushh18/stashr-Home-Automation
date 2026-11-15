package expo.modules.stashrwidget

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** The same cases as mobile/scripts/widgetText.test.mjs: the app's JavaScript and this copy must say the same words. */
class BoardTextTest {
  private fun arr(s: String) = JSONArray(s)
  private fun obj(s: String) = JSONObject(s)

  @Test fun comingMinutesArrivingCompanionsAndAtMostTwo() {
    assertEquals("Papa · 10 min", BoardText.comingLine(arr("""[{"person":"Papa","minutes":10}]""")))
    assertEquals("Mummy + Riya · arriving", BoardText.comingLine(arr("""[{"person":"Mummy","minutes":1,"with":["Riya"]}]""")))
    assertEquals("A · 5 min  B · 7 min", BoardText.comingLine(arr("""[{"person":"A","minutes":5},{"person":"B","minutes":7},{"person":"C","minutes":9}]""")))
    assertEquals("", BoardText.comingLine(arr("[]")))
    assertEquals("", BoardText.comingLine(null))
  }

  @Test fun peopleAllHomeNobodyMixedNone() {
    assertEquals("All in · Mummy, Papa", BoardText.peopleLine(arr("""[{"person":"Mummy","home":true},{"person":"Papa","home":true}]""")))
    assertEquals("Nobody · out: Tanush", BoardText.peopleLine(arr("""[{"person":"Tanush","home":false}]""")))
    assertEquals("Mummy · out: Tanush", BoardText.peopleLine(arr("""[{"person":"Mummy","home":true},{"person":"Tanush","home":false}]""")))
    assertEquals("", BoardText.peopleLine(null))
  }

  @Test fun weatherCityShortNameRangeAndRainOnlyWhenLikely() {
    assertEquals("Gurugram 31°C · clear ☀️ · 24–33°C", BoardText.weatherLine(obj("""{"city":"Gurugram, Haryana, India","temp":31.4,"text":"clear ☀️","min":24,"max":33,"rainChance":10}""")))
    assertEquals("28°C · rain 🌧️ · 22–30°C · ☔ 70%", BoardText.weatherLine(obj("""{"city":"","temp":28,"text":"rain 🌧️","min":22,"max":30,"rainChance":70}""")))
    assertEquals("", BoardText.weatherLine(null))
    assertEquals("", BoardText.weatherLine(obj("""{"city":"X"}""")))
  }

  @Test fun tvOffStandbyOnWithAppAndTitle() {
    assertEquals("Living room · off", BoardText.tvLine(arr("""[{"name":"Living room","online":false}]""")))
    assertEquals("Living room · standby", BoardText.tvLine(arr("""[{"name":"Living room","online":true,"screen":"off"}]""")))
    assertEquals("Living room · on · YouTube · Song", BoardText.tvLine(arr("""[{"name":"Living room","online":true,"screen":"on","app":"YouTube","title":"Song"}]""")))
    assertEquals("", BoardText.tvLine(arr("[]")))
  }

  @Test fun scenesAtMostFourOnlyRealIdsAndNames() {
    val s = BoardText.scenesOf(arr("""[{"id":"a","name":"Movie night"},{"id":"","name":"x"},{"id":"b","name":"Quiet"},{"id":"c","name":"Good night"},{"id":"d","name":"D"},{"id":"e","name":"E"}]"""))
    assertEquals(listOf("a", "b", "c", "d"), (0 until s.length()).map { s.getJSONObject(it).getString("id") })
    assertEquals(0, BoardText.scenesOf(null).length())
  }

  @Test fun phonesOnlyThoseWithRemoteLockOnNameBatteryBoltOnlineAtMostThree() {
    val a = "a".repeat(24)
    val r = BoardText.phonesOf(arr("""[{"id":"$a","name":"Tanush A38","online":true,"battery":87.4,"charging":true,"canLock":true},{"id":"${"b".repeat(24)}","name":"F21 Pro","online":false,"canLock":false},{"id":"${"c".repeat(24)}","name":"Tablet test","online":true,"battery":100},{"id":"${"d".repeat(24)}","name":"Second","online":false,"canLock":true},{"id":"${"e".repeat(24)}","name":"Third","online":true,"canLock":true},{"id":"${"f".repeat(24)}","name":"Fourth","online":true,"canLock":true}]"""))
    assertEquals(3, r.length())
    assertEquals("Tanush A38 · 87%⚡ · online", r.getJSONObject(0).getString("line"))
    assertEquals("Second · offline", r.getJSONObject(1).getString("line"))
    assertEquals("Third · online", r.getJSONObject(2).getString("line"))
    assertEquals(0, BoardText.phonesOf(arr("""[{"id":"${"b".repeat(24)}","name":"F21","online":true,"canLock":false}]""")).length())
    assertEquals(0, BoardText.phonesOf(null).length())
  }

  @Test fun speedLine() {
    assertEquals("92↓ 40↑ · 12 ms", BoardText.speedLine(obj("""{"down":92.4,"up":40.2,"ping":12}""")))
    assertEquals("", BoardText.speedLine(null))
  }

  @Test fun mergeKeepsMoneyAndRefreshesTheLiveLines() {
    val prev = obj("""{"money":{"today":"₹200"},"net":{"speed":"old","wifi":"3 devices on Wi-Fi","health":"All green"},"updatedAt":1}""")
    val dash = obj("""{"people":[{"person":"Papa","home":true}],"coming":[],"tvs":[{"name":"TV","online":false}],"weather":null,"scenes":[{"id":"m","name":"Movie"}],"speed":{"down":50,"up":10,"ping":9}}""")
    val out = BoardText.merge(dash, prev, 999L)
    assertEquals("All in · Papa", out.getString("people"))
    assertEquals("TV · off", out.getString("tv"))
    assertEquals(999L, out.getLong("updatedAt"))
    assertEquals("₹200", out.getJSONObject("money").getString("today"))                 // untouched
    assertEquals("50↓ 10↑ · 9 ms", out.getJSONObject("net").getString("speed"))          // refreshed
    assertEquals("3 devices on Wi-Fi", out.getJSONObject("net").getString("wifi"))       // untouched
  }

  @Test fun mergeDoesNotInventANetworkWidgetOrAnyData() {
    val out = BoardText.merge(obj("""{"people":[],"tvs":[]}"""), null, 5L)
    assertFalse(out.has("net"))
    assertFalse(out.has("money"))
    assertEquals("Give a Wi-Fi device a person in Smart home", out.getString("people"))
    assertEquals("", out.getString("tv"))
  }
}
