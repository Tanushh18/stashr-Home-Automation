package expo.modules.stashrwidget

import org.json.JSONArray
import org.json.JSONObject

/**
 * The widget lines, worked out natively from GET /home/widget/dashboard so the phone can refresh the widgets every 15 seconds
 * without starting the app's JavaScript. A line-for-line copy of src/lib/widgetText.js (the app uses that one); the tests
 * (BoardTextTest) check the same cases, so the two never drift apart. No Android classes here, so it runs as a plain unit test.
 */
internal object BoardText {
  private fun clean(v: String?): String = (v ?: "").replace(Regex("\\s+"), " ").trim()
  private fun num(o: JSONObject?, k: String): Double? = if (o != null && o.has(k) && !o.isNull(k)) o.optDouble(k).takeIf { !it.isNaN() } else null
  private fun rows(a: JSONArray?, key: String): List<JSONObject> =
    (0 until (a?.length() ?: 0)).mapNotNull { a?.optJSONObject(it) }.filter { clean(it.optString(key, "")).isNotEmpty() }
  private fun round(d: Double): Long = Math.round(d)

  /** "Papa · 10 min", "Papa · arriving" (a minute or less), at most two people. */
  fun comingLine(a: JSONArray?): String {
    val list = rows(a, "person")
    if (list.isEmpty()) return ""
    return list.take(2).joinToString("  ") { c ->
      val with = (0 until (c.optJSONArray("with")?.length() ?: 0)).map { clean(c.optJSONArray("with")?.optString(it)) }.filter { it.isNotEmpty() }
      val who = (listOf(clean(c.optString("person"))) + with).joinToString(" + ")
      val m = num(c, "minutes")
      if (m == null || m <= 1) "$who · arriving" else "$who · ${round(m)} min"
    }
  }

  /** "Mummy, Papa · out: Tanush" */
  fun peopleLine(a: JSONArray?): String {
    val list = rows(a, "person")
    if (list.isEmpty()) return ""
    val home = list.filter { it.optBoolean("home") }.map { clean(it.optString("person")) }
    val out = list.filter { !it.optBoolean("home") }.map { clean(it.optString("person")) }
    return when {
      out.isEmpty() -> "All in · ${home.joinToString(", ")}"
      home.isEmpty() -> "Nobody · out: ${out.joinToString(", ")}"
      else -> "${home.joinToString(", ")} · out: ${out.joinToString(", ")}"
    }
  }

  /** "Gurugram 31°C · clear ☀️ · 24–33°C · ☔ 60%" (rain only when it is likely). */
  fun weatherLine(w: JSONObject?): String {
    val temp = num(w, "temp") ?: return ""
    val city = clean(w?.optString("city", "")).split(",")[0].trim()
    val parts = mutableListOf("${if (city.isNotEmpty()) "$city " else ""}${round(temp)}°C")
    val text = clean(w?.optString("text", ""))
    if (text.isNotEmpty()) parts.add(text)
    val min = num(w, "min"); val max = num(w, "max")
    if (min != null && max != null) parts.add("${round(min)}–${round(max)}°C")
    val rain = num(w, "rainChance")
    if (rain != null && rain >= 40) parts.add("☔ ${round(rain)}%")
    return parts.joinToString(" · ")
  }

  /** "Living room · on · YouTube" for the first TV. */
  fun tvLine(a: JSONArray?): String {
    val t = a?.optJSONObject(0) ?: return ""
    val name = clean(t.optString("name", "")).ifEmpty { "TV" }
    val state = when {
      !t.optBoolean("online") -> "off"
      t.optString("screen") == "off" -> "standby"
      else -> listOf("on", clean(t.optString("app", "")), clean(t.optString("title", ""))).filter { it.isNotEmpty() }.joinToString(" · ")
    }
    return "$name · $state"
  }

  /** "92↓ 40↑ · 12 ms", or "" when there is no speed test. */
  fun speedLine(s: JSONObject?): String {
    val down = num(s, "down") ?: return ""
    return "${round(down)}↓ ${round(num(s, "up") ?: 0.0)}↑ · ${round(num(s, "ping") ?: 0.0)} ms"
  }

  /** The phones for the Phones widget (only those with Remote lock on): [{ id, line, canLock }], at most three. "Tanush A38 · 87%⚡ · online". */
  fun phonesOf(a: JSONArray?): JSONArray {
    val out = JSONArray()
    for (i in 0 until (a?.length() ?: 0)) {
      val p = a?.optJSONObject(i) ?: continue
      val id = clean(p.optString("id", ""))
      val name = clean(p.optString("name", ""))
      // only phones that have Remote lock switched on are listed
      if (id.isEmpty() || name.isEmpty() || out.length() >= 3 || !p.optBoolean("canLock")) continue
      val bat = num(p, "battery")
      val parts = mutableListOf(name.take(16))
      if (bat != null) parts.add("${round(bat)}%${if (p.optBoolean("charging")) "⚡" else ""}")
      parts.add(if (p.optBoolean("online")) "online" else "offline")
      out.put(JSONObject().put("id", id).put("line", parts.joinToString(" · ")).put("canLock", p.optBoolean("canLock")))
    }
    return out
  }

  /** Up to four scenes: [{ id, name }]. */
  fun scenesOf(a: JSONArray?): JSONArray {
    val out = JSONArray()
    for (s in rows(a, "name")) {
      val id = clean(s.optString("id", ""))
      if (id.isEmpty() || out.length() >= 4) continue
      out.put(JSONObject().put("id", id.take(60)).put("name", clean(s.optString("name")).take(24)))
    }
    return out
  }

  /**
   * The new snapshot: the dashboard's lines on top of what the app saved before (Money and the Wi-Fi / health lines of the
   * Network widget stay as the app last loaded them; only its speed line is refreshed here).
   */
  fun merge(dash: JSONObject, prev: JSONObject?, now: Long): JSONObject {
    val out = JSONObject(prev?.toString() ?: "{}")
    out.put("coming", comingLine(dash.optJSONArray("coming")))
    out.put("people", peopleLine(dash.optJSONArray("people")).ifEmpty { "Give a Wi-Fi device a person in Smart home" })
    out.put("weather", weatherLine(dash.optJSONObject("weather")))
    out.put("tv", tvLine(dash.optJSONArray("tvs")))
    out.put("scenes", scenesOf(dash.optJSONArray("scenes")))
    out.put("phones", phonesOf(dash.optJSONArray("phones")))
    out.put("updatedAt", now)
    val net = out.optJSONObject("net")
    val speed = speedLine(dash.optJSONObject("speed"))
    if (net != null) out.put("net", JSONObject(net.toString()).put("speed", speed.ifEmpty { "No speed test yet" }))
    return out
  }
}
