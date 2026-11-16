package com.tanush.stashr.tv.ui

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Shader
import java.util.Calendar
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** Themed live backgrounds for the home screen. Drawn by AuroraView on top of the wash, under the apps. */
enum class Scene(val label: String) {
    OFF("Plain"), SKY("Sun, Moon & Satellite"), JUNGLE("Jungle"), WATERFALL("Waterfall"), ROADS("Roads"), PEOPLE("People"), SNOW("Snowfall"), DIWALI("Diwali"), HOLI("Holi"), CHRISTMAS("Christmas"), TRICOLOR("Tiranga");

    companion object {
        /** What "auto" picks today: the festival if it is one, snow when it is cold or snowing, else the sun and moon crossing the sky. */
        fun auto(now: Calendar, tempC: Int?, weatherText: String?): Scene {
            val m = now.get(Calendar.MONTH) + 1; val d = now.get(Calendar.DAY_OF_MONTH); val y = now.get(Calendar.YEAR)
            fun between(m1: Int, d1: Int, m2: Int, d2: Int) = (m * 100 + d) in (m1 * 100 + d1)..(m2 * 100 + d2)
            return when {
                between(1, 24, 1, 26) || between(8, 13, 8, 15) -> TRICOLOR
                between(12, 20, 12, 26) || between(12, 30, 12, 31) || between(1, 1, 1, 2) -> CHRISTMAS
                // Diwali and Holi move every year: the main days for the next few years.
                (y == 2026 && between(11, 6, 11, 9)) || (y == 2027 && between(10, 28, 11, 1)) || (y == 2028 && between(10, 16, 10, 19)) -> DIWALI
                (y == 2027 && between(3, 21, 3, 23)) || (y == 2028 && between(3, 10, 3, 12)) || (y == 2029 && between(2, 27, 3, 1)) -> HOLI
                weatherText?.contains("snow", true) == true || (tempC != null && tempC <= 8) -> SNOW
                else -> SKY
            }
        }
    }
}

/** Draws one [Scene]. Holds its own particles so every frame is just maths and a few draw calls. */
class SceneArt {
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val leaf = Path()
    private val rnd = java.util.Random(23)
    private class P(val x: Float, val ph: Float, val sp: Float, val sz: Float, val c: Int)
    private val flakes = List(90) { P(rnd.nextFloat(), rnd.nextFloat(), 0.4f + rnd.nextFloat(), 1.5f + rnd.nextFloat() * 4f, 0) }
    private val flies = List(34) { P(rnd.nextFloat(), rnd.nextFloat(), 0.3f + rnd.nextFloat(), 2f + rnd.nextFloat() * 3f, 0) }
    private val holiColors = intArrayOf(0xFFFF4D8D.toInt(), 0xFFFFC94D.toInt(), 0xFF4DD2FF.toInt(), 0xFF7CFF6B.toInt(), 0xFFB26BFF.toInt(), 0xFFFF8A3D.toInt())
    private val blobs = List(26) { P(rnd.nextFloat(), rnd.nextFloat(), 0.3f + rnd.nextFloat() * 0.7f, 40f + rnd.nextFloat() * 120f, holiColors[rnd.nextInt(holiColors.size)]) }
    private val lightColors = intArrayOf(0xFFFF5252.toInt(), 0xFFFFD740.toInt(), 0xFF69F0AE.toInt(), 0xFF40C4FF.toInt())

    fun draw(c: Canvas, scene: Scene, t: Float, w: Float, h: Float) {
        when (scene) {
            Scene.OFF -> {}
            Scene.SKY -> sky(c, t, w, h)
            Scene.WATERFALL -> waterfall(c, t, w, h)
            Scene.ROADS -> roads(c, t, w, h)
            Scene.PEOPLE -> people(c, t, w, h)
            Scene.SNOW -> { cold(c, w, h); snow(c, t, w, h) }
            Scene.JUNGLE -> jungle(c, t, w, h)
            Scene.DIWALI -> diwali(c, t, w, h)
            Scene.HOLI -> holi(c, t, w, h)
            Scene.CHRISTMAS -> { snow(c, t, w, h); stringLights(c, t, w, h, 0.0f) }
            Scene.TRICOLOR -> tricolor(c, t, w, h)
        }
    }

    private fun cold(c: Canvas, w: Float, h: Float) { fill.shader = null; fill.color = Color.argb(34, 120, 170, 255); c.drawRect(0f, 0f, w, h, fill) }

