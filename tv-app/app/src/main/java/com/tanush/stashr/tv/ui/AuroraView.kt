package com.tanush.stashr.tv.ui

import android.animation.ArgbEvaluator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.view.View
import java.io.File
import kotlin.concurrent.thread

/**
 * The launcher's living background. With photos in the TV's backdrop folder it is a slow slideshow: each photo fades into
 * the next and drifts a little, a portrait photo stands in the middle over a blurred, enlarged copy of itself so nothing
 * is cropped. A dark veil keeps the apps readable. Without photos it is a drifting colour wash with soft glows.
 */
class AuroraView(ctx: Context) : View(ctx) {
    private val rnd0 = java.util.Random(11)
    private val palette = intArrayOf(0xFF08121A.toInt(), 0xFF0A2A33.toInt(), 0xFF0B4A47.toInt(), 0xFF0C2F4A.toInt(), 0xFF0A1F2E.toInt())   // the Stashr dark teal
    private val wash = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(palette[0], palette[1], palette[2]))
    private val eval = ArgbEvaluator()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val glows = listOf(
        Glow(0.20f, 0.30f, 0.36f, 0.00021f, 0.00017f, 0xFF2BB3B1.toInt()),   // Stashr accent
        Glow(0.80f, 0.25f, 0.30f, 0.00016f, 0.00023f, 0xFF0E7F6D.toInt()),   // Stashr primary
        Glow(0.55f, 0.85f, 0.38f, 0.00013f, 0.00019f, 0xFF3D7BFF.toInt()),
    )
    private var running = false
    /** What the weather is doing outside, from the server: the background plays it (rain streaks, drifting clouds, a warm sun glow). Null = nothing special. */
    var sky: WeatherIconView.Kind? = null
    /** The themed scene to play (jungle, snowfall, a festival…). */
    var scene: Scene = Scene.OFF
    private val art = SceneArt()
    private val drops = List(70) { Mote(rnd0.nextFloat(), rnd0.nextFloat(), 0.7f + rnd0.nextFloat() * 0.8f, 0f) }
    private val shield = android.graphics.Path()
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.WHITE }
    private val rnd = java.util.Random(7)
    private class Mote(val x: Float, val phase: Float, val speed: Float, val size: Float)
    private val motes = List(46) { Mote(rnd.nextFloat(), rnd.nextFloat(), 0.4f + rnd.nextFloat() * 0.9f, 1.5f + rnd.nextFloat() * 3.5f) }
    private val frame = object : Runnable { override fun run() { if (running) { invalidate(); postDelayed(this, 66) } } }

    private class Glow(val cx: Float, val cy: Float, val r: Float, val sx: Float, val sy: Float, val color: Int)
    private class Slide(val photo: Bitmap, val blur: Bitmap, val startedAt: Long)

    private val files: List<File> = ctx.getExternalFilesDir("backdrop")?.listFiles { f -> f.extension.lowercase() in setOf("jpg", "jpeg", "png", "webp") }?.sortedBy { it.name } ?: emptyList()
    private var order = files.shuffled()
    private var next = 0
    private var current: Slide? = null
    private var previous: Slide? = null
    @Volatile private var loading = false
    private var lastSwitch = 0L
    private val holdMs = 14_000L
    private val fadeMs = 2_500L

    override fun onAttachedToWindow() { super.onAttachedToWindow(); running = true; post(frame) }
    override fun onDetachedFromWindow() { running = false; current = null; previous = null; super.onDetachedFromWindow() }

    private fun at(x: Float): Int { val f = x % palette.size; val i = f.toInt(); return eval.evaluate(f - i, palette[i], palette[(i + 1) % palette.size]) as Int }

    private fun loadNext() {
        if (loading || order.isEmpty() || width == 0) return
        loading = true
        val file = order[next++ % order.size]
        val targetW = width; val targetH = height
        thread {
            try {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(file.path, bounds)
                var sample = 1
                while (bounds.outWidth / (sample * 2) >= targetW && bounds.outHeight / (sample * 2) >= targetH) sample *= 2
                val bmp = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
                if (bmp != null) {
                    val blur = Bitmap.createScaledBitmap(bmp, 32, maxOf(1, 32 * bmp.height / bmp.width), true)   // tiny, drawn big: a free blur
                    post { previous = current; current = Slide(bmp, blur, SystemClock.uptimeMillis()); lastSwitch = SystemClock.uptimeMillis(); loading = false }
                } else loading = false
            } catch (e: Throwable) { loading = false }
        }
    }

    private fun drawSlide(c: Canvas, s: Slide, alpha: Int, now: Long) {
        val w = width.toFloat(); val h = height.toFloat()
        val age = (now - s.startedAt).toFloat()
        val zoom = 1f + 0.06f * (age / (holdMs + fadeMs)).coerceAtMost(1.2f)   // a slow push-in
        paint.alpha = alpha
        // 1) the blurred copy fills the whole screen
        val br = maxOf(w / s.blur.width, h / s.blur.height)
        c.save(); c.scale(zoom, zoom, w / 2, h / 2)
        c.drawBitmap(s.blur, null, RectF((w - s.blur.width * br) / 2, (h - s.blur.height * br) / 2, (w + s.blur.width * br) / 2, (h + s.blur.height * br) / 2), paint)
        c.restore()
        // 2) the photo itself: whole when it is tall, filling the screen when it is wide
        val pw = s.photo.width.toFloat(); val ph = s.photo.height.toFloat()
        val tall = ph > pw * 1.05f
        val r = if (tall) minOf(h / ph, w / pw) else maxOf(w / pw, h / ph)
        c.save(); c.scale(zoom, zoom, w / 2, h / 2)
        c.drawBitmap(s.photo, null, RectF((w - pw * r) / 2, (h - ph * r) / 2, (w + pw * r) / 2, (h + ph * r) / 2), paint)
        c.restore()
        paint.alpha = 255
    }

    /** The Stashr look: a big house outline breathing slowly, rising dust that twinkles, and a soft light sweeping across. */
    private fun drawStashr(c: Canvas, t: Float, w: Float, h: Float) {
        val breathe = 0.5f + 0.5f * Math.sin(t / 2600.0).toFloat()
        val sw = h * 0.78f; val cx = w * 0.74f; val cy = h * 0.52f
        // a house outline: roof, walls and a door, the home that Stashr looks after
        shield.reset()
        shield.moveTo(cx - sw * 0.52f, cy - sw * 0.04f); shield.lineTo(cx, cy - sw * 0.5f); shield.lineTo(cx + sw * 0.52f, cy - sw * 0.04f)
        shield.moveTo(cx - sw * 0.38f, cy - sw * 0.16f); shield.lineTo(cx - sw * 0.38f, cy + sw * 0.46f); shield.lineTo(cx + sw * 0.38f, cy + sw * 0.46f); shield.lineTo(cx + sw * 0.38f, cy - sw * 0.16f)
        shield.moveTo(cx - sw * 0.10f, cy + sw * 0.46f); shield.lineTo(cx - sw * 0.10f, cy + sw * 0.14f); shield.lineTo(cx + sw * 0.10f, cy + sw * 0.14f); shield.lineTo(cx + sw * 0.10f, cy + sw * 0.46f)
        stroke.strokeWidth = h * 0.012f; stroke.alpha = (22 + 26 * breathe).toInt()
        c.drawPath(shield, stroke)
        c.save(); c.scale(0.86f, 0.86f, cx, cy); stroke.alpha = (12 + 16 * breathe).toInt(); c.drawPath(shield, stroke); c.restore()
        // rising dust
        paint.style = Paint.Style.FILL
        for (m in motes) {
            val rise = ((t / 1000f * 0.03f * m.speed) + m.phase) % 1f
            val x = w * m.x + 24f * Math.sin((t / 1800f * m.speed + m.phase * 6.28f).toDouble()).toFloat()
            val y = h * (1.05f - rise * 1.1f)
            val twinkle = 0.5f + 0.5f * Math.sin((t / 700f * m.speed + m.phase * 9f).toDouble()).toFloat()
            paint.color = Color.argb((60 + 120 * twinkle).toInt(), 160, 255, 245)
            c.drawCircle(x, y, m.size * (0.7f + 0.5f * twinkle), paint)
        }
        // light sweep
        val sweep = ((t / 9000f) % 1.6f) - 0.3f
        val sx = w * sweep
        paint.shader = android.graphics.LinearGradient(sx - w * 0.12f, 0f, sx + w * 0.12f, h * 0.35f, intArrayOf(Color.TRANSPARENT, Color.argb(26, 255, 255, 255), Color.TRANSPARENT), null, Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w, h, paint)
        paint.shader = null
        drawSky(c, t, w, h)
        art.draw(c, scene, t, w, h)
        // premium depth: a soft vignette darkens the corners so the middle glows
        paint.shader = RadialGradient(w / 2, h * 0.45f, maxOf(w, h) * 0.75f, intArrayOf(Color.TRANSPARENT, Color.TRANSPARENT, Color.argb(120, 2, 6, 12)), floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w, h, paint); paint.shader = null
        // keep the apps readable
        c.drawColor(Color.argb(60, 4, 10, 16))
    }

    /** Weather and time of day on top of the wash: rain falls, clouds drift, the sun glows by day and stars twinkle by night. */
    private fun drawSky(c: Canvas, t: Float, w: Float, h: Float) {
        val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        val night = hour >= 19 || hour < 6
        paint.style = Paint.Style.FILL
        when (sky) {
            WeatherIconView.Kind.RAIN -> {
                stroke.strokeCap = Paint.Cap.ROUND; stroke.strokeWidth = h * 0.0025f
                for (d in drops) {
                    val f = ((t / 1000f * 0.9f * d.speed) + d.phase) % 1f
                    val x = w * d.x - f * w * 0.03f; val y = h * (f * 1.15f - 0.05f)
                    stroke.alpha = (50 + 60 * d.speed / 1.5f).toInt()
                    c.drawLine(x, y, x - h * 0.006f, y + h * 0.035f, stroke)
                }
                stroke.alpha = 255
            }
            WeatherIconView.Kind.CLOUD -> {
                for (i in 0 until 3) {
                    val x = ((t / 1000f * (0.006f + 0.003f * i) + i * 0.37f) % 1.5f - 0.25f) * w
                    val y = h * (0.12f + 0.2f * i)
                    paint.shader = RadialGradient(x, y, h * (0.32f + 0.05f * i), Color.argb(34, 255, 255, 255), Color.TRANSPARENT, Shader.TileMode.CLAMP)
                    c.drawCircle(x, y, h * (0.32f + 0.05f * i), paint)
                    paint.shader = null
                }
            }
            WeatherIconView.Kind.SUN -> if (!night) {
                val pulse = 0.85f + 0.15f * Math.sin(t / 3000.0).toFloat()
                paint.shader = RadialGradient(w * 0.88f, h * 0.02f, h * 0.7f * pulse, Color.argb(60, 255, 201, 77), Color.TRANSPARENT, Shader.TileMode.CLAMP)
                c.drawCircle(w * 0.88f, h * 0.02f, h * 0.7f * pulse, paint)
                paint.shader = null
            }
            null -> {}
        }
        if (night && sky != WeatherIconView.Kind.RAIN) {
            for (m in motes.take(24)) {
                val tw = 0.5f + 0.5f * Math.sin((t / 900f * m.speed + m.phase * 12f).toDouble()).toFloat()
                paint.color = Color.argb((40 + 140 * tw).toInt(), 255, 255, 235)
                c.drawCircle(w * ((m.x * 7.3f) % 1f), h * ((m.phase * 3.7f) % 0.55f), m.size * 0.45f * (0.6f + tw), paint)
            }
        }
    }

    override fun onDraw(c: Canvas) {
        val now = SystemClock.uptimeMillis()
        val t = now.toFloat()
        val p = t / 20_000f
        wash.colors = intArrayOf(at(p), at(p + 1.7f), at(p + 3.4f))
        wash.setBounds(0, 0, width, height); wash.draw(c)
        val w = width.toFloat(); val h = height.toFloat(); val big = maxOf(w, h)
        val photos = order.isNotEmpty()
        if (photos && (current == null || now - lastSwitch > holdMs + fadeMs)) loadNext()
        if (photos) {
            val cur = current
            if (cur != null) {
                val f = ((now - cur.startedAt) / fadeMs.toFloat()).coerceIn(0f, 1f)
                previous?.let { if (f < 1f) drawSlide(c, it, 255, now) else previous = null }
                drawSlide(c, cur, (255 * f).toInt(), now)
            }
        }
        for (g in glows) {
            val x = w * (g.cx + 0.16f * Math.sin((t * g.sx * 6.28f).toDouble()).toFloat())
            val y = h * (g.cy + 0.16f * Math.cos((t * g.sy * 6.28f).toDouble()).toFloat())
            val r = big * g.r
            paint.shader = RadialGradient(x, y, r, Color.argb(if (photos) 38 else 70, Color.red(g.color), Color.green(g.color), Color.blue(g.color)), Color.TRANSPARENT, Shader.TileMode.CLAMP)
            c.drawCircle(x, y, r, paint)
            paint.shader = null
        }
        if (photos) c.drawColor(Color.argb(150, 6, 8, 20))
        else drawStashr(c, t, w, h)   // the dim veil: the photos stay soft behind the apps
    }
}
