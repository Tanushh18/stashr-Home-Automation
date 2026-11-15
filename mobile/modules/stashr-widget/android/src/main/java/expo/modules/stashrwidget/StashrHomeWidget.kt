package expo.modules.stashrwidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews

/** Draws the "Stashr Home" widget from the saved snapshot. A tap opens Smart home in the app (the app asks for the unlock first). */
class StashrHomeWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, views(context))
  }

  companion object {
    fun ids(context: Context): IntArray = Board.ids(context, StashrHomeWidget::class.java)

    internal fun views(context: Context): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.stashr_home_widget)
      val o = WidgetStore.json(context)
      val s = o?.let { Snapshot.of(it) }
      Board.row(v, R.id.row_coming, R.id.widget_coming, s?.coming ?: "")
      Board.row(v, R.id.row_people, R.id.widget_people, s?.people?.ifEmpty { null } ?: "Open Stashr to load your home")
      Board.row(v, R.id.row_weather, R.id.widget_weather, s?.weather ?: "")
      Board.row(v, R.id.row_tv, R.id.widget_tv, s?.tv ?: "")
      Board.clock(context, v, R.id.widget_updated, o)
      // the world behind the board: follows the clock and the weather; redrawn only when the look changes
      v.setImageViewBitmap(R.id.scenery, Scenery.bitmap(java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY), s?.weather ?: ""))
      v.setOnClickPendingIntent(R.id.widget_root, Board.link(context, "stashr://stashr-home", 100))
      return v
    }
  }
}
