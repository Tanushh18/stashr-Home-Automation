package expo.modules.stashrwidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray

class StashrWidgetModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun icon(name: String): Int = when (name) {
    "tv" -> R.drawable.stashr_sc_tv
    "camera" -> R.drawable.stashr_sc_camera
    "money" -> R.drawable.stashr_sc_money
    "key" -> R.drawable.stashr_sc_key
    else -> R.drawable.stashr_sc_home
  }

  override fun definition() = ModuleDefinition {
    Name("StashrWidget")

    // Saves the widget text (a small JSON of display strings) and redraws every Stashr Home widget.
    Function("setSnapshot") { json: String ->
      WidgetStore.save(context, json)
      StashrHomeWidget.renderAll(context)
    }

    // How many Stashr Home widgets are on the home screen (0 = skip the background refresh).
    Function("widgetCount") {
      StashrHomeWidget.ids(context).size
    }

    // Asks the launcher to place the widget (Android 8+, launchers that support it). Returns false when it cannot.
    Function("requestPin") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      val manager = AppWidgetManager.getInstance(context)
      if (!manager.isRequestPinAppWidgetSupported) return@Function false
      manager.requestPinAppWidget(ComponentName(context, StashrHomeWidget::class.java), null, null)
    }

    // Long-press shortcuts on the Stashr icon: [{ id, label, url, icon }]. Each opens a stashr:// link inside this app only.
    Function("setShortcuts") { json: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) return@Function false
      val manager = context.getSystemService(ShortcutManager::class.java) ?: return@Function false
      val list = JSONArray(json)
      val max = manager.maxShortcutCountPerActivity
      val shortcuts = (0 until minOf(list.length(), max)).map { i ->
        val o = list.getJSONObject(i)
        val url = o.getString("url")
        require(url.startsWith("stashr://")) { "Shortcuts only open stashr:// links." }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        ShortcutInfo.Builder(context, o.getString("id"))
          .setShortLabel(o.getString("label").take(24))
          .setLongLabel(o.optString("long", o.getString("label")).take(40))
          .setIcon(Icon.createWithResource(context, icon(o.optString("icon"))))
          .setRank(i)
          .setIntent(intent)
          .build()
      }
      manager.dynamicShortcuts = shortcuts
      true
    }
  }
}