    private fun snow(c: Canvas, t: Float, w: Float, h: Float) {
        fill.shader = null
        for (f in flakes) {
            val fall = ((t / 1000f * 0.045f * f.sp) + f.ph) % 1f
            val x = w * f.x + sin((t / 1500f * f.sp + f.ph * 6.28f).toDouble()).toFloat() * 26f
            val y = h * (fall * 1.1f - 0.05f)
            fill.color = Color.argb((120 + 110 * f.sp / 1.4f).toInt().coerceAtMost(235), 255, 255, 255)
            c.drawCircle(x, y, f.sz * (0.6f + 0.4f * f.sp), fill)
        }
        // a soft drift of snow along the bottom
        fill.shader = android.graphics.LinearGradient(0f, h * 0.93f, 0f, h, Color.TRANSPARENT, Color.argb(70, 235, 245, 255), Shader.TileMode.CLAMP)
        c.drawRect(0f, h * 0.93f, w, h, fill); fill.shader = null
    }

    private fun jungle(c: Canvas, t: Float, w: Float, h: Float) {
        // green canopy light and a low mist
        fill.shader = android.graphics.LinearGradient(0f, 0f, 0f, h, Color.argb(70, 10, 90, 40), Color.argb(40, 0, 40, 25), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w, h, fill); fill.shader = null
        val mist = 0.5f + 0.5f * sin((t / 4000f).toDouble()).toFloat()
        fill.shader = RadialGradient(w * 0.3f, h * 0.9f, w * 0.5f, Color.argb((30 + 30 * mist).toInt(), 200, 255, 220), Color.TRANSPARENT, Shader.TileMode.CLAMP)
        c.drawRect(0f, h * 0.5f, w, h, fill); fill.shader = null
        // big leaves hanging from the top corners, swaying
        for (i in 0 until 7) {
            val left = i % 2 == 0
            val bx = if (left) w * (0.00f + 0.035f * i) else w * (1.0f - 0.03f * i)
            val sway = sin((t / 2200f + i * 1.3f).toDouble()).toFloat() * 0.12f
            c.save(); c.translate(bx, -h * 0.02f); c.rotate((if (left) 18f else -18f) + sway * 57f + i * (if (left) 6f else -6f))
            val len = h * (0.28f + 0.05f * (i % 3))
            leaf.reset(); leaf.moveTo(0f, 0f); leaf.quadTo(len * 0.22f, len * 0.5f, 0f, len); leaf.quadTo(-len * 0.22f, len * 0.5f, 0f, 0f)
            fill.color = Color.argb(150, 20 + i * 6, 120 + i * 8, 50); c.drawPath(leaf, fill)
            line.color = Color.argb(110, 180, 255, 190); line.strokeWidth = 2.5f; c.drawLine(0f, 0f, 0f, len * 0.95f, line)
            c.restore()
        }
        // fireflies
        for (f in flies) {
            val x = w * ((f.x + 0.04f * sin((t / 3000f * f.sp + f.ph * 9f).toDouble()).toFloat()) % 1f)
            val y = h * (0.25f + 0.7f * ((f.ph + 0.05f * sin((t / 2500f * f.sp + f.x * 7f).toDouble()).toFloat()) % 1f))
            val glow = (0.5f + 0.5f * sin((t / 600f * f.sp + f.ph * 12f).toDouble()).toFloat())
            fill.shader = RadialGradient(x, y, f.sz * 7f, Color.argb((150 * glow).toInt(), 220, 255, 120), Color.TRANSPARENT, Shader.TileMode.CLAMP)
            c.drawCircle(x, y, f.sz * 7f, fill); fill.shader = null
            fill.color = Color.argb((120 + 120 * glow).toInt(), 245, 255, 170); c.drawCircle(x, y, f.sz * 0.6f, fill)
        }
    }

