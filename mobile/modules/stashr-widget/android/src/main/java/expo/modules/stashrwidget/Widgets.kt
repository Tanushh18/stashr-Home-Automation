package expo.modules.stashrwidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/*
 * The other Stashr board widgets. Each draws from the snapshot the app saved (WidgetStore) and never calls the network itself.
 * A button that does something (scene, TV, camera) opens a signed stashr://action link: the app asks for the unlock, checks the
 * per-install key and only then calls the Stashr server, showing the server's real answer.
 * Request codes: Home 100, Scenes 200+, TV 300+, Quick 400+, Money 500, Network 600 (one per button, so taps never mix).
 */

private fun obj(o: JSONObject?, key: String): JSONObject? = o?.optJSONObject(key)
private fun str(o: JSONObject?, key: String, max: Int = 120): String = o?.optString(key, "")?.trim()?.take(max) ?: ""

/** Up to four scenes; one tap runs the scene through the app. */
class StashrScenesWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, views(context))
  }

  companion object {
    private val BUTTONS = intArrayOf(R.id.scene_0, R.id.scene_1, R.id.scene_2, R.id.scene_3)

    internal fun views(context: Context): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.stashr_scenes_widget)
      val o = WidgetStore.json(context)
      val scenes = o?.optJSONArray("scenes")
      val n = minOf(scenes?.length() ?: 0, BUTTONS.size)
      for (i in BUTTONS.indices) {
        val s = if (i < n) scenes?.optJSONObject(i) else null
        val id = str(s, "id", 60)
        val name = str(s, "name", 24)
        if (id.isEmpty() || name.isEmpty()) {
          v.setViewVisibility(BUTTONS[i], View.INVISIBLE)
          continue
        }
        v.setViewVisibility(BUTTONS[i], View.VISIBLE)
        v.setTextViewText(BUTTONS[i], name.uppercase())
        v.setOnClickPendingIntent(BUTTONS[i], Board.action(context, "do=scene&id=${Uri.encode(id)}", 200 + i))
      }
      v.setViewVisibility(R.id.scenes_row_0, if (n > 0) View.VISIBLE else View.GONE)
      v.setViewVisibility(R.id.scenes_row_1, if (n > 2) View.VISIBLE else View.GONE)
      v.setViewVisibility(R.id.scenes_empty, if (n == 0) View.VISIBLE else View.GONE)
      if (n == 0) v.setOnClickPendingIntent(R.id.widget_root, Board.link(context, "stashr://stashr-home", 209))
      Board.clock(context, v, R.id.widget_updated, o)
      return v
    }
  }
}

/** The living-room TV: its state and a small remote (the same commands as the website's remote). */
class StashrTvWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, views(context))
  }

  companion object {
    // button, label, the action query (type + argument) — the app accepts only these.
    private val KEYS = listOf(
      Triple(R.id.tv_play, "⏯", "type=media&a=play_pause"),
      Triple(R.id.tv_down, "VOL −", "type=volume&a=down"),
      Triple(R.id.tv_up, "VOL +", "type=volume&a=up"),
      Triple(R.id.tv_mute, "MUTE", "type=volume&a=mute"),
      Triple(R.id.tv_home, "HOME", "type=key&a=HOME")
    )

    internal fun views(context: Context): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.stashr_tv_widget)
      val o = WidgetStore.json(context)
      Board.row(v, R.id.row_tv, R.id.tv_state, str(o, "tv", 160).ifEmpty { "Open Stashr to load the TV" })
      KEYS.forEachIndexed { i, (button, label, query) ->
        v.setTextViewText(button, label)
        v.setOnClickPendingIntent(button, Board.action(context, "do=tv&$query", 300 + i))
      }
      Board.clock(context, v, R.id.widget_updated, o)
      return v
    }
  }
}

/** Shortcuts on the home screen: Ask Stashr, a camera photo, Money and Passwords. */
class StashrQuickWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, views(context))
  }

  companion object {
    internal fun views(context: Context): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.stashr_quick_widget)
      v.setTextViewText(R.id.quick_ask, "ASK STASHR")
      v.setOnClickPendingIntent(R.id.quick_ask, Board.link(context, "stashr://stashr-home", 400))
      v.setTextViewText(R.id.quick_camera, "CAMERA PHOTO")
      v.setOnClickPendingIntent(R.id.quick_camera, Board.action(context, "do=camera", 401))
      v.setTextViewText(R.id.quick_money, "MONEY")
      v.setOnClickPendingIntent(R.id.quick_money, Board.link(context, "stashr://money", 402))
      v.setTextViewText(R.id.quick_vault, "PASSWORDS")
      v.setOnClickPendingIntent(R.id.quick_vault, Board.link(context, "stashr:///", 403))
      Board.clock(context, v, R.id.widget_updated, WidgetStore.json(context))
      return v
    }
  }
}

/** What was spent: today, this month, the biggest category and how many entries still need a look. */
class StashrMoneyWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, views(context))
  }

  companion object {
    internal fun views(context: Context): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.stashr_money_widget)
      val o = WidgetStore.json(context)
      val m = obj(o, "money")
      Board.row(v, R.id.row_today, R.id.money_today, str(m, "today").ifEmpty { if (m == null) "Open Stashr → Money once" else "" })
      Board.row(v, R.id.row_month, R.id.money_month, str(m, "month"))
      Board.row(v, R.id.row_top, R.id.money_top, str(m, "top"))
      Board.row(v, R.id.row_check, R.id.money_check, str(m, "check"))
      v.setOnClickPendingIntent(R.id.widget_root, Board.link(context, "stashr://money", 500))
      Board.clock(context, v, R.id.widget_updated, if (m != null) o else null)
      return v
    }
  }
}

/** Internet speed, devices on the Wi-Fi and the health of the Stashr devices. */
class StashrNetWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, views(context))
  }

  companion object {
    internal fun views(context: Context): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.stashr_net_widget)
      val o = WidgetStore.json(context)
      val n = obj(o, "net")
      Board.row(v, R.id.row_speed, R.id.net_speed, str(n, "speed").ifEmpty { if (n == null) "Open Stashr to load the network" else "" })
      Board.row(v, R.id.row_wifi, R.id.net_wifi, str(n, "wifi"))
      Board.row(v, R.id.row_health, R.id.net_health, str(n, "health"))
      v.setOnClickPendingIntent(R.id.widget_root, Board.link(context, "stashr://home?tab=media", 600))
      Board.clock(context, v, R.id.widget_updated, if (n != null) o else null)
      return v
    }
  }
}
