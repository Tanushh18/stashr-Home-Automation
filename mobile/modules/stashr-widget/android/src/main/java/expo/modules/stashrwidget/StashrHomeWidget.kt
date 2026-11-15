package expo.modules.stashrwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.format.DateFormat
import android.view.View
import android.widget.RemoteViews
import java.util.Date

/** Draws the "Stashr Home" widget from the saved snapshot. A tap opens Smart home in the app (the app asks for the unlock first). */
class StashrHomeWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, views(context))
  }

  companion object {
    fun ids(context: Context): IntArray =
      AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, StashrHomeWidget::class.java))

    fun renderAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val v = views(context)
      for (id in ids(context)) manager.updateAppWidget(id, v)
    }

    /** One board row: its value, and the whole row (label + value) hidden when there is nothing to say. */
    private fun line(v: RemoteViews, row: Int, id: Int, text: String) {
      v.setTextViewText(id, text)
      v.setViewVisibility(row, if (text.isEmpty()) View.GONE else View.VISIBLE)
    }

    internal fun views(context: Context): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.stashr_home_widget)
      val s = WidgetStore.load(context)
      if (s == null) {
        line(v, R.id.row_coming, R.id.widget_coming, "")
        line(v, R.id.row_people, R.id.widget_people, "Open Stashr to load your home")
        line(v, R.id.row_weather, R.id.widget_weather, "")
        line(v, R.id.row_tv, R.id.widget_tv, "")
        v.setTextViewText(R.id.widget_updated, "--:--")
      } else {
        line(v, R.id.row_coming, R.id.widget_coming, s.coming)
        line(v, R.id.row_people, R.id.widget_people, s.people.ifEmpty { "Open Stashr to load your home" })
        line(v, R.id.row_weather, R.id.widget_weather, s.weather)
        line(v, R.id.row_tv, R.id.widget_tv, s.tv)
        v.setTextViewText(R.id.widget_updated, if (s.updatedAt > 0) DateFormat.getTimeFormat(context).format(Date(s.updatedAt)) else "--:--")
      }
      val open = Intent(Intent.ACTION_VIEW, Uri.parse("stashr://home")).setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      val pending = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      v.setOnClickPendingIntent(R.id.widget_root, pending)
      return v
    }
  }
}
