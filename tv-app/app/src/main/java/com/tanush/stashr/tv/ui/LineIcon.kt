package com.tanush.stashr.tv.ui

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.Drawable

/**
 * Thin white outline icons drawn from paths on a 24x24 grid, so the launcher needs no image files and every icon has the same quiet weight. */
class LineIcon(private val name: String, color: Int = 0xEBFFFFFF.toInt()) : Drawable() {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND; this.color = color }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; this.color = color }

    private fun ops(o: IntArray, c: Canvas) {
        val s = bounds.width() / 240f
        paint.strokeWidth = 16 * s
        val p = Path(); val arc = RectF()
        var i = 0
        while (i < o.size) when (o[i]) {
            0 -> { p.moveTo(o[i + 1] * s, o[i + 2] * s); i += 3 }
            1 -> { p.lineTo(o[i + 1] * s, o[i + 2] * s); i += 3 }
            2 -> { p.close(); i += 1 }
            3 -> { p.addCircle(o[i + 1] * s, o[i + 2] * s, o[i + 3] * s, Path.Direction.CW); i += 4 }
            else -> { val cx = o[i + 1] * s; val cy = o[i + 2] * s; val r = o[i + 3] * s; arc.set(cx - r, cy - r, cx + r, cy + r); p.addArc(arc, o[i + 4].toFloat(), o[i + 5].toFloat()); i += 6 }
        }
        c.save(); c.translate(bounds.left.toFloat(), bounds.top.toFloat()); c.drawPath(p, paint); c.restore()
    }

    override fun draw(c: Canvas) {
        when (name) {
            "wifi" -> { ops(WIFI, c); return }
            "bluetooth" -> { ops(BLUETOOTH, c); return }
            "sliders" -> { ops(SETTINGS, c); return }
        }
        val s = bounds.width() / 24f
        paint.strokeWidth = 1.6f * s
        c.save(); c.translate(bounds.left.toFloat(), bounds.top.toFloat()); c.scale(s, s)
        paint.strokeWidth = 1.6f
        val p = Path()
        fun poly(vararg pts: Float, close: Boolean = false) { p.reset(); p.moveTo(pts[0], pts[1]); var i = 2; while (i < pts.size) { p.lineTo(pts[i], pts[i + 1]); i += 2 }; if (close) p.close(); c.drawPath(p, paint) }
        when (name) {
            "wifi" -> {
                for (r in floatArrayOf(14f, 9.5f, 5f)) { p.reset(); p.addArc(RectF(12 - r, 19 - r, 12 + r, 19 + r), 225f - 45f, 90f); c.drawPath(p, paint) }
                c.drawCircle(12f, 19f, 1.1f, dot)
            }
            "bluetooth" -> poly(7f, 8f, 17f, 16f, 12f, 21f, 12f, 3f, 17f, 8f, 7f, 16f)
            "sliders" -> {
                poly(4f, 7f, 12.5f, 7f); poly(17.5f, 7f, 20f, 7f); c.drawCircle(15f, 7f, 2.4f, paint)
                poly(4f, 17f, 5.5f, 17f); poly(10.5f, 17f, 20f, 17f); c.drawCircle(8f, 17f, 2.4f, paint)
            }
            "pin" -> {
                p.reset(); p.moveTo(12f, 21.5f); p.cubicTo(7f, 15.5f, 5f, 12.5f, 5f, 9.5f); p.arcTo(RectF(5f, 2.5f, 19f, 16.5f), 180f, 180f); p.cubicTo(19f, 12.5f, 17f, 15.5f, 12f, 21.5f); p.close()
                c.drawPath(p, paint); c.drawCircle(12f, 9.5f, 2.4f, paint)
            }
            "phone" -> { p.reset(); p.addRoundRect(RectF(7f, 2.5f, 17f, 21.5f), 2.2f, 2.2f, Path.Direction.CW); c.drawPath(p, paint); poly(10.5f, 18.5f, 13.5f, 18.5f) }
            "usb" -> {
                poly(12f, 4f, 12f, 18f); poly(12f, 14f, 7f, 10.5f, 7f, 8f); poly(12f, 11f, 17f, 8.5f, 17f, 7f)
                c.drawCircle(12f, 20f, 2f, paint); c.drawCircle(17f, 5.8f, 1.3f, paint); p.reset(); p.addRect(5.9f, 5.2f, 8.1f, 7.4f, Path.Direction.CW); c.drawPath(p, paint)
                p.reset(); p.moveTo(12f, 2f); p.lineTo(10.2f, 4.6f); p.lineTo(13.8f, 4.6f); p.close(); c.drawPath(p, dot)
            }
            "drive" -> { p.reset(); p.addRoundRect(RectF(3f, 8f, 21f, 16f), 2f, 2f, Path.Direction.CW); c.drawPath(p, paint); c.drawCircle(17f, 12f, 1f, dot) }
            "sparkle" -> {
                poly(12f, 3f, 14.2f, 9.8f, 21f, 12f, 14.2f, 14.2f, 12f, 21f, 9.8f, 14.2f, 3f, 12f, 9.8f, 9.8f, close = true)
                poly(19f, 3.5f, 19f, 7f); poly(17.2f, 5.2f, 20.8f, 5.2f)
            }
            "home" -> {
                poly(3f, 11f, 12f, 3.5f, 21f, 11f)
                poly(5.5f, 9.5f, 5.5f, 20.5f, 18.5f, 20.5f, 18.5f, 9.5f)
                poly(10f, 20.5f, 10f, 14.5f, 14f, 14.5f, 14f, 20.5f)
            }
        }
        c.restore()
    }

    override fun setAlpha(a: Int) { paint.alpha = a; dot.alpha = a }
    override fun setColorFilter(cf: ColorFilter?) { paint.colorFilter = cf; dot.colorFilter = cf }
    @Deprecated("Required by Drawable") override fun getOpacity() = PixelFormat.TRANSLUCENT

    private companion object {
        val WIFI = intArrayOf(4, 120, 195, 135, 225, 90, 4, 120, 195, 92, 225, 90, 4, 120, 195, 50, 225, 90, 3, 120, 195, 4)
        val BLUETOOTH = intArrayOf(0, 70, 80, 1, 170, 160, 1, 120, 205, 1, 120, 35, 1, 170, 80, 1, 70, 160)
        val SETTINGS = intArrayOf(0, 40, 70, 1, 140, 70, 0, 180, 70, 1, 200, 70, 0, 40, 170, 1, 60, 170, 0, 100, 170, 1, 200, 170, 3, 160, 70, 20, 3, 80, 170, 20)
    }
}
