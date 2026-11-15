package expo.modules.stashrwidget

import android.content.Context
import org.json.JSONObject

/**
 * The widget's text, saved by the app. Only display strings live here (who is home, who is coming, weather, TV);
 * never a token or anything from the vault.
 */
internal object WidgetStore {
  private const val PREFS = "stashr_home_widget"
  private const val KEY = "snapshot"

  fun save(context: Context, json: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
  }

  fun load(context: Context): Snapshot? {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return null
    return Snapshot.parse(raw)
  }
}

/** One snapshot. Every line is optional; an empty line is hidden. */
internal data class Snapshot(
  val coming: String,
  val people: String,
  val weather: String,
  val tv: String,
  val updatedAt: Long
) {
  companion object {
    private const val MAX = 160

    fun parse(raw: String): Snapshot? = try {
      val o = JSONObject(raw)
      fun s(k: String) = o.optString(k, "").trim().take(MAX)
      Snapshot(s("coming"), s("people"), s("weather"), s("tv"), o.optLong("updatedAt", 0L))
    } catch (e: Exception) {
      null
    }
  }
}
