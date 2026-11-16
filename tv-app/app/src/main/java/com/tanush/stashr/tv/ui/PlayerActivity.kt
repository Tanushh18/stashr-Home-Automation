package com.tanush.stashr.tv.ui

import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.tanush.stashr.tv.core.Logic
import com.tanush.stashr.tv.core.Prefs
import com.tanush.stashr.tv.service.NowPlaying
import com.tanush.stashr.tv.sync.MovieStore

/** Plays a movie from the storage with Media3. Remembers where you stopped. OK shows the controls; Back leaves. */
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
class PlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null
    private val main = Handler(Looper.getMainLooper())
    private var name = ""
    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        prefs = Prefs(this)
        // Either a movie the app keeps (by name), or any file picked in the pendrive browser (by path).
        val picked = intent.getStringExtra(EXTRA_PATH)?.let { java.io.File(it) }?.takeIf { it.isFile }
        val movie = if (picked != null) com.tanush.stashr.tv.sync.Movie(picked.name, picked.length(), picked, false) else MovieStore.find(this, intent.getStringExtra(EXTRA_NAME).orEmpty())
        if (movie == null) { Toast.makeText(this, "That movie is not on this TV", Toast.LENGTH_LONG).show(); finish(); return }
        name = movie.name
        val view = PlayerView(this).apply { setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING); controllerShowTimeoutMs = 4000; isFocusable = true }
        setContentView(view)
        val p = ExoPlayer.Builder(this).build().also { player = it }
        view.player = p
        p.setMediaItem(MediaItem.fromUri(Uri.fromFile(movie.file)))
        val at = prefs.position(name)
        if (at > 5_000) p.seekTo(at - 3_000)
        p.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { NowPlaying.playing = isPlaying }
            override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_ENDED) { prefs.savePosition(name, 0); finish() } }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) { Toast.makeText(this@PlayerActivity, "Cannot play this file: " + (error.message ?: ""), Toast.LENGTH_LONG).show() }
        })
        p.prepare(); p.playWhenReady = true
        NowPlaying.title = Logic.title(name); NowPlaying.playing = true
        saveLoop()
    }

    private fun saveLoop() { main.postDelayed({ player?.let { if (it.isPlaying) prefs.savePosition(name, it.currentPosition) }; saveLoop() }, 5_000) }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        val p = player
        if (p != null) when (keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> { p.playWhenReady = !p.playWhenReady; return true }
            KeyEvent.KEYCODE_MEDIA_PLAY -> { p.playWhenReady = true; return true }
            KeyEvent.KEYCODE_MEDIA_PAUSE -> { p.playWhenReady = false; return true }
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { p.seekTo(p.currentPosition + 30_000); return true }
            KeyEvent.KEYCODE_MEDIA_REWIND -> { p.seekTo(maxOf(0, p.currentPosition - 10_000)); return true }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onStop() {
        player?.let { if (name.isNotEmpty() && it.duration > 0 && it.currentPosition < it.duration - 10_000) prefs.savePosition(name, it.currentPosition) }
        player?.pause()
        super.onStop()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        NowPlaying.title = ""; NowPlaying.playing = false
        player?.release(); player = null
        super.onDestroy()
    }

    companion object { const val EXTRA_NAME = "movie"; const val EXTRA_PATH = "path" }

}