    private fun diwali(c: Canvas, t: Float, w: Float, h: Float) {
        // warm glow from the bottom, diyas flickering along it
        fill.shader = android.graphics.LinearGradient(0f, h * 0.6f, 0f, h, Color.TRANSPARENT, Color.argb(60, 255, 150, 40), Shader.TileMode.CLAMP)
        c.drawRect(0f, h * 0.6f, w, h, fill); fill.shader = null
        for (i in 0 until 9) {
            val x = w * (0.06f + 0.11f * i); val y = h * 0.965f
            val fl = 0.75f + 0.25f * sin((t / 140f + i * 2.1f).toDouble()).toFloat() * sin((t / 330f + i).toDouble()).toFloat()
            fill.shader = RadialGradient(x, y - 8f, 70f * fl, Color.argb((150 * fl).toInt(), 255, 190, 70), Color.TRANSPARENT, Shader.TileMode.CLAMP)
            c.drawCircle(x, y - 8f, 70f * fl, fill); fill.shader = null
            fill.color = Color.argb(235, 255, 214, 100); c.drawOval(x - 9f, y - 24f * fl, x + 9f, y - 2f, fill)
        }
        stringLights(c, t, w, h, 0.5f)
        // fireworks: a burst every few seconds from three spots
        for (k in 0 until 3) {
            val cycle = 5200f + k * 900f
            val ph = ((t + k * 1700f) % cycle) / cycle
            if (ph > 0.55f) continue
            val e = ph / 0.55f
            val cx = w * (0.25f + 0.25f * k) + 40f * sin((t / 9000f + k).toDouble()).toFloat(); val cy = h * (0.22f + 0.05f * k)
            val col = intArrayOf(0xFFFFC94D.toInt(), 0xFFFF6E6E.toInt(), 0xFF7CFFB0.toInt())[k]
            for (i in 0 until 22) {
                val a = (i / 22f * 2 * PI).toFloat(); val r = h * 0.20f * (1f - (1f - e) * (1f - e))
                val px = cx + cos(a.toDouble()).toFloat() * r; val py = cy + sin(a.toDouble()).toFloat() * r + h * 0.05f * e * e
                fill.color = (col and 0x00FFFFFF) or ((235 * (1f - e)).toInt() shl 24); c.drawCircle(px, py, 4f * (1f - e * 0.6f), fill)
            }
        }
    }

    private fun holi(c: Canvas, t: Float, w: Float, h: Float) {
        for (b in blobs) {
            val x = w * ((b.x + 0.03f * sin((t / 4000f * b.sp + b.ph * 8f).toDouble()).toFloat()) % 1f)
            val y = h * (((b.ph - t / 1000f * 0.012f * b.sp) % 1f + 1f) % 1f)
            val pulse = 0.8f + 0.2f * sin((t / 1500f * b.sp + b.ph * 6f).toDouble()).toFloat()
            fill.shader = RadialGradient(x, y, b.sz * pulse, (b.c and 0x00FFFFFF) or (70 shl 24), Color.TRANSPARENT, Shader.TileMode.CLAMP)
            c.drawCircle(x, y, b.sz * pulse, fill); fill.shader = null
        }
    }

    private fun stringLights(c: Canvas, t: Float, w: Float, h: Float, tintBias: Float) {
        line.color = Color.argb(90, 40, 40, 40); line.strokeWidth = 2f
        val n = 22
        leaf.reset()
        for (i in 0..n) { val x = w * i / n; val y = h * 0.012f + h * 0.03f * sin((i * PI / 2).toDouble()).toFloat().let { it * it }; if (i == 0) leaf.moveTo(x, y) else leaf.lineTo(x, y) }
        c.drawPath(leaf, line)
        for (i in 0..n) {
            val x = w * i / n; val y = h * 0.012f + h * 0.03f * sin((i * PI / 2).toDouble()).toFloat().let { it * it } + 6f
            val on = 0.55f + 0.45f * sin((t / 450f + i * 1.7f).toDouble()).toFloat()
            val col = lightColors[(i + (tintBias * 3).toInt()) % lightColors.size]
            fill.shader = RadialGradient(x, y, 20f, (col and 0x00FFFFFF) or ((160 * on).toInt() shl 24), Color.TRANSPARENT, Shader.TileMode.CLAMP)
            c.drawCircle(x, y, 20f, fill); fill.shader = null
            fill.color = (col and 0x00FFFFFF) or ((140 + 115 * on).toInt() shl 24); c.drawCircle(x, y, 5.5f, fill)
        }
    }

