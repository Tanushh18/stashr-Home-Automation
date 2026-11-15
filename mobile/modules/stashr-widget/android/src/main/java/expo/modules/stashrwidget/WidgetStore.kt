package expo.modules.stashrwidget

import android.content.Context
import org.json.JSONObject
import java.security.SecureRandom

/**
 * What the widgets show, saved by the app. Only display strings and scene ids live here (who is home, weather, TV state,
 * money totals, speed…); never a token, a password or anything from the vault.
 */
internal object WidgetStore {
  private const val PREFS = "stashr_home_widget"
  private const val KEY = "snapshot"
  private const val ACTION_KEY = "action_key"

  fun save(context: Context, json: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
  }

  fun json(context: Context): JSONObject? = try {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)?.let { JSONObject(it) }
  } catch (e: Exception) {
    null
  }

  fun load(context: Context): Snapshot? = json(context)?.let { Snapshot.of(it) }

  // ── the 15-second live refresh: a read-only widget key (GET /home/widget/dashboard only) and the server list ──
  fun setLive(context: Context, key: String, serversJson: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("live_key", key).putString("live_servers", serversJson).putBoolean("live_bad", false).apply()
  }
  fun setLiveServers(context: Context, serversJson: String) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("live_servers", serversJson).apply() }
  fun liveKey(context: Context): String = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("live_key", "") ?: ""
  fun liveServers(context: Context): List<String> = try {
    val a = org.json.JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("live_servers", "[]"))
    (0 until a.length()).map { a.getString(it) }.filter { it.startsWith("https://") }
  } catch (e: Exception) { emptyList() }
  /** The server said the key is not allowed (removed): stop asking until the app makes a new one. */
  fun markKeyBad(context: Context) { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("live_bad", true).apply() }
  fun keyBad(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("live_bad", false)

  /**
   * A random secret made once per install. Every widget button carries it, and the app only runs a widget action when the
   * link has it, so another app cannot fire your TV, camera or scenes through a stashr:// link.
   */
  fun actionKey(context: Context): String {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    prefs.getString(ACTION_KEY, null)?.let { return it }
    val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
    val key = bytes.joinToString("") { "%02x".format(it) }
    prefs.edit().putString(ACTION_KEY, key).apply()
    return key
  }
}

/** The Stashr Home board. Every line is optional; an empty line hides its row. */
internal data class Snapshot(
  val coming: String,
  val people: String,
  val weather: String,
  val tv: String,
  val updatedAt: Long
) {
  companion object {
    private const val MAX = 160

    fun of(o: JSONObject): Snapshot {
      fun s(k: String) = o.optString(k, "").trim().take(MAX)
      return Snapshot(s("coming"), s("people"), s("weather"), s("tv"), o.optLong("updatedAt", 0L))
    }
  }
}
