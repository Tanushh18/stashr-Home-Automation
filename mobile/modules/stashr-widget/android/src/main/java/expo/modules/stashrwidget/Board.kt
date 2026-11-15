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
import org.json.JSONObject
import java.util.Date

/** Shared pieces of the Stashr board widgets: opening links inside Stashr, signed actions, rows and the clock tile. */
internal object Board {
  val PROVIDERS: List<Class<out AppWidgetProvider>> = listOf(
    StashrHomeWidget::class.java, StashrPhonesWidget::class.java, StashrTvWidget::class.java,
    StashrQuickWidget::class.java, StashrMoneyWidget::class.java, StashrNetWidget::class.java
  )

  /** How many Stashr widgets of any kind are on the home screen. */
  fun total(context: Context): Int = PROVIDERS.sumOf { ids(context, it).size }

  fun ids(context: Context, cls: Class<out AppWidgetProvider>): IntArray =
    AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, cls))

  /** A tap that opens a stashr:// link in this app only. */
  fun link(context: Context, url: String, code: Int): PendingIntent {
    val open = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(context, code, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /** A tap that asks the app to do something (it unlocks first, checks the key, then calls the Stashr server). */
  fun action(context: Context, query: String, code: Int): PendingIntent =
    link(context, "stashr://action?$query&k=${WidgetStore.actionKey(context)}", code)

  fun row(v: RemoteViews, row: Int, id: Int, text: String) {
    v.setTextViewText(id, text)
    v.setViewVisibility(row, if (text.isEmpty()) View.GONE else View.VISIBLE)
  }

  fun clock(context: Context, v: RemoteViews, id: Int, o: JSONObject?) {
    val at = o?.optLong("updatedAt", 0L) ?: 0L
    v.setTextViewText(id, if (at > 0) DateFormat.getTimeFormat(context).format(Date(at)) else "--:--")
  }

  fun renderAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    for (cls in PROVIDERS) {
      val ids = ids(context, cls)
      if (ids.isEmpty()) continue
      val v = when (cls) {
        StashrHomeWidget::class.java -> StashrHomeWidget.views(context)
        StashrPhonesWidget::class.java -> StashrPhonesWidget.views(context)
        StashrTvWidget::class.java -> StashrTvWidget.views(context)
        StashrQuickWidget::class.java -> StashrQuickWidget.views(context)
        StashrMoneyWidget::class.java -> StashrMoneyWidget.views(context)
        else -> StashrNetWidget.views(context)
      }
      for (id in ids) manager.updateAppWidget(id, v)
    }
  }
}
