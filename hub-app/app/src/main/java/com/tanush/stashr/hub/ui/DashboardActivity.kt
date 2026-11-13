package com.tanush.stashr.hub.ui

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.graphics.Color
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.ScrollView
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import com.tanush.stashr.hub.camera.CameraWatch
import com.tanush.stashr.hub.core.Api
import com.tanush.stashr.hub.core.Health
import com.tanush.stashr.hub.core.HubService
import com.tanush.stashr.hub.core.Prefs
import com.tanush.stashr.hub.core.Ui
import com.tanush.stashr.hub.local.LocalMode
import com.tanush.stashr.hub.update.Updater
import com.tanush.stashr.hub.voice.VoiceListener
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/**
 * The tablet's assistant hub. A dark glass look on the Stashr aurora, four pages behind a navigation rail:
 *  - Home: greeting, clock and weather, "Ask Stashr" (voice or typing, with suggestions), who is home, the TV, who is coming;
 *  - Updates: what happened at home, today's news, TV time and internet speed;
 *  - Control: the TV remote, scenes, camera and screen buttons, the quick switches;
 *  - Settings: this tablet's status, checks, WhatsApp, update and unpair.
 * Every button sends the same sentences the assistant already understands, so the TV, camera and scenes are controlled from here.
 * The screen sleeps by itself (battery); after 10 idle minutes it can turn into the photo slideshow.
 */
class DashboardActivity : Activity() {
    private lateinit var ui: Ui
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val prefs by lazy { Prefs(this) }

    private lateinit var clock: TextView
    private lateinit var date: TextView
    private lateinit var weather: TextView
    private lateinit var people: LinearLayout
    private lateinit var tv: LinearLayout
    private lateinit var today: LinearLayout
    private lateinit var events: LinearLayout
    private lateinit var scenes: LinearLayout
    private lateinit var offlineBanner: TextView
    private lateinit var safar: LinearLayout
    private lateinit var reply: TextView
    private lateinit var statusLine: TextView
    private lateinit var checkBox: LinearLayout
    private lateinit var cameraSwitch: Switch
    private lateinit var voiceSwitch: Switch
    private lateinit var micButton: TextView
    private lateinit var coming: LinearLayout
    private lateinit var waState: TextView
    private lateinit var waResult: TextView
    private lateinit var hello: TextView
    private lateinit var statusChip: TextView
    private lateinit var newsList: LinearLayout
    private lateinit var toastLine: TextView
    private lateinit var healthList: LinearLayout
    private lateinit var homeScenes: LinearLayout
    private val pages = ArrayList<View>()
    private val railItems = ArrayList<View>()
    private var pageIndex = 0

    private var slideshowReady = false
    private var lastTouch = System.currentTimeMillis()
    private var resumed = false
    private var oneShot: SpeechRecognizer? = null
    private val clockFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
    private val dateFmt = SimpleDateFormat("EEEE, d MMMM", Locale.getDefault())

