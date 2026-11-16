package com.tanush.stashr.tv.ui

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.cos
import kotlin.math.sin

/** Small self-animating views for the launcher home. Each one only runs while it is attached to a window, so nothing ticks in the background. */

/** A weather picture that moves: sun with turning rays, a cloud drifting, or rain falling. [kind] is chosen from the server's weather text. */
class WeatherIconView(ctx: Context) : View(ctx) {
    enum class Kind { SUN, CLOUD, RAIN }
    var kind = Kind.SUN
        set(v) { field = v; invalidate() }
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private var t = 0f
    private val anim = ValueAnimator.ofFloat(0f, 1f).apply { duration = 6000; repeatCount = ValueAnimator.INFINITE; interpolator = LinearInterpolator(); addUpdateListener { t = it.animatedValue as Float; invalidate() } }

    override fun onAttachedToWindow() { super.onAttachedToWindow(); anim.start() }
    override fun onDetachedFromWindow() { anim.cancel(); super.onDetachedFromWindow() }

    private fun cloud(c: Canvas, cx: Float, cy: Float, r: Float) {
        p.style = Paint.Style.FILL; p.color = 0xF2FFFFFF.toInt()
        c.drawCircle(cx - r * 0.7f, cy + r * 0.15f, r * 0.55f, p)
        c.drawCircle(cx, cy - r * 0.1f, r * 0.75f, p)
        c.drawCircle(cx + r * 0.8f, cy + r * 0.2f, r * 0.5f, p)
        c.drawRect(cx - r * 0.7f, cy + r * 0.2f, cx + r * 0.8f, cy + r * 0.7f, p)
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat(); val u = minOf(w, h)
        when (kind) {
            Kind.SUN -> {
                val cx = w / 2; val cy = h / 2
                p.style = Paint.Style.FILL; p.color = 0xFFFFC94D.toInt(); c.drawCircle(cx, cy, u * 0.22f, p)
                p.style = Paint.Style.STROKE; p.strokeWidth = u * 0.06f; p.strokeCap = Paint.Cap.ROUND
                for (i in 0 until 8) {
                    val a = (t * 2 * Math.PI + i * Math.PI / 4).toFloat()
                    c.drawLine(cx + cos(a) * u * 0.34f, cy + sin(a) * u * 0.34f, cx + cos(a) * u * 0.46f, cy + sin(a) * u * 0.46f, p)
                }
            }
            Kind.CLOUD -> cloud(c, w / 2 + sin(t * 2 * Math.PI).toFloat() * u * 0.06f, h / 2, u * 0.26f)
            Kind.RAIN -> {
                cloud(c, w / 2, h * 0.38f, u * 0.24f)
                p.style = Paint.Style.STROKE; p.strokeWidth = u * 0.05f; p.strokeCap = Paint.Cap.ROUND; p.color = 0xFF7CC4FF.toInt()
                for (i in 0 until 3) {
                    val f = (t * 2 + i / 3f) % 1f
                    val x = w * (0.34f + 0.16f * i); val y = h * (0.62f + 0.3f * f)
                    p.alpha = (255 * (1f - f)).toInt()
                    c.drawLine(x, y, x - u * 0.03f, y + u * 0.1f, p)
                }
                p.alpha = 255
            }
        }
    }

    companion object {
        fun kindOf(text: String, rainChance: Int?): Kind {
            val s = text.lowercase()
            return when {
                "rain" in s || "drizzle" in s || "shower" in s || "storm" in s || (rainChance ?: 0) >= 60 -> Kind.RAIN
                "cloud" in s || "overcast" in s || "fog" in s || "mist" in s || "haze" in s -> Kind.CLOUD
                else -> Kind.SUN
            }
        }
    }
}

/** A dot that breathes, to show something is live. */
class PulseDot(ctx: Context, private val color: Int, private val pulse: Boolean = true) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private var t = 0f
    private val anim = ValueAnimator.ofFloat(0f, 1f).apply { duration = 1600; repeatCount = ValueAnimator.INFINITE; addUpdateListener { t = it.animatedValue as Float; invalidate() } }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); if (pulse) anim.start() }
    override fun onDetachedFromWindow() { anim.cancel(); super.onDetachedFromWindow() }
    override fun onDraw(c: Canvas) {
        val cx = width / 2f; val cy = height / 2f; val r = minOf(cx, cy)
        p.color = color; p.alpha = if (pulse) (110 * (1f - t)).toInt() else 0
        c.drawCircle(cx, cy, r * (0.5f + 0.5f * t), p)
        p.alpha = 255; c.drawCircle(cx, cy, r * 0.5f, p)
    }
}

/** A thin line that fills across [durationMs], restarted with [restart]: shows when the next headline arrives. */
class CountdownLine(ctx: Context, private val color: Int) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private var frac = 0f
    private var anim: ValueAnimator? = null
    fun restart(durationMs: Long) {
        anim?.cancel()
        anim = ValueAnimator.ofFloat(0f, 1f).apply { duration = durationMs; interpolator = LinearInterpolator(); addUpdateListener { frac = it.animatedValue as Float; invalidate() }; start() }
    }
    override fun onDetachedFromWindow() { anim?.cancel(); super.onDetachedFromWindow() }
    override fun onDraw(c: Canvas) {
        p.color = 0x33FFFFFF; c.drawRoundRect(0f, 0f, width.toFloat(), height.toFloat(), height / 2f, height / 2f, p)
        p.color = color; c.drawRoundRect(0f, 0f, width * frac, height.toFloat(), height / 2f, height / 2f, p)
    }
}