    private fun tricolor(c: Canvas, t: Float, w: Float, h: Float) {
        val colors = intArrayOf(0xFFFF9933.toInt(), 0xFFFFFFFF.toInt(), 0xFF138808.toInt())
        for (i in 0 until 3) {
            val y = h * (0.12f + 0.3f * i)
            val shift = sin((t / 3500f + i * 1.2f).toDouble()).toFloat() * h * 0.05f
            fill.shader = android.graphics.LinearGradient(0f, y - h * 0.18f + shift, 0f, y + h * 0.18f + shift, Color.TRANSPARENT, (colors[i] and 0x00FFFFFF) or (42 shl 24), Shader.TileMode.MIRROR)
            c.drawRect(0f, 0f, w, h, fill); fill.shader = null
        }
        // a slowly turning Ashoka-chakra style wheel
        val cx = w * 0.74f; val cy = h * 0.52f; val r = h * 0.2f
        line.color = Color.argb(34, 30, 80, 200); line.strokeWidth = 3f
        c.drawCircle(cx, cy, r, line)
        for (i in 0 until 24) {
            val a = (i / 24.0 * 2 * PI) + t / 9000.0
            c.drawLine(cx + cos(a).toFloat() * r * 0.15f, cy + sin(a).toFloat() * r * 0.15f, cx + cos(a).toFloat() * r, cy + sin(a).toFloat() * r, line)
        }
    }

    // ───────── sun, moon and a satellite ─────────

    private fun sky(c: Canvas, t: Float, w: Float, h: Float) {
        val now = Calendar.getInstance()
        val hour = now.get(Calendar.HOUR_OF_DAY) + now.get(Calendar.MINUTE) / 60f
        val day = hour in 6f..18f
        if (day) {
            // the sun climbs and sets along an arc across the sky
            val f = (hour - 6f) / 12f
            val x = w * (0.08f + 0.84f * f); val y = h * (0.52f - 0.42f * sin(f * PI).toFloat())
            val warm = 1f - sin(f * PI).toFloat()          // redder near sunrise and sunset
            val r = h * 0.07f
            fill.shader = RadialGradient(x, y, r * 5f, Color.argb(80, 255, (200 - 70 * warm).toInt(), (90 - 50 * warm).toInt()), Color.TRANSPARENT, Shader.TileMode.CLAMP)
            c.drawCircle(x, y, r * 5f, fill); fill.shader = null
            fill.color = Color.argb(235, 255, (214 - 60 * warm).toInt(), (110 - 40 * warm).toInt()); c.drawCircle(x, y, r, fill)
            line.color = Color.argb(120, 255, 220, 130); line.strokeWidth = r * 0.12f
            for (i in 0 until 12) { val a = (i / 12.0 * 2 * PI) + t / 7000.0; c.drawLine(x + cos(a).toFloat() * r * 1.35f, y + sin(a).toFloat() * r * 1.35f, x + cos(a).toFloat() * r * (1.7f + 0.15f * sin((t / 600f + i).toDouble()).toFloat()), y + sin(a).toFloat() * r * (1.7f + 0.15f * sin((t / 600f + i).toDouble()).toFloat()), line) }
        } else {
            val nf = if (hour >= 18f) (hour - 18f) / 12f else (hour + 6f) / 12f
            val x = w * (0.08f + 0.84f * nf); val y = h * (0.5f - 0.40f * sin(nf * PI).toFloat())
            val r = h * 0.055f
            fill.shader = RadialGradient(x, y, r * 4.5f, Color.argb(60, 200, 220, 255), Color.TRANSPARENT, Shader.TileMode.CLAMP)
            c.drawCircle(x, y, r * 4.5f, fill); fill.shader = null
            // the real phase of the moon today (29.53 day cycle from a known new moon)
            val days = (System.currentTimeMillis() - 947182440000L) / 86_400_000.0
            val phase = (((days % 29.530588) + 29.530588) % 29.530588 / 29.530588).toFloat()   // 0 new, 0.5 full
            val disc = Path().apply { addCircle(x, y, r, Path.Direction.CW) }
            fill.color = Color.argb(240, 238, 242, 255); c.drawPath(disc, fill)
            val shadowShift = (phase * 2f - (if (phase < 0.5f) 0f else 2f)) * r * 2f   // slides the dark disc across the bright one
            val dark = Path().apply { addCircle(x + (if (phase < 0.5f) -shadowShift else -shadowShift), y, r, Path.Direction.CW) }
            val lit = Path(disc).apply { op(dark, Path.Op.DIFFERENCE) }
            fill.color = Color.argb(150, 6, 12, 24); c.drawPath(disc, fill)
            fill.color = Color.argb(240, 238, 242, 255); c.drawPath(lit, fill)
            // a satellite: a steady dot with a fading trail, crossing the sky every ~45 s, and a blink as it turns
            val cyc = 45_000f; val ph = (t % cyc) / cyc
            if (ph < 0.5f) {
                val e = ph / 0.5f
                val sx = w * (-0.05f + 1.1f * e); val sy = h * (0.12f + 0.18f * sin(e * PI).toFloat() * -1f + 0.2f * e)
                for (k in 0 until 14) {
                    val ke = (e - k * 0.006f).coerceAtLeast(0f)
                    fill.color = Color.argb((150 * (1f - k / 14f)).toInt(), 255, 255, 255)
                    c.drawCircle(w * (-0.05f + 1.1f * ke), h * (0.12f - 0.18f * sin(ke * PI).toFloat() + 0.2f * ke), 2.5f * (1f - k / 18f), fill)
                }
                val blink = 0.6f + 0.4f * sin((t / 260f).toDouble()).toFloat()
                fill.shader = RadialGradient(sx, sy, 16f, Color.argb((200 * blink).toInt(), 255, 255, 255), Color.TRANSPARENT, Shader.TileMode.CLAMP)
                c.drawCircle(sx, sy, 16f, fill); fill.shader = null
                fill.color = Color.WHITE; c.drawRect(sx - 6f, sy - 1.5f, sx + 6f, sy + 1.5f, fill); c.drawRect(sx - 1.5f, sy - 3.5f, sx + 1.5f, sy + 3.5f, fill)
            }
        }
    }