    private val voiceReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            showReply(i.getStringExtra("heard").orEmpty(), i.getStringExtra("reply").orEmpty())
        }
    }

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) { offlineBanner.visibility = if (i.getBooleanExtra("offline", false)) View.VISIBLE else View.GONE }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // This is the tablet's home screen now, so it can be opened before the tablet is set up: send it to the setup first.
        if (!prefs.paired || prefs.role != "hub") { startActivity(Intent(this, MainActivity::class.java)); finish(); return }
        if (!prefs.screenOffAfter) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        ui = Ui(this, dark = true)
        HubService.start(this)
        setContentView(build())
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(voiceReceiver, IntentFilter(VoiceListener.ACTION_VOICE), Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(voiceReceiver, IntentFilter(VoiceListener.ACTION_VOICE))
        }
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(stateReceiver, IntentFilter(LocalMode.ACTION_STATE), Context.RECEIVER_NOT_EXPORTED)
        else { @Suppress("UnspecifiedRegisterReceiverFlag") registerReceiver(stateReceiver, IntentFilter(LocalMode.ACTION_STATE)) }
        askPermissions()
        tick()
        refresh()
    }

    /* ───────── layout ───────── */

    private fun build(): View {
        val root = FrameLayout(this)
        root.addView(AuroraView(this), FrameLayout.LayoutParams(-1, -1))
        val body = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        body.addView(rail(), LinearLayout.LayoutParams(ui.dp(96), ViewGroup.LayoutParams.MATCH_PARENT))
        val content = FrameLayout(this)
        pages.add(homePage()); pages.add(updatesPage()); pages.add(controlPage()); pages.add(settingsPage())
        pages.forEach { content.addView(it, FrameLayout.LayoutParams(-1, -1)) }
        body.addView(content, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        root.addView(body, FrameLayout.LayoutParams(-1, -1))
        toastLine = ui.text("", 15f, Color.WHITE, bold = true).apply {
            background = ui.rounded(0xF2101A22.toInt(), ui.c.lineStrong, 999); setPadding(ui.dp(24), ui.dp(13), ui.dp(24), ui.dp(13)); visibility = View.GONE
        }
        root.addView(toastLine, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = ui.dp(28) })
        select(0)
        return root
    }

    /* ── navigation rail ── */

    private fun rail(): View {
        val col = ui.column(6).apply { gravity = Gravity.CENTER_HORIZONTAL; setPadding(ui.dp(8), ui.dp(22), ui.dp(8), ui.dp(16)); setBackgroundColor(0x33000000) }
        col.addView(ImageView(this).apply { setImageResource(com.tanush.stashr.hub.R.drawable.ic_brand); layoutParams = LinearLayout.LayoutParams(ui.dp(46), ui.dp(46)).apply { bottomMargin = ui.dp(18) } })
        val items = listOf("Home" to "home", "Updates" to "bell", "Control" to "sliders", "Settings" to "gear")
        items.forEachIndexed { i, (label, icon) ->
            val item = ui.column(2).apply {
                gravity = Gravity.CENTER; isClickable = true; isFocusable = true; contentDescription = label
                setPadding(ui.dp(4), ui.dp(12), ui.dp(4), ui.dp(10))
                addView(ImageView(context).apply { setImageDrawable(LineIcon(icon)); layoutParams = LinearLayout.LayoutParams(ui.dp(26), ui.dp(26)) })
                addView(ui.text(label, 11f, Color.WHITE).apply { gravity = Gravity.CENTER })
                setOnClickListener { select(i) }
            }
            railItems.add(item)
            col.addView(item, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        // Bottom left: the list of every other app on the tablet.
        col.addView(View(this), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        col.addView(ui.column(2).apply {
            gravity = Gravity.CENTER; isClickable = true; isFocusable = true; contentDescription = "Apps"
            setPadding(ui.dp(4), ui.dp(12), ui.dp(4), ui.dp(10))
            background = ui.rounded(Color.argb(40, 255, 255, 255), Color.argb(90, 255, 255, 255), 18)
            addView(ImageView(context).apply { setImageDrawable(LineIcon("apps")); layoutParams = LinearLayout.LayoutParams(ui.dp(26), ui.dp(26)) })
            addView(ui.text("Apps", 11f, Color.WHITE).apply { gravity = Gravity.CENTER })
            setOnClickListener { startActivity(Intent(this@DashboardActivity, LauncherActivity::class.java)) }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        return col
    }

    private fun select(i: Int) {
        pageIndex = i
        if (i == 1) { refreshNews(); main.post { renderHealth() } }
        pages.forEachIndexed { k, v -> v.visibility = if (k == i) View.VISIBLE else View.GONE }
        railItems.forEachIndexed { k, v -> v.background = if (k == i) ui.rounded(Color.argb(58, 255, 255, 255), Color.argb(120, 255, 255, 255), 18) else null }
    }

    private fun page(content: LinearLayout.() -> Unit): ScrollView {
        val col = ui.column(16).apply { setPadding(ui.dp(30), ui.dp(26), ui.dp(30), ui.dp(48)); content() }
        return ScrollView(this).apply { isVerticalScrollBarEnabled = false; isFillViewport = true; addView(col) }
    }

    private fun heading(title: String, sub: String) = ui.column(2).apply {
        addView(ui.text(title, 30f, Color.WHITE, bold = true)); addView(ui.text(sub, 14f, 0xB3FFFFFF.toInt()))
    }

    /* ── Home ── */

    private fun homePage(): View = page {
        val head = ui.row(16)
        val left = ui.column(2)
        hello = ui.text("", 20f, 0xE6FFFFFF.toInt(), bold = true)
        clock = ui.text("--:--", 78f, Color.WHITE, bold = true).apply { letterSpacing = -0.02f; setShadowLayer(10f, 0f, 3f, 0x99000000.toInt()) }
        date = ui.text("", 18f, 0xCCFFFFFF.toInt())
        left.addView(hello); left.addView(clock); left.addView(date)
        head.addView(ui.fill(left))
        val right = ui.column(10).apply { gravity = Gravity.END }
        weather = ui.text("", 17f, Color.WHITE, bold = true).apply { background = ui.glass(999); setPadding(ui.dp(20), ui.dp(11), ui.dp(20), ui.dp(11)) }
        statusChip = ui.text("", 13f, 0xE6FFFFFF.toInt()).apply { background = ui.glass(999); setPadding(ui.dp(16), ui.dp(8), ui.dp(16), ui.dp(8)) }
        right.addView(weather); right.addView(statusChip)
        head.addView(right)
        addView(head)

        offlineBanner = ui.text("Offline mode: no connection to Stashr. The house still works on the home Wi-Fi.", 14f, ui.c.warn, bold = true).apply {
            background = ui.rounded(0x55000000, ui.c.warn, 16); setPadding(ui.dp(16), ui.dp(11), ui.dp(16), ui.dp(11))
            visibility = if (LocalMode.offline) View.VISIBLE else View.GONE
        }
        addView(offlineBanner)

        coming = ui.glassCard().apply { visibility = View.GONE; background = ui.rounded(Color.argb(70, 14, 127, 109), Color.argb(150, 43, 179, 177), 22) }
        addView(coming)

        val two = ui.row(18).apply { gravity = Gravity.TOP }
        val l = ui.column(18); val r = ui.column(18)

        val ask = ui.glassCard("Ask Stashr", "“Hey Stashr, …” bolo, mic dabao ya type karo. Hindi ya English.", "chat")
        val askRow = ui.row(10)
        val input = ui.input("tv ki awaaz kam karo, arijit ke gaane chalao…").apply { minWidth = 0; minimumWidth = 0; setHorizontallyScrolling(false); imeOptions = EditorInfo.IME_ACTION_SEND; setSingleLine(); setTextColor(Color.WHITE); setHintTextColor(0x99FFFFFF.toInt()); background = ui.glass(999, strong = true); setPadding(ui.dp(20), ui.dp(12), ui.dp(20), ui.dp(12)) }
        val send = ui.pill(null, "send", strong = true) { val t = input.text.toString(); input.setText(""); ask(t) }
        input.setOnEditorActionListener { _, id, _ -> if (id == EditorInfo.IME_ACTION_SEND) { send.performClick(); true } else false }
        micButton = ui.pill("Speak", "mic", strong = true) { listenOnce() }
        askRow.addView(ui.fill(input)); askRow.addView(send)
        ask.addView(askRow)
        val chips = ui.row(8)
        chips.addView(micButton)
        listOf("Who is home" to "kaun ghar par hai", "Status" to "status", "Today's updates" to "today updates", "TV volume down" to "tv volume down", "Good night" to "good night", "Speed test" to "speed test")
            .forEach { (label, sentence) -> chips.addView(ui.pill(label, null) { ask(sentence) }.apply { setPadding(ui.dp(16), ui.dp(9), ui.dp(16), ui.dp(9)); minHeight = ui.dp(40) }) }
        ask.addView(HorizontalScrollView(this@DashboardActivity).apply { isHorizontalScrollBarEnabled = false; addView(chips) })
        reply = ui.text("", 16f, Color.WHITE, bold = true).apply { visibility = View.GONE; background = ui.rounded(0x55000000, Color.argb(70, 255, 255, 255), 18); setPadding(ui.dp(16), ui.dp(12), ui.dp(16), ui.dp(12)) }
        ask.addView(reply)
        l.addView(ask)

        val homeScenesCard = ui.glassCard("Scenes", "Ek tap, kai commands", "bolt")
        homeScenes = ui.row(8)
        homeScenesCard.addView(HorizontalScrollView(this@DashboardActivity).apply { isHorizontalScrollBarEnabled = false; addView(homeScenes) })
        l.addView(homeScenesCard)

        safar = ui.glassCard("Safar", null, "pin").apply { visibility = View.GONE }
        l.addView(safar)

        val peopleCard = ui.glassCard("Who is home", null, "users")
        people = ui.column(8)
        peopleCard.addView(people)
        r.addView(peopleCard)

        val tvCard = ui.glassCard("TV", null, "tv")
        tv = ui.column(6)
        tvCard.addView(tv)
        val mini = ui.row(8)
        mini.addView(ui.pill(null, "pause") { cmd("tv pause", "Play / pause") })
        mini.addView(ui.pill(null, "vol_down") { cmd("tv volume down", "Volume down") })
        mini.addView(ui.pill(null, "vol_up") { cmd("tv volume up", "Volume up") })
        mini.addView(ui.pill(null, "mute") { cmd("tv mute", "Mute") })
        mini.addView(ui.pill(null, "home") { cmd("tv home", "TV home") })
        tvCard.addView(HorizontalScrollView(this@DashboardActivity).apply { isHorizontalScrollBarEnabled = false; addView(mini) })
        r.addView(tvCard)

        two.addView(l, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.35f))
        two.addView(r, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(two)
    }

    /* ── Updates ── */

    private fun updatesPage(): View = page {
        addView(heading("Updates", "Sab kuch jo ghar mein chal raha hai"))
        val two = ui.row(18).apply { gravity = Gravity.TOP }
        val l = ui.column(18); val r = ui.column(18)
        val evCard = ui.glassCard("What happened", "Latest at home", "bell")
        events = ui.column(10)
        evCard.addView(events)
        l.addView(evCard)
        val statCard = ui.glassCard("TV time and internet", null, "speed")
        today = ui.column(8)
        statCard.addView(today)
        r.addView(statCard)
        val newsCard = ui.glassCard("Today's news", "From Stashr, refreshed every few minutes", "chat")
        newsList = ui.column(10)
        newsCard.addView(newsList)
        r.addView(newsCard)
        two.addView(l, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        two.addView(r, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(two)
    }

    /* ── Control ── */

    private fun controlPage(): View = page {
        addView(heading("Control", "TV, camera, scenes aur tablet, ek hi jagah se"))
        val two = ui.row(18).apply { gravity = Gravity.TOP }
        val l = ui.column(18); val r = ui.column(18)

        val remote = ui.glassCard("TV remote", "Sab buttons assistant ke commands hain", "tv")
        val r1 = ui.row(8); val r2 = ui.row(8)
        r1.addView(ui.pill(null, "prev") { cmd("tv previous", "Previous") }); r1.addView(ui.pill(null, "pause") { cmd("tv pause", "Play / pause") }); r1.addView(ui.pill(null, "next") { cmd("tv next", "Next") })
        r1.addView(ui.pill(null, "vol_down") { cmd("tv volume down", "Volume down") }); r1.addView(ui.pill(null, "vol_up") { cmd("tv volume up", "Volume up") }); r1.addView(ui.pill(null, "mute") { cmd("tv mute", "Mute") })
        r2.addView(ui.pill("TV home", "home") { cmd("tv home", "TV home") }); r2.addView(ui.pill("Back", "back") { cmd("back", "Back") })
        remote.addView(HorizontalScrollView(this@DashboardActivity).apply { isHorizontalScrollBarEnabled = false; addView(r1) })
        remote.addView(r2)
        val apps = ui.row(8)
        listOf("Netflix", "YouTube", "Prime Video", "JioHotstar").forEach { n -> apps.addView(ui.pill(n, null) { cmd("open $n on tv", n) }) }
        remote.addView(HorizontalScrollView(this@DashboardActivity).apply { isHorizontalScrollBarEnabled = false; addView(apps) })
        l.addView(remote)

        val sceneCard = ui.glassCard("Scenes", "Ek tap, kai commands", "bolt")
        scenes = ui.row(8)
        sceneCard.addView(HorizontalScrollView(this@DashboardActivity).apply { isHorizontalScrollBarEnabled = false; addView(scenes) })
        l.addView(sceneCard)

        val tab = ui.glassCard("This tablet", "Camera, screen aur extras", "camera")
        val t1 = ui.row(8); val t2 = ui.row(8)
        t1.addView(ui.pill("Screen off now", "power", strong = true) { screenOffNow() })
        t1.addView(ui.pill("Photo", "camera") { cmd("camera photo", "Taking a photo") })
        t1.addView(ui.pill("Live camera", "camera") { cmd("camera live", "Live view on for 2 minutes") })
        t2.addView(ui.pill("Slideshow", "image") { startActivity(Intent(this@DashboardActivity, SlideshowActivity::class.java)) })
        t2.addView(ui.pill("Speed test", "speed") { cmd("speed test", "Speed test") })
        t2.addView(ui.pill("Today's news", "chat") { cmd("today updates", "Today's updates") })
        tab.addView(HorizontalScrollView(this@DashboardActivity).apply { isHorizontalScrollBarEnabled = false; addView(t1) })
        tab.addView(HorizontalScrollView(this@DashboardActivity).apply { isHorizontalScrollBarEnabled = false; addView(t2) })
        r.addView(tab)

        val sw = ui.glassCard("Quick switches", null, "sliders")
        cameraSwitch = switch("Camera alerts: send a photo when someone comes into view", prefs.cameraArmed) { on ->
            if (on) CameraWatch.arm() else CameraWatch.disarm()
        }
        voiceSwitch = switch("Listen for “Hey Stashr”", prefs.voiceOn) { on ->
            prefs.voiceOn = on
            if (on) VoiceListener.start(this@DashboardActivity) else VoiceListener.stop()
        }
        val darkSwitch = switch("Keep the screen off (saves battery): it sleeps by itself and goes back to sleep after a WhatsApp message or announcement. Camera, voice and live view keep working.", prefs.screenOffAfter) { on ->
            prefs.screenOffAfter = on
            applyPower()
        }
        val saverSwitch = switch("Power saving (always): scan the Wi-Fi less often, dim the screen and let it sleep", prefs.batterySaver) { on ->
            prefs.batterySaver = on
            applyPower()
        }
        sw.addView(cameraSwitch); sw.addView(voiceSwitch); sw.addView(darkSwitch); sw.addView(saverSwitch)
        r.addView(sw)

        two.addView(l, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.15f))
        two.addView(r, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(two)
    }

    /* ── Settings ── */

    private fun settingsPage(): View = page {
        addView(heading("Settings", "Is tablet ki sthiti aur setup"))
        val two = ui.row(18).apply { gravity = Gravity.TOP }
        val l = ui.column(18); val r = ui.column(18)

        val ctl = ui.glassCard("Stashr Hub · " + prefs.deviceName.ifEmpty { "Home" }, null, "home")
        statusLine = ui.text("", 13f, 0xCCFFFFFF.toInt())
        ctl.addView(statusLine)
        checkBox = ui.column(4)
        ctl.addView(checkBox)
        val barSwitch = switch("Fullscreen: hide the status bar and the Back/Home buttons while Stashr is open (swipe from the edge to show them)", prefs.hideStatusBar) { on ->
            prefs.hideStatusBar = on
            applyFullscreen()
        }
        ctl.addView(barSwitch)
        val buttons = ui.row(8)
        buttons.addView(ui.pill("Check for update", null) {
            scope.launch {
                statusLine.text = "Checking for an update…"
                val msg = try { Updater.check(this@DashboardActivity, manual = true) } catch (e: Exception) { e.message ?: "Update check failed" }
                statusLine.text = msg
            }
        })
        buttons.addView(ui.pill("Unpair", null) { unpair() })
        ctl.addView(HorizontalScrollView(this@DashboardActivity).apply { isHorizontalScrollBarEnabled = false; addView(buttons) })
        l.addView(ctl)

        val wa = ui.glassCard("WhatsApp messages", "Lets Stashr send “arrived / left” to a WhatsApp group from this tablet", "chat")
        waState = ui.text("", 15f, Color.WHITE)
        wa.addView(waState)
        wa.addView(ui.text("Needs: WhatsApp signed in here, Stashr Hub switched on in Accessibility, and no lock-screen PIN (swipe or none). On Android 13+ for an app installed from a file: Settings → Apps → Stashr Hub → ⋮ → Allow restricted settings, then turn it on.", 12f, 0xAAFFFFFF.toInt()))
        wa.addView(ui.pill("Open Accessibility settings", "gear") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) })
        val waGroup = ui.input("WhatsApp group name").apply { setTextColor(Color.WHITE); setHintTextColor(0x99FFFFFF.toInt()); background = ui.glass(16, strong = true) }
        val waText = ui.input("Message", "Reached office").apply { setTextColor(Color.WHITE); setHintTextColor(0x99FFFFFF.toInt()); background = ui.glass(16, strong = true) }
        wa.addView(waGroup); wa.addView(waText)
        waResult = ui.text("", 13f, 0xCCFFFFFF.toInt())
        wa.addView(ui.pill("Send a test message", "send", strong = true) {
            waResult.text = "Sending…"
            scope.launch {
                waResult.text = try { com.tanush.stashr.hub.whatsapp.WhatsAppSender.send(this@DashboardActivity, waGroup.text.toString(), waText.text.toString()) } catch (e: Exception) { e.message ?: "Failed" }
            }
        })
        wa.addView(waResult)
        r.addView(wa)

        two.addView(l, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        two.addView(r, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(two)
    }

    @SuppressLint("UseSwitchCompatOrMaterialCode")
    private fun switch(label: String, checked: Boolean, onChange: (Boolean) -> Unit) = Switch(this).apply {
        text = label; isChecked = checked; setTextColor(Color.WHITE); textSize = 14f
        minHeight = ui.dp(48)
        setOnCheckedChangeListener { _, on -> onChange(on) }
    }

    /** A short line at the bottom that says what a button just did. */
    private fun toast(msg: String) {
        toastLine.text = msg
        toastLine.visibility = View.VISIBLE
        main.removeCallbacks(hideToast)
        main.postDelayed(hideToast, 3_500)
    }
    private val hideToast = Runnable { toastLine.visibility = View.GONE }

    /** Puts the tablet screen to sleep now (the Hub's Accessibility service does the locking). */
    private fun screenOffNow() {
        val svc = com.tanush.stashr.hub.whatsapp.WhatsAppAccessibility.instance
        if (Build.VERSION.SDK_INT < 28 || svc == null) { toast("Turn on Stashr Hub in Accessibility settings first"); return }
        toast("Screen off")
        main.postDelayed({ svc.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN) }, 600)
    }

    /* ───────── data ───────── */

    /** Power saving on: the screen may sleep and is dimmed while it is on. Off: always on, normal brightness. */
    private fun applyPower() {
        val saving = com.tanush.stashr.hub.core.Power.saving(this)
        if (saving || prefs.screenOffAfter) window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val lp = window.attributes
        val want = if (saving) 0.25f else WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        if (lp.screenBrightness != want) { lp.screenBrightness = want; window.attributes = lp }
    }

    private fun tick() {
        applyPower()
        val now = Date()
        clock.text = clockFmt.format(now)
        date.text = dateFmt.format(now)
        hello.text = greeting()
        val ago = if (HubService.lastReport > 0) agoText(HubService.lastReport) else "not yet"
        val err = HubService.lastError
        statusChip.text = if (LocalMode.offline) "● Offline · home Wi-Fi only" else if (err.isNotEmpty()) "● Problem: " + err.take(40) else "● Connected · reported $ago"
        statusChip.setTextColor(if (LocalMode.offline || err.isNotEmpty()) ui.c.warn else 0xFF7FE8B2.toInt())
        statusLine.text = buildString {
            append("Reported to Stashr: ").append(ago)
            if (err.isNotEmpty()) append(" · problem: ").append(err)
            append(" · camera ").append(if (prefs.cameraArmed) "watching" else "off")
            append(" · voice ").append(VoiceListener.status())
            if (Updater.waiting) append(" · an update is waiting for your tap")
        }
        renderHealth()
        waState.text = if (com.tanush.stashr.hub.whatsapp.WhatsAppSender.serviceOn()) "● Accessibility is on: ready" else "○ Accessibility is off"
        if (cameraSwitch.isChecked != prefs.cameraArmed) cameraSwitch.isChecked = prefs.cameraArmed
        if (slideshowReady && resumed && System.currentTimeMillis() - lastTouch > 10 * 60_000) {
            lastTouch = System.currentTimeMillis()
            startActivity(Intent(this, SlideshowActivity::class.java))
        }
        main.postDelayed({ tick() }, 5_000)
    }

    private fun greeting(): String {
        val h = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        val who = prefs.deviceName.ifEmpty { "" }
        val g = when (h) { in 5..11 -> "Good morning"; in 12..16 -> "Good afternoon"; in 17..21 -> "Good evening"; else -> "Good night" }
        return g
    }

    /** The tablet's own health at a glance: battery, Wi-Fi, camera, voice and the app version. Shown on the Updates page. */
    private fun renderHealth() {
        if (!::healthList.isInitialized || pageIndex != 1) return
        healthList.removeAllViews()
        val bat = com.tanush.stashr.hub.core.DeviceInfo.battery(this)
        val pct = bat.optInt("pct", -1); val charging = bat.optBoolean("charging")
        fun row(label: String, value: String, tint: Int) {
            val r = ui.row(10)
            r.addView(ui.dot(tint))
            r.addView(ui.fill(ui.text(label, 14f, 0xCCFFFFFF.toInt())))
            r.addView(ui.text(value, 14f, Color.WHITE, bold = true))
            healthList.addView(r)
        }
        row("Battery", if (pct >= 0) "$pct%" + if (charging) " · charging" else "" else "unknown", if (pct in 0..20 && !charging) ui.c.danger else if (pct in 21..40 && !charging) ui.c.warn else ui.c.ok)
        val rssi = com.tanush.stashr.hub.core.DeviceInfo.wifiRssi(this)
        row("Wi-Fi", if (rssi < 0) "$rssi dBm" else "not connected", if (rssi in -67..-1) ui.c.ok else if (rssi < -67) ui.c.warn else ui.c.faint)
        row("Camera alerts", if (prefs.cameraArmed) "watching" else "off", if (prefs.cameraArmed) ui.c.ok else ui.c.faint)
        row("Voice (“Hey Stashr”)", VoiceListener.status(), ui.c.ok)
        row("Stashr Hub", "v" + com.tanush.stashr.hub.BuildConfig.VERSION_NAME + if (Updater.waiting) " · update waiting" else "", if (Updater.waiting) ui.c.warn else ui.c.ok)
    }

    private fun refresh() {
        thread {
            try {
                val d = Api(this).dashboard()
                LocalMode.saveDashboard(this, d.toString())
                main.post { render(d) }
            } catch (e: Exception) {
                // No server: show the last dashboard that did arrive.
                val cached = LocalMode.cachedDashboard(this)
                main.post {
                    if (cached != null) render(cached)
                    else if (weather.text.isEmpty()) weather.text = "Could not reach Stashr"
                }
            }
        }
        main.postDelayed({ refresh() }, 30_000)
    }

    private var newsAt = 0L
    private fun refreshNews() {
        if (System.currentTimeMillis() - newsAt < 4 * 60_000) return
        newsAt = System.currentTimeMillis()
        thread {
            try {
                val lines = Api(this).today().optJSONArray("lines") ?: JSONArray()
                main.post {
                    newsList.removeAllViews()
                    if (lines.length() == 0) newsList.addView(ui.text("Nothing new yet.", 14f, 0xAAFFFFFF.toInt()))
                    for (i in 0 until minOf(lines.length(), 12)) {
                        val l = lines.getJSONObject(i)
                        newsList.addView(ui.text(l.optString("icon") + "  " + l.optString("text"), 15f, Color.WHITE))
                    }
                }
            } catch (e: Exception) { newsAt = 0L }
        }
    }

    private fun render(d: JSONObject) {
        offlineBanner.visibility = if (LocalMode.offline) View.VISIBLE else View.GONE
        safar.removeAllViews()
        val nudges = d.optJSONArray("nudges") ?: JSONArray(); val trips = d.optJSONArray("trips") ?: JSONArray()
        safar.visibility = if (nudges.length() + trips.length() > 0) View.VISIBLE else View.GONE
        if (safar.visibility == View.VISIBLE) {
            safar.addView(ui.text("Safar", 17f, Color.WHITE, bold = true))
            for (i in 0 until nudges.length()) safar.addView(ui.text(nudges.optString(i), 15f, Color.WHITE, bold = true))
            for (i in 0 until trips.length()) safar.addView(ui.text(trips.optString(i), 13f, 0xB3FFFFFF.toInt()))
        }
        val soon = d.optJSONArray("coming") ?: JSONArray()
        coming.removeAllViews()
        coming.visibility = if (soon.length() > 0) View.VISIBLE else View.GONE
        for (i in 0 until soon.length()) {
            val c = soon.getJSONObject(i)
            val m = c.optInt("minutes")
            coming.addView(ui.text("🚗  " + if (m <= 1) "${c.optString("person")} bas pahunchne wale hain" else "${c.optString("person")} $m minute mein aa rahe hain", 24f, Color.WHITE, bold = true))
            coming.addView(ui.text(String.format(Locale.US, "%.1f km door", c.optDouble("km")), 14f, 0xCCFFFFFF.toInt()))
        }
        val w = d.optJSONObject("weather")
        weather.text = if (w != null) "${w.optString("city").substringBefore(",")}  ${w.optInt("temp")}°C · ${w.optString("text")}" +
            (if (!w.isNull("rainChance")) " · ${w.optInt("rainChance")}% rain" else "") else "Set your city for the weather"

        people.removeAllViews()
        val ps = d.optJSONArray("people") ?: JSONArray()
        if (ps.length() == 0) people.addView(ui.text("Give a Wi-Fi device a person on the Smart home page, or pair a family phone.", 13f, 0xB3FFFFFF.toInt()))
        else {
            val row = ui.row(14)
            for (i in 0 until ps.length()) {
                val p = ps.getJSONObject(i)
                val home = p.optBoolean("home")
                val col = ui.column(4).apply { gravity = Gravity.CENTER_HORIZONTAL }
                val av = ui.text(p.optString("person").take(1).uppercase(), 20f, Color.WHITE, bold = true).apply {
                    gravity = Gravity.CENTER; layoutParams = LinearLayout.LayoutParams(ui.dp(54), ui.dp(54))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        shape = android.graphics.drawable.GradientDrawable.OVAL
                        setColor(if (home) Color.argb(110, 48, 164, 108) else Color.argb(50, 255, 255, 255))
                        setStroke(ui.dp(2), if (home) 0xFF30A46C.toInt() else Color.argb(90, 255, 255, 255))
                    }
                }
                col.addView(av)
                // Two phones can share a first name ("Tanush F21", "Tanush Oppo A38"): show the whole name, on up to two lines.
                col.addView(ui.text(p.optString("person"), 13f, Color.WHITE, bold = true).apply { gravity = Gravity.CENTER; maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END; layoutParams = LinearLayout.LayoutParams(ui.dp(84), ViewGroup.LayoutParams.WRAP_CONTENT) })
                col.addView(ui.text(if (home) "home" else "out", 11f, if (home) 0xFF7FE8B2.toInt() else 0x99FFFFFF.toInt()))
                row.addView(col)
            }
            people.addView(HorizontalScrollView(this@DashboardActivity).apply { isHorizontalScrollBarEnabled = false; addView(row) })
        }

        tv.removeAllViews()
        val tvs = d.optJSONArray("tvs") ?: JSONArray()
        if (tvs.length() == 0) tv.addView(ui.text("No TV yet.", 13f, 0xB3FFFFFF.toInt()))
        for (i in 0 until tvs.length()) {
            val t = tvs.getJSONObject(i)
            val line = ui.row(10)
            val on = t.optBoolean("online") && t.optString("screen") != "off"
            line.addView(ui.dot(if (on) ui.c.ok else if (t.optBoolean("online")) ui.c.warn else ui.c.faint))
            val what = when {
                !t.optBoolean("online") -> "off"
                !on -> "standby"
                t.optString("title").isNotEmpty() -> t.optString("title") + (if (t.optString("app").isNotEmpty()) " · " + t.optString("app") else "")
                t.optString("app").isNotEmpty() -> t.optString("app")
                else -> "on"
            }
            line.addView(ui.text("${t.optString("name")}: $what", 15f, Color.WHITE))
            tv.addView(line)
        }

        today.removeAllViews()
        val mins = d.optInt("tvMinutesToday")
        today.addView(ui.text("📺  TV today: " + if (mins >= 60) "${mins / 60} h ${mins % 60} min" else "$mins min", 16f, Color.WHITE))
        val sp = d.optJSONObject("speed")
        today.addView(ui.text(if (sp != null) "🚀  Internet: ${sp.optDouble("down")} Mbit/s down · ${sp.optDouble("up")} up · ${sp.optInt("ping")} ms" else "🚀  Internet: first speed test soon", 16f, Color.WHITE))
        today.addView(ui.text("Tablet health", 15f, Color.WHITE, bold = true).apply { setPadding(0, ui.dp(10), 0, 0) })
        healthList = ui.column(8)
        today.addView(healthList)
        renderHealth()

        events.removeAllViews()
        val ev = d.optJSONArray("events") ?: JSONArray()
        if (ev.length() == 0) events.addView(ui.text("Nothing yet.", 14f, 0xAAFFFFFF.toInt()))
        for (i in 0 until minOf(ev.length(), 12)) {
            val e = ev.getJSONObject(i)
            val row = ui.row(12)
            row.gravity = Gravity.TOP
            val at = try { Instant.parse(e.optString("at")).toEpochMilli() } catch (x: Exception) { 0L }
            row.addView(ui.text(if (at > 0) agoText(at) else "", 12f, 0x99FFFFFF.toInt()).apply { minWidth = ui.dp(76) })
            row.addView(ui.fill(ui.text(e.optString("text"), 15f, Color.WHITE)))
            events.addView(row)
        }

        scenes.removeAllViews(); homeScenes.removeAllViews()
        val sc = d.optJSONArray("scenes") ?: JSONArray()
        if (sc.length() == 0) { for (row in listOf(scenes, homeScenes)) row.addView(ui.text("No scenes yet. Make them on the Smart home page.", 13f, 0xB3FFFFFF.toInt())) }
        for (i in 0 until sc.length()) {
            val s = sc.getJSONObject(i)
            for (row in listOf(scenes, homeScenes)) row.addView(ui.pill(s.optString("name"), "bolt", strong = true) { runScene(s.optString("id"), s.optString("name")) })
        }

        val cfg = d.optJSONObject("config")
        val cam = cfg?.optJSONObject("camera")
        if (cam != null) CameraWatch.applyConfig(cam.optInt("sensitivity", 5), cam.optBoolean("video", true))
        slideshowReady = cfg?.optBoolean("slideshow") == true
    }

    private fun runScene(id: String, name: String) {
        thread {
            val local = { val n = LocalMode.runScene(this, id); if (n > 0) "$name: ran $n step${if (n > 1) "s" else ""} on the home Wi-Fi (offline mode)." else "$name: nothing could run without the server." }
            val msg = if (LocalMode.offline) local() else try { val n = Api(this).runScene(id).optInt("sent"); if (n > 0) "$name: sent $n command${if (n > 1) "s" else ""}." else "$name: no device is ready." }
                catch (e: java.io.IOException) { if (e is com.tanush.stashr.hub.core.ApiError) (e.message ?: "Could not run it.") else local() }
                catch (e: Exception) { e.message ?: "Could not run it." }
            main.post { toast(msg) }
        }
    }

    /** A button that sends one of the assistant's own sentences and says what happened at the bottom of the screen. */
    private fun cmd(sentence: String, label: String) {
        toast("$label…")
        thread {
            val r = if (LocalMode.offline) LocalMode.answer(this, sentence) else try { Api(this).assistant(sentence).optString("reply", "Done.") }
                catch (e: java.io.IOException) { if (e is com.tanush.stashr.hub.core.ApiError) (e.message ?: "Could not reach Stashr.") else LocalMode.answer(this, sentence) }
                catch (e: Exception) { e.message ?: "Could not reach Stashr." }
            main.post { toast(r.take(120)) }
        }
    }

    private fun ask(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        showReply(t, "…")
        thread {
            val r = if (LocalMode.offline) LocalMode.answer(this, t) else try { Api(this).assistant(t).optString("reply", "Done.") }
                catch (e: java.io.IOException) { if (e is com.tanush.stashr.hub.core.ApiError) (e.message ?: "Could not reach Stashr.") else LocalMode.answer(this, t) }
                catch (e: Exception) { e.message ?: "Could not reach Stashr." }
            main.post { showReply(t, r) }
        }
    }

    private fun showReply(heard: String, text: String) {
        if (pageIndex != 0 && text.isNotEmpty()) toast(text.take(120))
        reply.visibility = View.VISIBLE
        reply.text = if (heard.isNotEmpty()) "“$heard”\n$text" else text
    }

    /** One spoken command from the mic button. The "Hey Stashr" listener pauses meanwhile, since the mic is shared. */
    private fun listenOnce() {
        if (!granted(Manifest.permission.RECORD_AUDIO)) { requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_PERMS); return }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { showReply("", "Speech recognition is not available on this tablet. Install the Google app."); return }
        VoiceListener.stop()
        oneShot?.destroy()
        val rec = SpeechRecognizer.createSpeechRecognizer(this)
        oneShot = rec
        micButton.text = "Listening…"
        rec.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onError(error: Int) { done(); showReply("", "Did not catch that. Tap the mic and try again.") }
            override fun onResults(results: Bundle?) {
                done()
                val said = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (said.isNotBlank()) ask(VoiceListener.afterWake(said)?.ifEmpty { null } ?: said)
            }
        })
        rec.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN")
            putExtra("android.speech.extra.EXTRA_ADDITIONAL_LANGUAGES", arrayOf("en-IN"))
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
        })
    }

    private fun done() {
        micButton.text = "Speak"
        oneShot?.destroy(); oneShot = null
        if (prefs.voiceOn) main.postDelayed({ VoiceListener.start(this) }, 800)
    }

    private fun unpair() {
        AlertDialog.Builder(this)
            .setTitle("Unpair this tablet?")
            .setMessage("It stops reporting to Stashr. To bring it back, make a new code on the Smart home page.")
            .setPositiveButton("Unpair") { _, _ ->
                prefs.forget()
                stopService(Intent(this, HubService::class.java))
                startActivity(Intent(this, SetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                finish()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    /* ───────── permissions ───────── */

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun askPermissions() {
        val want = mutableListOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) want.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = want.filter { !granted(it) }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), REQ_PERMS) else askBattery()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_PERMS) return
        // The service's foreground types (camera, microphone) are fixed when it starts: restart it with the new grants.
        stopService(Intent(this, HubService::class.java))
        main.postDelayed({ HubService.start(this) }, 500)
        askBattery()
    }

    @SuppressLint("BatteryLife")
    private fun askBattery() {
        val pm = getSystemService(PowerManager::class.java) ?: return
        if (pm.isIgnoringBatteryOptimizations(packageName)) { askOverlay(); return }
        val p = getSharedPreferences("dashboard", MODE_PRIVATE)
        // Without this exemption Android may cut the tablet's network while it is unplugged and the screen is off, so Stashr shows it offline.
        // So the question comes back once a day until it is allowed.
        val now = System.currentTimeMillis()
        if (now - p.getLong("askedBatteryAt", 0L) < 24 * 3600_000L) return
        p.edit().putLong("askedBatteryAt", now).apply()
        try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) } catch (e: Exception) { }
    }

    /** Lets the app open its screens (today's updates, the slideshow) when Stashr asks, while another app is showing. */
    private fun askOverlay() {
        if (Settings.canDrawOverlays(this)) return
        val p = getSharedPreferences("dashboard", MODE_PRIVATE)
        if (p.getBoolean("askedOverlay", false)) return
        p.edit().putBoolean("askedOverlay", true).apply()
        try { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) } catch (e: Exception) { }
    }

    /* ───────── lifecycle ───────── */

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean { lastTouch = System.currentTimeMillis(); return super.dispatchTouchEvent(ev) }
    override fun onResume() { super.onResume(); resumed = true; lastTouch = System.currentTimeMillis(); renderChecks(); applyFullscreen() }

    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) applyFullscreen() }

    private fun applyFullscreen() = com.tanush.stashr.hub.core.SystemBars.apply(this, prefs.hideStatusBar)

    /** "Check": what is not set up on this tablet, red first, with where to switch it on. Nothing is shown when all is well. */
    private fun renderChecks() {
        if (!::checkBox.isInitialized) return
        checkBox.removeAllViews()
        val problems = Health.problems(this)
        if (problems.isEmpty()) return
        checkBox.addView(ui.text("Check", 14f, Color.WHITE, bold = true))
        for (p in problems) {
            checkBox.addView(ui.text((if (p.red) "● " else "○ ") + p.label, 13f, if (p.red) 0xFFFF8A8E.toInt() else 0xE6FFFFFF.toInt(), bold = p.red))
            checkBox.addView(ui.text(p.fix, 12f, 0xB3FFFFFF.toInt()))
        }
    }
    /** The Home button while this is the home app: back to the first page. */
    override fun onNewIntent(intent: Intent?) { super.onNewIntent(intent); if (pages.isNotEmpty()) select(0) }

    /** A home screen has nowhere to go back to. */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (pages.isNotEmpty() && pageIndex != 0) select(0) }

    override fun onPause() { resumed = false; super.onPause() }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        scope.cancel()
        oneShot?.destroy()
        try { unregisterReceiver(voiceReceiver) } catch (e: Exception) { }
        try { unregisterReceiver(stateReceiver) } catch (e: Exception) { }
        super.onDestroy()
    }

    private fun agoText(ms: Long): String {
        val s = (System.currentTimeMillis() - ms) / 1000
        return when { s < 45 -> "just now"; s < 3600 -> "${s / 60} min ago"; s < 86400 -> "${s / 3600} h ago"; else -> "${s / 86400} d ago" }
    }

    companion object { private const val REQ_PERMS = 7 }
}
