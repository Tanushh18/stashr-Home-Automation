package com.tanush.stashr.hub.ui

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.Ui
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/**
 * The photo frame: photos from the Google Drive folder picked on the Smart home page, one every 8 seconds with a
 * crossfade, and a small clock. A tap goes back to the dashboard; the server can also stop it.
 */
class SlideshowActivity : Activity() {
    companion object { const val ACTION_STOP = "com.tanush.stashr.hub.SLIDESHOW_STOP" }

    private val main = Handler(Looper.getMainLooper())
    private lateinit var front: ImageView
    private lateinit var back: ImageView
    private lateinit var clock: TextView
    private lateinit var message: TextView
    private var ids: List<String> = emptyList()
    private var index = 0
    @Volatile private var alive = true
    private val clockFmt = SimpleDateFormat("HH:mm", Locale.getDefault())

    private val stopReceiver = object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) { finish() } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val ui = Ui(this)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        back = image(); front = image()
        root.addView(back); root.addView(front)
        clock = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 22f; setShadowLayer(8f, 0f, 2f, Color.BLACK)
            setPadding(ui.dp(24), ui.dp(16), ui.dp(24), ui.dp(16))
        }
        root.addView(clock, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.END))
        message = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 18f; gravity = Gravity.CENTER; text = "Loading your photos…"
            setPadding(ui.dp(32), 0, ui.dp(32), 0)
        }
        root.addView(message, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.setOnClickListener { finish() }
        setContentView(root)
        immersive()

        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(stopReceiver, IntentFilter(ACTION_STOP), Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(stopReceiver, IntentFilter(ACTION_STOP))
        }

        tickClock()
        thread {
            try {
                val r = Api(this).slideshow()
                val arr = r.optJSONArray("photos")
                val list = (0 until (arr?.length() ?: 0)).map { arr!!.getJSONObject(it).optString("id") }.filter { it.isNotEmpty() }.shuffled()
                pruneCache(list.toSet())
                main.post {
                    if (list.isEmpty()) message.text = r.optString("error").ifEmpty { "No photos in the slideshow folder yet. Add some to the Google Drive folder chosen on the Smart home page." }
                    else { ids = list; next() }
                }
            } catch (e: Exception) {
                main.post { message.text = "Could not load the photos: ${e.message}" }
            }
        }
    }

    private fun image() = ImageView(this).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        alpha = 0f
    }

    private fun immersive() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) immersive() }

    private fun tickClock() {
        if (!alive) return
        clock.text = clockFmt.format(Date())
        main.postDelayed({ tickClock() }, 15_000)
    }

    /** Loads the next photo in the background, then crossfades to it and waits 8 seconds. */
    private fun next() {
        if (!alive || ids.isEmpty()) return
        val id = ids[index % ids.size]
        index++
        thread {
            val bmp = try { decode(photoBytes(id)) } catch (e: Exception) { null }
            main.post {
                if (!alive) return@post
                if (bmp != null) show(bmp)
                main.postDelayed({ next() }, if (bmp != null) 8_000 else 1_000)
            }
        }
    }

    /**
     * Each photo is downloaded once and kept on the tablet. Before this, every photo came through the server again each
     * time it was shown (about one every 8 seconds, all day), which used most of the server's included bandwidth.
     */
    private fun cacheFile(id: String): File {
        val dir = File(cacheDir, "slideshow").also { it.mkdirs() }
        return File(dir, id.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.take(80) + ".img")
    }

    private fun photoBytes(id: String): ByteArray {
        val f = cacheFile(id)
        if (f.length() > 0) { try { return f.readBytes() } catch (e: Exception) { f.delete() } }
        val bytes = Api(this).slideshowFile(id)
        try {
            val tmp = File(f.parentFile, f.name + ".tmp")
            tmp.writeBytes(bytes)
            if (!tmp.renameTo(f)) tmp.delete()
        } catch (e: Exception) { /* no space: the photo is still shown, just not kept */ }
        return bytes
    }

    /** Forgets photos that are no longer in the Drive folder, and keeps the cache under about 300 MB. */
    private fun pruneCache(keep: Set<String>) {
        try {
            val dir = File(cacheDir, "slideshow")
            val files = dir.listFiles() ?: return
            val wanted = keep.map { cacheFile(it).name }.toSet()
            files.filter { it.name !in wanted }.forEach { it.delete() }
            var total = 0L
            dir.listFiles()?.sortedBy { it.lastModified() }?.reversed()?.forEach { total += it.length(); if (total > 300L * 1024 * 1024) it.delete() }
        } catch (e: Exception) { /* a cache problem must never stop the slideshow */ }
    }

    private fun show(bmp: Bitmap) {
        message.visibility = View.GONE
        val old = front
        back.setImageBitmap(bmp)
        back.alpha = 0f
        back.bringToFront(); clock.bringToFront()
        back.animate().alpha(1f).setDuration(1200).start()
        old.animate().alpha(0f).setDuration(1200).withEndAction { old.setImageDrawable(null) }.start()
        front = back; back = old
    }

    /** Decodes at about the screen's size, so a 12-megapixel photo does not run the tablet out of memory. */
    private fun decode(bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val dm = resources.displayMetrics
        val want = maxOf(dm.widthPixels, dm.heightPixels).coerceAtLeast(1)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= want) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    override fun onDestroy() {
        alive = false
        main.removeCallbacksAndMessages(null)
        try { unregisterReceiver(stopReceiver) } catch (e: Exception) { }
        super.onDestroy()
    }
}