    // ───────── waterfall ─────────

    private fun waterfall(c: Canvas, t: Float, w: Float, h: Float) {
        fill.shader = android.graphics.LinearGradient(0f, 0f, 0f, h, Color.argb(30, 20, 90, 110), Color.argb(70, 10, 70, 90), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w, h, fill); fill.shader = null
        val left = w * 0.60f; val right = w * 0.92f; val top = h * 0.0f; val base = h * 0.93f
        // dark cliff edges either side of the falls
        fill.color = Color.argb(70, 8, 30, 30); c.drawRect(left - w * 0.05f, top, left, base, fill); c.drawRect(right, top, right + w * 0.05f, base, fill)
        line.strokeCap = Paint.Cap.BUTT
        for (i in 0 until 26) {
            val x = left + (right - left) * (i / 25f) + 5f * sin((t / 1300f + i).toDouble()).toFloat()
            val speed = 0.55f + 0.4f * ((i * 37) % 10) / 10f
            line.strokeWidth = (3f + (i % 4) * 2.2f)
            val seg = h * 0.22f
            val off = ((t / 1000f * speed * h * 0.9f) + i * 53f) % (seg * 2f)
            var y = top - seg * 2f + off
            while (y < base) {
                val y0 = y.coerceIn(top, base); val y1 = (y + seg).coerceIn(top, base)
                if (y1 > y0) { line.color = Color.argb(70 + (i % 3) * 22, 225, 245, 255); c.drawLine(x, y0, x, y1, line) }
                y += seg * 2f
            }
        }
        // mist rising where the water lands, and a few droplets leaping
        val m = 0.6f + 0.4f * sin((t / 1400f).toDouble()).toFloat()
        fill.shader = RadialGradient((left + right) / 2, base, (right - left) * 0.75f, Color.argb((90 * m).toInt(), 230, 250, 255), Color.TRANSPARENT, Shader.TileMode.CLAMP)
        c.drawCircle((left + right) / 2, base, (right - left) * 0.75f, fill); fill.shader = null
        for (k in 0 until 18) {
            val f = ((t / 1000f * 0.5f) + k * 0.137f) % 1f
            val x = left + (right - left) * ((k * 0.61f) % 1f) + (f - 0.5f) * 60f
            val y = base - sin(f * PI).toFloat() * h * 0.10f
            fill.color = Color.argb((190 * (1f - f)).toInt(), 235, 250, 255); c.drawCircle(x, y, 2.8f, fill)
        }
    }

    // ───────── roads: a night highway ─────────

