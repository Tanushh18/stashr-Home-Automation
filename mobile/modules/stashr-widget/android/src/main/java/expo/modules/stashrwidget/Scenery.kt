package expo.modules.stashrwidget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import java.util.Random

/**
 * The Stashr world behind the Home widget: a jungle ridge, a river and a waterfall under a sky that follows the clock (dawn, day,
 * dusk, night with stars and a moon) and the weather (clouds, rain). It is drawn ONCE per look and cached, so between changes it
 * costs nothing: no animation loop, no timer. A dark veil keeps the text on top easy to read.
 */
internal object Scenery {
  enum class Time { DAWN, DAY, DUSK, NIGHT }
  enum class Sky { CLEAR, CLOUDY, RAIN }

  fun timeOf(hour: Int): Time = when (hour) { in 5..6 -> Time.DAWN; in 7..16 -> Time.DAY; in 17..18 -> Time.DUSK; else -> Time.NIGHT }

  /** From the weather line ("Gurugram 27°C · rain 🌧️ · 18–27°C · ☔ 70%"). */
  fun skyOf(weather: String): Sky {
    val w = weather.lowercase()
    return when {
      Regex("rain|drizzle|storm|thunder|shower|snow|☔").containsMatchIn(w) -> Sky.RAIN
      Regex("cloud|overcast|fog|mist|haze").containsMatchIn(w) -> Sky.CLOUDY
      else -> Sky.CLEAR
    }
  }

  private var cachedKey = ""
  private var cached: Bitmap? = null

  /** The picture for this hour and weather; the same bitmap is reused until the look changes. */
  @Synchronized fun bitmap(hour: Int, weather: String): Bitmap {
    val t = timeOf(hour); val s = skyOf(weather)
    val key = "$t/$s"
    cached?.let { if (key == cachedKey) return it }
    val b = draw(t, s)
    cached = b; cachedKey = key
    return b
  }

  private const val W = 560
  private const val H = 280

  private fun skyColors(t: Time): IntArray = when (t) {
    Time.DAWN -> intArrayOf(0xFF2B3A67.toInt(), 0xFFE08E79.toInt())
    Time.DAY -> intArrayOf(0xFF1E6FA8.toInt(), 0xFF8EC9E8.toInt())
    Time.DUSK -> intArrayOf(0xFF3B2A5E.toInt(), 0xFFE0875A.toInt())
    Time.NIGHT -> intArrayOf(0xFF050B18.toInt(), 0xFF12263F.toInt())
  }

