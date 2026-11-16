package com.tanush.stashr.tv.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.tanush.stashr.tv.core.Api
import com.tanush.stashr.tv.core.Logic
import com.tanush.stashr.tv.core.Prefs
import com.tanush.stashr.tv.core.Ui
import com.tanush.stashr.tv.service.TvService
import com.tanush.stashr.tv.sync.Movie
import com.tanush.stashr.tv.sync.MovieStore
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * The TV's home screen (it is the launcher): a clock and greeting, a row with every app, a row with the movies on the
 * USB drive, and a Stashr tile for settings. Everything is reachable with the remote's arrows and OK.
 */
class HomeActivity : Activity() {
    private lateinit var ui: Ui
    private val main = Handler(Looper.getMainLooper())
    private lateinit var clock: TextView
    private lateinit var offlineChip: TextView
    private lateinit var date: TextView
    private lateinit var hello: TextView
    private lateinit var syncLine: TextView
    private val groupRows = LinkedHashMap<Logic.AppGroup, LinearLayout>()
    private val groupTitles = LinkedHashMap<Logic.AppGroup, TextView>()
    private lateinit var familyRow: LinearLayout
    private lateinit var usbButton: TextView
    /** One titled row of movies per drive: each pendrive gets its own row. */
    private lateinit var moviesBox: LinearLayout
    private lateinit var weatherChip: TextView
    private lateinit var weatherSub: TextView
    private lateinit var comingBox: LinearLayout
    private lateinit var nightTitle: TextView
    private lateinit var nightRow: LinearLayout
    private lateinit var nightScroll: HorizontalScrollView
    private lateinit var newsStrip: TextView
    private var newsIndex = 0
    private lateinit var morning: LinearLayout
    private var tvHome: Logic.TvHome? = null
    private val dayFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private val screenOn = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) { if (alive) { refreshHome(); maybeMorning() } }
    }
    private val clockFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
    private val dateFmt = SimpleDateFormat("EEEE, d MMMM", Locale.getDefault())
    @Volatile private var alive = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = Ui(this)
        setContentView(build())
        // Weather and headlines come straight from the server. The saved copy is only a fallback for a few minutes, never a 24 hour old picture.
        tvHome = try { Prefs(this).takeIf { System.currentTimeMillis() - it.homeCacheAt < HOME_CACHE_MAX_MS }?.homeCache?.takeIf { it.isNotEmpty() }?.let { Logic.parseTvHome(JSONObject(it)) } } catch (e: Exception) { null }
        renderHome()
        androidx.core.content.ContextCompat.registerReceiver(this, screenOn, IntentFilter(Intent.ACTION_SCREEN_ON), androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    override fun onDestroy() { try { unregisterReceiver(screenOn) } catch (e: Exception) { /* not registered */ }; super.onDestroy() }

    override fun onResume() {
        super.onResume()
        alive = true
        val prefs = Prefs(this)
        if (!prefs.linked) { if (!com.tanush.stashr.tv.BuildConfig.DEBUG) startActivity(Intent(this, SetupActivity::class.java)) } else TvService.start(this)
        loadApps(); loadMovies(); tick(); refreshHome(); refreshFamily(); showNews(); maybeMorning()
    }

    override fun onPause() { alive = false; main.removeCallbacksAndMessages(null); super.onPause() }

    override fun onNewIntent(intent: Intent?) { super.onNewIntent(intent); firstTile()?.requestFocus() }

    private fun firstTile(): View? = groupRows.values.firstNotNullOfOrNull { r -> (r.getChildAt(0)?.tag as? View) }

    @Deprecated("The launcher never closes")
    override fun onBackPressed() { /* this is the home screen: Back stays here */ }

    private fun build(): View {
        val scroll = android.widget.ScrollView(this).apply { setBackgroundColor(Color.TRANSPARENT); isFillViewport = true; clipChildren = false }
        val col = ui.column(8).apply { setPadding(ui.dp(40), ui.dp(16), ui.dp(0), ui.dp(16)); clipChildren = false }
        val head = ui.row(24).apply { setPadding(0, 0, ui.dp(48), 0) }
        val brand = ui.column(0)
        brand.addView(ui.text("STASHR", 20f, Color.WHITE, bold = true).apply {
            letterSpacing = 0.32f; compoundDrawablePadding = ui.dp(10)
            setCompoundDrawablesRelative(androidx.core.content.ContextCompat.getDrawable(context, com.tanush.stashr.tv.R.drawable.ic_brand)?.apply { setBounds(0, 0, ui.dp(30), ui.dp(30)) }, null, null, null)
        })
        clock = ui.text("", 72f, Color.WHITE, bold = true).apply { letterSpacing = -0.02f; setShadowLayer(10f, 0f, 3f, 0x99000000.toInt()) }
        brand.addView(clock)
        head.addView(brand)
        val left = ui.column(2).apply { setPadding(ui.dp(8), 0, 0, 0); minimumWidth = ui.dp(260) }
        hello = ui.text("", 24f, Color.WHITE, bold = true).apply { maxLines = 1 }; date = ui.text("", 22f, 0xDDFFFFFF.toInt()).apply { maxLines = 1 }
        offlineChip = ui.text("", 18f, 0xFFFFE08A.toInt(), bold = true).apply { visibility = View.GONE; maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END }
        left.addView(hello); left.addView(date); left.addView(offlineChip)
        head.addView(ui.fill(left))
        val right = ui.column(6).apply { gravity = Gravity.END }
        // Three round symbol buttons: Wi-Fi, Bluetooth, settings. The USB drive shows beside them only while one is plugged in.
        val buttons = ui.row(14).apply { clipChildren = false; gravity = Gravity.END or Gravity.CENTER_VERTICAL; setPadding(ui.dp(6), ui.dp(4), ui.dp(6), ui.dp(4)) }
        usbButton = ui.text("", 15f, 0xDDFFFFFF.toInt()).apply {
            visibility = View.GONE; compoundDrawablePadding = ui.dp(8)
            setCompoundDrawablesRelative(LineIcon("usb").apply { setBounds(0, 0, ui.dp(22), ui.dp(22)) }, null, null, null)
        }
        buttons.addView(usbButton)
        buttons.addView(roundButton("wifi", "Wi-Fi") { openSettings(android.provider.Settings.ACTION_WIFI_SETTINGS) })
        buttons.addView(roundButton("bluetooth", "Bluetooth") { openSettings(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS) })
        buttons.addView(roundButton("pin", "Live location") { startActivity(Intent(this, LiveMapActivity::class.java)) })
        buttons.addView(roundButton("sliders", "Settings") { openSettings(android.provider.Settings.ACTION_SETTINGS) })
        // One short line: a long download error must never squeeze the greeting column down to a sliver.
        syncLine = ui.text("", 18f, 0xFFFFE08A.toInt()).apply { gravity = Gravity.END; maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; maxWidth = ui.dp(420) }
        right.addView(buttons); right.addView(syncLine)
        head.addView(right)
        col.addView(head)

        // Three big cards, like the smart-TV home screens: weather, the headline of the moment, and where the family is.
        fun card(title: String, width: Int, body: View, focusable: Boolean = false, onOpen: (() -> Unit)? = null) = ui.column(6).apply {
            layoutParams = LinearLayout.LayoutParams(0, ui.dp(104), width / 100f); clipChildren = false   // width is a share of the row, so all three fit any screen
            background = if (focusable) ui.glass(22) else ui.rounded(Color.argb(46, 255, 255, 255), Color.argb(70, 255, 255, 255), 22, 1)
            setPadding(ui.dp(20), ui.dp(10), ui.dp(20), ui.dp(10))
            addView(ui.text(title.uppercase(), 13f, 0xB3FFFFFF.toInt(), bold = true).apply { letterSpacing = 0.12f })
            addView(body)
            if (focusable) {
                isFocusable = true; isClickable = true; contentDescription = title
                setOnClickListener { onOpen?.invoke() }
                setOnFocusChangeListener { v, f -> v.animate().scaleX(if (f) 1.04f else 1f).scaleY(if (f) 1.04f else 1f).setDuration(120).start() }
            }
        }
        weatherChip = ui.text("", 30f, Color.WHITE, bold = true).apply { maxLines = 1 }
        weatherSub = ui.text("", 17f, 0xDDFFFFFF.toInt()).apply { maxLines = 2 }
        newsStrip = ui.text("", 21f, Color.WHITE, bold = true).apply { maxLines = 3; ellipsize = android.text.TextUtils.TruncateAt.END }
        familyRow = ui.column(2)
        val cards = ui.row(16).apply { clipChildren = false; setPadding(ui.dp(6), ui.dp(4), ui.dp(48), ui.dp(4)); layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT) }
        cards.addView(card("Weather", 300, ui.column(2).apply { addView(weatherChip); addView(weatherSub) }))
        cards.addView(card("In the news", 560, newsStrip))
        cards.addView(card("Family", 300, familyRow, focusable = true) { startActivity(Intent(this, LiveMapActivity::class.java)) })
        col.addView(cards)

        comingBox = ui.column(4).apply {
            background = ui.rounded(ui.withAlpha(ui.ok, 0.18f), ui.ok, 16, 2); setPadding(ui.dp(28), ui.dp(16), ui.dp(28), ui.dp(16)); visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { rightMargin = ui.dp(56) }
        }
        col.addView(comingBox)

        nightTitle = ui.h2("Aaj movie night?").apply { setTextColor(Color.WHITE) }
        nightRow = ui.row(20).apply { clipChildren = false; setPadding(ui.dp(8), ui.dp(12), ui.dp(56), ui.dp(12)) }
        nightScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; clipChildren = false; clipToPadding = false; addView(nightRow) }
        col.addView(nightTitle); col.addView(nightScroll)
        nightTitle.visibility = View.GONE; nightScroll.visibility = View.GONE

        for (g in Logic.AppGroup.values()) {
            // Title on the left of its row, so the clock and all three rows fit on one screen without scrolling.
            val title = ui.text(g.title.uppercase(), 13f, 0xB3FFFFFF.toInt(), bold = true).apply { letterSpacing = 0.14f; layoutParams = LinearLayout.LayoutParams(ui.dp(140), ViewGroup.LayoutParams.WRAP_CONTENT) }
            val row = ui.row(16).apply { clipChildren = false; setPadding(ui.dp(10), ui.dp(8), ui.dp(48), ui.dp(8)) }
            groupTitles[g] = title; groupRows[g] = row
            val line = ui.row(0).apply { clipChildren = false }
            line.addView(title)
            line.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; clipChildren = false; clipToPadding = false; addView(row) })
            col.addView(line)
        }

        moviesBox = ui.column(4).apply { clipChildren = false }
        col.addView(moviesBox)
        scroll.addView(col)
        morning = ui.column(18).apply {
            setBackgroundColor(0xF0140F3A.toInt()); setPadding(ui.dp(96), ui.dp(64), ui.dp(96), ui.dp(48)); visibility = View.GONE; isFocusable = true; isClickable = true
        }
        val root = FrameLayout(this)
        root.addView(AuroraView(this), FrameLayout.LayoutParams(-1, -1))
        root.addView(scroll, FrameLayout.LayoutParams(-1, -1))
        root.addView(morning, FrameLayout.LayoutParams(-1, -1))
        return root
    }

    /* ───────── weather, headlines, movie night, who is coming ───────── */

    private fun refreshHome() {
        if (!Prefs(this).linked) return
        thread {
            var failed: Boolean
            try {
                val j = Api(this).tvHome()
                Prefs(this).homeCache = j.toString(); Prefs(this).homeCacheAt = System.currentTimeMillis()
                val parsed = Logic.parseTvHome(j)
                main.post { tvHome = parsed; renderHome(); maybeMorning() }
                failed = false
            } catch (e: Exception) { failed = true /* keep what is on screen, try again soon */ }
            main.post { main.removeCallbacks(homeTimer); if (alive) main.postDelayed(homeTimer, if (failed) 30_000L else 5 * 60_000L) }
        }
    }
    private val homeTimer = Runnable { refreshHome() }
    private val HOME_CACHE_MAX_MS = 10 * 60_000L

    /** Where the family's phones are, as small chips next to the buttons. Polled once a minute while the launcher is showing. */
    private fun refreshFamily() {
        if (!Prefs(this).linked) return
        thread {
            val line = try { Logic.parseLive(Api(this).tvLive()).devices.map { Logic.familyLine(it) } } catch (e: Exception) { null }
            main.post {
                if (line == null || isFinishing) return@post
                familyRow.removeAllViews()
                if (line.isEmpty()) familyRow.addView(ui.text("No phones linked yet", 17f, 0xDDFFFFFF.toInt()))
                for (l in line.take(3)) familyRow.addView(ui.text(l, 19f, Color.WHITE, bold = true).apply { maxLines = 1 })
            }
        }
        main.removeCallbacks(familyTimer)
        if (alive) main.postDelayed(familyTimer, 60_000L)
    }
    private val familyTimer = Runnable { refreshFamily() }

    private fun renderHome() {
        val h = tvHome
        val w = h?.weather
        weatherChip.text = if (w != null) "${w.temp}°C" else "--"
        weatherSub.text = if (w != null) listOfNotNull(w.text.takeIf { it.isNotBlank() }, w.city.takeIf { it.isNotBlank() }, w.rainChance?.let { "$it% rain" }).joinToString(" · ") else "Connect the TV to see the weather"
        comingBox.removeAllViews()
        comingBox.visibility = if (h != null && h.coming.isNotEmpty()) View.VISIBLE else View.GONE
        h?.coming?.forEach { c ->
            comingBox.addView(ui.text("🚗  " + Logic.comingLine(c), 30f, ui.text, bold = true))
            if (c.km > 0) comingBox.addView(ui.text("%.1f km door".format(c.km), 18f, ui.muted))
        }
        showNews()
        renderNight()
    }

    /** The strip at the very top: one headline at a time, changing by itself, so nobody has to steer to it with the remote. */
    private fun showNews() {
        main.removeCallbacks(newsTimer)
        val news = tvHome?.news.orEmpty()
        if (news.isEmpty()) { newsStrip.text = "Headlines will show here"; return }
        val n = news[newsIndex++ % news.size]
        newsStrip.text = n.title + (if (n.source.isNotEmpty()) "\n" + n.source else "")
        if (alive) main.postDelayed(newsTimer, 10_000L)
    }
    private val newsTimer = Runnable { showNews() }

    private fun renderNight() {
        val list = MovieStore.list(this)
        val on = tvHome?.movieNight == true && list.isNotEmpty()
        nightTitle.visibility = if (on) View.VISIBLE else View.GONE
        nightScroll.visibility = nightTitle.visibility
        nightRow.removeAllViews()
        if (on) for (m in list) nightRow.addView(tile(260, 146, Logic.title(m.name), Logic.size(m.size), null, { play(m) }, { confirmDelete(m) }))
    }

    /** First time the launcher is on screen each morning (05:00-10:59): weather and the top headlines for 30 seconds. */
    private fun maybeMorning() {
        val h = tvHome ?: return
        if (!alive || morning.visibility == View.VISIBLE) return
        val prefs = Prefs(this)
        val today = dayFmt.format(Date())
        if (!Logic.shouldShowMorning(Calendar.getInstance().get(Calendar.HOUR_OF_DAY), today, prefs.morningShown)) return
        if (h.weather == null && h.news.isEmpty()) return
        prefs.morningShown = today
        morning.removeAllViews()
        morning.addView(ui.text("Good morning", 56f, ui.text, bold = true))
        morning.addView(ui.text(dateFmt.format(Date()), 26f, ui.muted))
        h.weather?.let { w ->
            morning.addView(ui.text("${w.temp}°C  ·  ${w.text}", 44f, ui.accent, bold = true))
            morning.addView(ui.text(listOfNotNull(if (w.city.isNotBlank()) w.city else null, "${w.min}–${w.max}°C today", w.rainChance?.let { "$it% chance of rain" }).joinToString("  ·  "), 24f, ui.muted))
        }
        if (h.news.isNotEmpty()) {
            morning.addView(ui.text("Headlines", 28f, ui.text, bold = true))
            h.news.take(5).forEach { n -> morning.addView(ui.text("•  " + n.title + (if (n.source.isNotEmpty()) "  (${n.source})" else ""), 24f, ui.text).apply { maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END }) }
        }
        morning.addView(ui.text("Press any button to close", 18f, ui.faint))
        morning.visibility = View.VISIBLE
        morning.requestFocus()
        main.postDelayed({ morning.visibility = View.GONE }, 30_000)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (morning.visibility == View.VISIBLE) { if (event.action == KeyEvent.ACTION_DOWN) morning.visibility = View.GONE; return true }
        return super.dispatchKeyEvent(event)
    }

    private fun tick() {
        val now = Date()
        clock.text = clockFmt.format(now); date.text = dateFmt.format(now)
        hello.text = Logic.greeting(Calendar.getInstance().get(Calendar.HOUR_OF_DAY))
        val drives = MovieStore.drives(this)
        usbButton.visibility = if (drives.isNotEmpty()) View.VISIBLE else View.GONE
        usbButton.text = if (drives.isEmpty()) "" else "${drives.size} USB · ${Logic.size(drives.sumOf { it.free })} free of ${Logic.size(drives.sumOf { it.total })}"
        val prefs = Prefs(this)
        val local = com.tanush.stashr.tv.service.TvService.localMode
        offlineChip.visibility = if (local) View.VISIBLE else View.GONE
        if (local) offlineChip.text = "●  Offline mode · working through the tablet"
        val s = com.tanush.stashr.tv.service.TvService.syncer?.state
        syncLine.text = when {
            !prefs.linked -> "Not linked"
            s != null && s.active && s.name.isNotEmpty() && s.error.isEmpty() -> "Downloading ${Logic.title(s.name)} · ${s.pct}%"
            s != null && s.error.isNotEmpty() -> s.error.take(70)
            else -> ""
        }
        if (alive) main.postDelayed({ tick(); if (movieKey() != lastMovieKey) loadMovies() }, 2000)
    }

    private fun tile(w: Int, h: Int, label: String, sub: String?, image: Drawable?, onOpen: () -> Unit, onMenu: (() -> Unit)? = null, glyph: String? = null): View {
        val box = ui.column(6).apply { layoutParams = LinearLayout.LayoutParams(ui.dp(w), ViewGroup.LayoutParams.WRAP_CONTENT); clipChildren = false }
        var caption: TextView? = null
        val face = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(ui.dp(w), ui.dp(h)); background = ui.glass(16)
            isFocusable = true; isClickable = true; setPadding(ui.dp(6), ui.dp(6), ui.dp(6), ui.dp(6)); contentDescription = label
            setOnClickListener { onOpen() }
            if (onMenu != null) setOnLongClickListener { onMenu(); true }
            setOnFocusChangeListener { v, f -> v.animate().scaleX(if (f) 1.1f else 1f).scaleY(if (f) 1.1f else 1f).setDuration(180).setInterpolator(android.view.animation.DecelerateInterpolator(1.8f)).start(); v.elevation = if (f) ui.dp(14).toFloat() else 0f; caption?.animate()?.alpha(if (f) 1f else 0f)?.setDuration(180)?.start() }
        }
        if (image != null) face.addView(ImageView(this).apply { setImageDrawable(image); scaleType = ImageView.ScaleType.FIT_CENTER }, FrameLayout.LayoutParams(-1, -1))
        else if (glyph != null) face.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            addView(ImageView(context).apply { setImageDrawable(LineIcon(glyph)) }, LinearLayout.LayoutParams(ui.dp(26), ui.dp(26)))
            addView(ui.text(label, 13f, 0xEEFFFFFF.toInt()).apply { gravity = Gravity.CENTER; maxLines = 1; setPadding(0, ui.dp(6), 0, 0) })
        }, FrameLayout.LayoutParams(-1, -1))
        else face.addView(ui.text(label.take(2).uppercase(), 40f, Color.WHITE, bold = true).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(-1, -1))
        box.addView(face)
        // An app's banner already carries its name, and a glyph tile has it inside: only movies need a line below.
        if (glyph != null) return box.also { it.tag = face }
        if (image != null) {
            // The name appears under the tile that has focus, like the reference home screens, and stays out of the way otherwise.
            caption = ui.text(label, 15f, Color.WHITE).apply { alpha = 0f; maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; gravity = Gravity.CENTER_HORIZONTAL; layoutParams = LinearLayout.LayoutParams(ui.dp(w), ViewGroup.LayoutParams.WRAP_CONTENT) }
            box.addView(caption)
            return box.also { it.tag = face }
        }
        box.addView(ui.text(label, 20f, Color.WHITE).apply { maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END; gravity = Gravity.CENTER_HORIZONTAL; layoutParams = LinearLayout.LayoutParams(ui.dp(w), ViewGroup.LayoutParams.WRAP_CONTENT) })
        if (sub != null) box.addView(ui.text(sub, 15f, 0xB3FFFFFF.toInt()).apply { gravity = Gravity.CENTER_HORIZONTAL; layoutParams = LinearLayout.LayoutParams(ui.dp(w), ViewGroup.LayoutParams.WRAP_CONTENT) })
        return box.also { it.tag = face }
    }

    private fun pill(label: String, onOpen: () -> Unit): TextView = ui.text(label, 16f, Color.WHITE, bold = true).apply {
        background = ui.glass(20); isFocusable = true; isClickable = true; contentDescription = label
        setPadding(ui.dp(14), ui.dp(8), ui.dp(14), ui.dp(8))
        setOnClickListener { onOpen() }
        setOnFocusChangeListener { v, f -> v.animate().scaleX(if (f) 1.08f else 1f).scaleY(if (f) 1.08f else 1f).setDuration(120).start() }
    }

    private fun roundButton(icon: String, label: String, onOpen: () -> Unit): View = FrameLayout(this).apply {
        contentDescription = label; isFocusable = true; isClickable = true
        layoutParams = LinearLayout.LayoutParams(ui.dp(46), ui.dp(46))
        addView(ImageView(context).apply { setImageDrawable(LineIcon(icon)) }, FrameLayout.LayoutParams(ui.dp(26), ui.dp(26), Gravity.CENTER))
        fun oval(fill: Int, stroke: Int) = android.graphics.drawable.GradientDrawable().apply { shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(fill); setStroke(ui.dp(1), stroke) }
        background = android.graphics.drawable.StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), oval(Color.argb(70, 255, 255, 255), Color.argb(200, 255, 255, 255)))
            addState(intArrayOf(), oval(Color.TRANSPARENT, Color.TRANSPARENT))
        }
        setOnClickListener { onOpen() }
        setOnFocusChangeListener { v, f -> v.animate().scaleX(if (f) 1.12f else 1f).scaleY(if (f) 1.12f else 1f).setDuration(160).start() }
    }

    private fun openSettings(action: String) {
        try { startActivity(Intent(action)) } catch (e: Exception) {
            try { startActivity(Intent(android.provider.Settings.ACTION_SETTINGS)) } catch (e2: Exception) { android.widget.Toast.makeText(this, "Could not open settings", android.widget.Toast.LENGTH_SHORT).show() }
        }
    }

    /** The name of the USB drive plugged in right now, or null. */
    private fun usbName(): String? = try {
        (getSystemService(Context.STORAGE_SERVICE) as android.os.storage.StorageManager).storageVolumes
            .firstOrNull { it.isRemovable && it.state == android.os.Environment.MEDIA_MOUNTED }?.getDescription(this)?.ifBlank { "USB drive" }
    } catch (e: Exception) { null }

    private data class AppEntry(val pkg: String, val label: String, val image: Drawable?)

    private fun loadApps() {
        thread {
            val pm = packageManager
            fun query(category: String) = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(category), 0)
            val found = LinkedHashMap<String, AppEntry>()
            for (ri in query(Intent.CATEGORY_LEANBACK_LAUNCHER) + query(Intent.CATEGORY_LAUNCHER)) {
                val pkg = ri.activityInfo.packageName
                if (pkg == packageName || pkg in found || Logic.appGroup(pkg) == null) continue
                found[pkg] = AppEntry(pkg, ri.loadLabel(pm).toString(), ri.activityInfo.loadBanner(pm) ?: ri.loadIcon(pm))
            }
            val sorted = Logic.sortApps(found.values.toList(), { it.pkg }, { it.label })
            main.post {
                if (isFinishing) return@post
                val hadFocus = groupRows.values.any { it.focusedChild != null }
                for (g in Logic.AppGroup.values()) {
                    val row = groupRows.getValue(g)
                    row.removeAllViews()
                    for (a in sorted) if (Logic.appGroup(a.pkg) == g) row.addView(tile(144, 82, a.label, null, a.image, { launch(a.pkg) }))
                    if (g == Logic.AppGroup.OTHER) {
                        row.addView(tile(144, 82, "Family location", null, null, { startActivity(Intent(this, LiveMapActivity::class.java)) }, glyph = "pin"))
                        row.addView(tile(144, 82, "Show phone on TV", null, null, { startActivity(Intent(this, MirrorActivity::class.java)) }, glyph = "phone"))
                        row.addView(tile(144, 82, "Stashr settings", null, null, { startActivity(Intent(this, SettingsActivity::class.java)) }, glyph = "sliders"))
                    }
                    groupTitles.getValue(g).visibility = if (row.childCount == 0) View.GONE else View.VISIBLE
                    ((row.parent as View).parent as View).visibility = groupTitles.getValue(g).visibility
                }
                if (!hadFocus) firstTile()?.requestFocus()
            }
        }
    }

    private fun launch(pkg: String) {
        val i = packageManager.getLeanbackLaunchIntentForPackage(pkg) ?: packageManager.getLaunchIntentForPackage(pkg)
        if (i != null) try { startActivity(i) } catch (e: Exception) { android.widget.Toast.makeText(this, "Could not open that app", android.widget.Toast.LENGTH_SHORT).show() }
    }

    private var lastMovieKey = ""
    private fun movieKey() = MovieStore.list(this).joinToString("|") { it.name + it.size }

    private fun loadMovies() {
        thread {
            val list = MovieStore.list(this)
            main.post {
                if (isFinishing) return@post
                lastMovieKey = list.joinToString("|") { it.name + it.size }
                moviesBox.removeAllViews()
                for ((drive, movies) in MovieStore.byDrive(this)) {
                    moviesBox.addView(ui.h2(if (drive == null) "Movies" else "Movies · ${drive.label} · ${Logic.size(drive.free)} free of ${Logic.size(drive.total)}").apply { setTextColor(Color.WHITE) })
                    if (movies.isEmpty()) moviesBox.addView(ui.text("No movies on this drive yet", 17f, 0xDDFFFFFF.toInt()).apply { setPadding(ui.dp(8), ui.dp(4), 0, ui.dp(12)) })
                    val row = ui.row(20).apply { clipChildren = false; setPadding(ui.dp(8), ui.dp(12), ui.dp(56), ui.dp(12)) }
                    for (m in movies) row.addView(tile(260, 146, Logic.title(m.name), Logic.size(m.size), null, { play(m) }, { confirmDelete(m) }))
                    moviesBox.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; clipChildren = false; clipToPadding = false; addView(row) })
                }
                renderNight()
            }
        }
    }

    private fun play(m: Movie) = startActivity(Intent(this, PlayerActivity::class.java).putExtra(PlayerActivity.EXTRA_NAME, m.name))

    private fun confirmDelete(m: Movie) {
        AlertDialog.Builder(this).setTitle("Delete this movie?").setMessage(Logic.title(m.name) + " (" + Logic.size(m.size) + ") will be removed from this TV's storage.")
            .setPositiveButton("Delete") { _, _ -> thread { MovieStore.remove(this, m.name); main.post { loadMovies() } } }
            .setNegativeButton("Keep", null).show()
    }

}