    private fun roads(c: Canvas, t: Float, w: Float, h: Float) {
        val vx = w * 0.5f; val vy = h * 0.50f
        val road = Path().apply { moveTo(vx - 6f, vy); lineTo(vx + 6f, vy); lineTo(w * 1.05f, h); lineTo(-w * 0.05f, h); close() }
        fill.shader = android.graphics.LinearGradient(0f, vy, 0f, h, Color.argb(10, 20, 30, 50), Color.argb(95, 12, 18, 30), Shader.TileMode.CLAMP)
        c.drawPath(road, fill); fill.shader = null
        // dashed centre line racing toward you
        line.strokeCap = Paint.Cap.ROUND; line.color = Color.argb(150, 255, 214, 120)
        for (i in 0 until 14) {
            val z = ((t / 1000f * 0.35f) + i / 14f) % 1f
            val k = z * z
            val y = vy + (h - vy) * k; val len = 6f + 46f * k
            line.strokeWidth = 1.5f + 7f * k
            c.drawLine(vx, y, vx + (if (true) 0f else 0f), y + len, line)
        }
        // cars: warm headlights coming (right lane), red tail lights going away (left lane)
        for (i in 0 until 7) {
            val coming = i % 2 == 0
            val z = ((t / 1000f * (0.16f + 0.05f * (i % 3))) + i * 0.143f) % 1f
            val k = if (coming) z * z else 1f - (1f - z) * (1f - z)
            val y = vy + (h - vy) * (if (coming) k else 1f - k * 0.9f).coerceIn(0f, 1f)
            val lane = if (coming) 0.22f else -0.22f
            val x = vx + (w * 0.56f) * lane * ((y - vy) / (h - vy)) * 1.9f
            val size = 3f + 20f * (y - vy) / (h - vy)
            val col = if (coming) intArrayOf(255, 244, 200) else intArrayOf(255, 70, 70)
            for (side in intArrayOf(-1, 1)) {
                val px = x + side * size * 1.4f
                fill.shader = RadialGradient(px, y, size * 3.2f, Color.argb(150, col[0], col[1], col[2]), Color.TRANSPARENT, Shader.TileMode.CLAMP)
                c.drawCircle(px, y, size * 3.2f, fill); fill.shader = null
                fill.color = Color.argb(240, col[0], col[1], col[2]); c.drawCircle(px, y, size * 0.5f, fill)
            }
        }
        // street lamps along the sides
        for (i in 0 until 8) {
            val z = ((t / 1000f * 0.3f) + i / 8f) % 1f; val k = z * z
            val y = vy + (h - vy) * k; val off = 14f + (w * 0.5f) * k
            for (side in intArrayOf(-1, 1)) {
                val lx = vx + side * off; val ly = y - (10f + 120f * k)
                fill.shader = RadialGradient(lx, ly, 10f + 50f * k, Color.argb(120, 255, 220, 140), Color.TRANSPARENT, Shader.TileMode.CLAMP)
                c.drawCircle(lx, ly, 10f + 50f * k, fill); fill.shader = null
            }
        }
    }

    // ───────── people walking by ─────────

    private val walkers = List(8) { P(rnd.nextFloat(), rnd.nextFloat(), 0.5f + rnd.nextFloat(), 0.6f + rnd.nextFloat() * 0.8f, 0) }
    private fun people(c: Canvas, t: Float, w: Float, h: Float) {
        // a soft ground line to walk on
        fill.shader = android.graphics.LinearGradient(0f, h * 0.9f, 0f, h, Color.TRANSPARENT, Color.argb(60, 255, 255, 255), Shader.TileMode.CLAMP)
        c.drawRect(0f, h * 0.9f, w, h, fill); fill.shader = null
        for ((idx, p) in walkers.withIndex()) {
            val dirRight = idx % 2 == 0
            val travel = ((t / 1000f * 0.018f * p.sp) + p.x) % 1f
            val x = if (dirRight) w * (-0.05f + 1.1f * travel) else w * (1.05f - 1.1f * travel)
            val sc = p.sz; val base = h * (0.965f - 0.012f * (idx % 3)); val u = h * 0.052f * sc
            val step = sin((t / 1000f * 5.5f * p.sp + p.ph * 6f).toDouble()).toFloat()
            val bob = kotlin.math.abs(step) * u * 0.05f
            val col = intArrayOf(0xFF1E2A3A.toInt(), 0xFF2C3E50.toInt(), 0xFF33475B.toInt())[idx % 3]
            line.strokeCap = Paint.Cap.ROUND; line.color = (col and 0x00FFFFFF) or (150 shl 24); line.strokeWidth = u * 0.22f
            fill.color = (col and 0x00FFFFFF) or (160 shl 24)
            val hip = base - u * 1.0f - bob; val sh = hip - u * 0.95f
            c.drawLine(x, hip, x + step * u * 0.45f, base, line); c.drawLine(x, hip, x - step * u * 0.45f, base, line)     // legs
            c.drawLine(x, hip, x, sh, line)                                                                                     // body
            c.drawLine(x, sh + u * 0.1f, x - step * u * 0.4f, hip - u * 0.2f, line); c.drawLine(x, sh + u * 0.1f, x + step * u * 0.4f, hip - u * 0.2f, line)   // arms
            c.drawCircle(x, sh - u * 0.28f, u * 0.28f, fill)                                                                  // head
        }
    }
}