  fun draw(t: Time, s: Sky): Bitmap {
    val bmp = Bitmap.createBitmap(W, H, Bitmap.Config.RGB_565)
    val c = Canvas(bmp)
    val p = Paint(Paint.ANTI_ALIAS_FLAG)
    val rnd = Random(42)   // the same trees every time

    // sky
    val sky = skyColors(t)
    p.shader = LinearGradient(0f, 0f, 0f, H * 0.75f, if (s == Sky.CLEAR) sky[0] else dim(sky[0], 0.8f), if (s == Sky.CLEAR) sky[1] else dim(sky[1], 0.75f), Shader.TileMode.CLAMP)
    c.drawRect(0f, 0f, W.toFloat(), H.toFloat(), p); p.shader = null

    // stars, moon, sun
    if (t == Time.NIGHT && s != Sky.RAIN) {
      p.color = 0xFFF2F0E6.toInt()
      for (i in 0 until 38) { p.alpha = 90 + rnd.nextInt(150); c.drawCircle(rnd.nextInt(W).toFloat(), rnd.nextInt((H * 0.55f).toInt()).toFloat(), 1f + rnd.nextInt(2) * 0.6f, p) }
      p.alpha = 255; p.color = 0xFFF5E9B8.toInt(); c.drawCircle(W * 0.82f, H * 0.2f, 20f, p)
      p.color = 0xFF0B1A2E.toInt(); c.drawCircle(W * 0.82f + 9f, H * 0.2f - 5f, 17f, p)          // a crescent
    } else if (t != Time.NIGHT && s == Sky.CLEAR) {
      p.color = if (t == Time.DAY) 0xFFFFE9A0.toInt() else 0xFFFFC27A.toInt()
      c.drawCircle(W * (if (t == Time.DAWN) 0.18f else if (t == Time.DUSK) 0.84f else 0.78f), H * (if (t == Time.DAY) 0.2f else 0.4f), 22f, p)
    }

    // clouds
    if (s != Sky.CLEAR) {
      p.color = if (t == Time.NIGHT) 0xFF1B2A3F.toInt() else 0xFFB9C4CF.toInt()
      for (i in 0 until 5) { val x = 40f + i * 110f + rnd.nextInt(30); val y = 26f + rnd.nextInt(60); p.alpha = 190
        c.drawOval(x, y, x + 120f, y + 34f, p); c.drawOval(x + 24f, y - 14f, x + 92f, y + 22f, p) }
      p.alpha = 255
    }

    // far and near jungle ridges
    ridge(c, p, rnd, H * 0.62f, 34f, if (t == Time.NIGHT) 0xFF0B2A22.toInt() else 0xFF15614A.toInt())
    ridge(c, p, rnd, H * 0.72f, 44f, if (t == Time.NIGHT) 0xFF06170F.toInt() else 0xFF0B3D2C.toInt())

    // waterfall coming off the near ridge, and the river below
    p.color = if (t == Time.NIGHT) 0x889FD4E8.toInt() else 0xCCCDEEFA.toInt()
    c.drawRect(W * 0.66f, H * 0.62f, W * 0.66f + 12f, H * 0.82f, p)
    c.drawRect(W * 0.66f - 4f, H * 0.62f, W * 0.66f - 1f, H * 0.80f, p)
    p.shader = LinearGradient(0f, H * 0.82f, 0f, H.toFloat(), if (t == Time.NIGHT) 0xFF0A2B3F.toInt() else 0xFF1B8FA0.toInt(), if (t == Time.NIGHT) 0xFF061A26.toInt() else 0xFF0E5E70.toInt(), Shader.TileMode.CLAMP)
    c.drawRect(0f, H * 0.82f, W.toFloat(), H.toFloat(), p); p.shader = null
    p.color = 0x66FFFFFF; p.strokeWidth = 2f; p.style = Paint.Style.STROKE
    for (row in 0 until 3) { val y = H * 0.86f + row * 14f; val path = Path(); path.moveTo(0f, y)
      var x = 0f; while (x < W) { path.quadTo(x + 14f, y - 4f, x + 28f, y); x += 28f }; c.drawPath(path, p) }
    p.style = Paint.Style.FILL

    // rain
    if (s == Sky.RAIN) { p.color = 0x99C8E2F0.toInt(); p.strokeWidth = 1.5f
      for (i in 0 until 90) { val x = rnd.nextInt(W).toFloat(); val y = rnd.nextInt((H * 0.82f).toInt()).toFloat(); c.drawLine(x, y, x - 5f, y + 14f, p) } }

    // the veil that keeps the text readable
    p.shader = LinearGradient(0f, 0f, 0f, H.toFloat(), 0xB0060F14.toInt(), 0xD0060F14.toInt(), Shader.TileMode.CLAMP)
    c.drawRect(0f, 0f, W.toFloat(), H.toFloat(), p)
    return bmp
  }

  private fun dim(color: Int, f: Float): Int = (0xFF shl 24) or (((color shr 16 and 0xFF) * f).toInt() shl 16) or (((color shr 8 and 0xFF) * f).toInt() shl 8) or ((color and 0xFF) * f).toInt()

  /** A ridge of rounded tree-tops across the width. */
  private fun ridge(c: Canvas, p: Paint, rnd: Random, base: Float, tall: Float, color: Int) {
    p.color = color
    val path = Path(); path.moveTo(0f, H.toFloat())
    var x = 0f
    path.lineTo(0f, base)
    while (x < W) {
      val w = 22f + rnd.nextInt(26); val h = base - tall * (0.4f + rnd.nextFloat() * 0.6f)
      path.quadTo(x + w / 2, h, x + w, base - rnd.nextInt(8)); x += w
    }
    path.lineTo(W.toFloat(), H.toFloat()); path.close()
    c.drawPath(path, p)
  }
}
