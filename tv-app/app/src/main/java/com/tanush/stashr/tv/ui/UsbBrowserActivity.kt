package com.tanush.stashr.tv.ui

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.tanush.stashr.tv.core.Logic
import com.tanush.stashr.tv.core.Ui
import java.io.File
import kotlin.concurrent.thread

/**
 * Opens the pendrive like a folder: every plugged-in drive, then its folders and files with the remote's arrows.
 * OK opens a folder or plays a video / song. Long-press OK (or Menu) offers to delete the file. Back goes up one folder.
 */
class UsbBrowserActivity : Activity() {
    private lateinit var ui: Ui
    private lateinit var list: LinearLayout
    private lateinit var title: TextView
    private lateinit var scroll: ScrollView
    private val main = Handler(Looper.getMainLooper())
    /** null = the list of drives. */
    private var dir: File? = null
    private var rootOfDir: File? = null
    private val media = setOf("mp4", "mkv", "avi", "mov", "webm", "m4v", "ts", "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = Ui(this)
        title = ui.text("", 26f, Color.WHITE, bold = true).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.MIDDLE }
        list = ui.column(6)
        scroll = ScrollView(this).apply { addView(list); isFillViewport = true }
        val col = ui.column(14).apply {
            setPadding(ui.dp(56), ui.dp(32), ui.dp(56), ui.dp(24))
            addView(ui.text("USB DRIVE", 14f, 0xB3FFFFFF.toInt(), bold = true).apply { letterSpacing = 0.14f })
            addView(title)
            addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(ui.text("OK: open or play   ·   Hold OK / Menu: delete   ·   Back: up", 16f, 0x99FFFFFF.toInt()))
        }
        setContentView(col.apply { setBackgroundColor(0xFF0B1E2A.toInt()) })
        if (!allFilesAllowed()) askAllFiles()
        show(null)
    }

    override fun onResume() { super.onResume(); show(dir) }

    private fun allFilesAllowed() = Build.VERSION.SDK_INT < 30 || Environment.isExternalStorageManager()

    private fun askAllFiles() {
        try {
            startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, android.net.Uri.parse("package:$packageName")))
        } catch (e: Exception) { /* no settings page on this TV: the message below says how */ }
    }

    /** The root of each mounted removable drive. */
    private fun roots(): List<File> =
        getExternalFilesDirs(null).filterNotNull()
            .filter { try { Environment.isExternalStorageRemovable(it) } catch (e: Exception) { false } }
            .mapNotNull { f -> f.path.substringBefore("/Android/data").takeIf { it != f.path }?.let { File(it) } }

    private fun driveName(root: File): String =
        (try { (getSystemService(Context.STORAGE_SERVICE) as android.os.storage.StorageManager).getStorageVolume(root)?.getDescription(this) } catch (e: Exception) { null })
            ?.takeIf { it.isNotBlank() } ?: root.name

    private fun row(text: String, sub: String, onOpen: () -> Unit, onMenu: (() -> Unit)? = null): View = ui.column(2).apply {
        isFocusable = true; isClickable = true
        background = ui.glass(14); setPadding(ui.dp(20), ui.dp(10), ui.dp(20), ui.dp(10))
        addView(ui.text(text, 21f, Color.WHITE, bold = true).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
        if (sub.isNotEmpty()) addView(ui.text(sub, 14f, 0xCCFFFFFF.toInt()))
        setOnClickListener { onOpen() }
        if (onMenu != null) { setOnLongClickListener { onMenu(); true }; setOnKeyListener { _, k, e -> if (k == KeyEvent.KEYCODE_MENU && e.action == KeyEvent.ACTION_UP) { onMenu(); true } else false } }
        setOnFocusChangeListener { v, f -> v.animate().scaleX(if (f) 1.02f else 1f).scaleY(if (f) 1.02f else 1f).setDuration(120).start() }
    }

    private fun show(d: File?) {
        dir = d
        list.removeAllViews()
        if (!allFilesAllowed()) {
            title.text = "Allow access to files"
            list.addView(ui.text("Stashr TV needs \"All files access\" to open the pendrive.\nSettings → Apps → Stashr TV → Permissions → Files and media → Allow management of all files.", 20f, 0xFFFFE08A.toInt()))
            return
        }
        if (d == null) {
            val r = roots()
            title.text = if (r.isEmpty()) "No pendrive found" else "${r.size} pendrive${if (r.size > 1) "s" else ""}"
            if (r.isEmpty()) list.addView(ui.text("Plug a pendrive into the TV, then open this again.", 20f, 0xDDFFFFFF.toInt()))
            // One drive: go straight into it.
            if (r.size == 1) { rootOfDir = r[0]; show(r[0]); return }
            for (f in r) list.addView(row(driveName(f), "${Logic.size(try { android.os.StatFs(f.path).availableBytes } catch (e: Exception) { 0L })} free", { rootOfDir = f; show(f) }))
            list.getChildAt(0)?.requestFocus()
            return
        }
        title.text = d.path.removePrefix("/storage/")
        val items = (d.listFiles() ?: emptyArray()).filter { !it.name.startsWith(".") && it.name != "LOST.DIR" && it.name != "System Volume Information" }
            .sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase() }))
        if (items.isEmpty()) list.addView(ui.text("This folder is empty", 20f, 0xDDFFFFFF.toInt()))
        for (f in items) {
            val isDir = f.isDirectory
            val ext = f.extension.lowercase()
            val sub = if (isDir) "Folder" else Logic.size(f.length())
            list.addView(row((if (isDir) "📁  " else "") + f.name, sub, {
                when {
                    isDir -> show(f)
                    ext in media -> startActivity(Intent(this, PlayerActivity::class.java).putExtra(PlayerActivity.EXTRA_PATH, f.path))
                }
            }, { confirmDelete(f) }))
        }
        list.getChildAt(0)?.requestFocus()
        scroll.scrollTo(0, 0)
    }

    private fun confirmDelete(f: File) {
        val what = if (f.isDirectory) "folder \"${f.name}\" and everything inside it" else "\"${f.name}\" (${Logic.size(f.length())})"
        AlertDialog.Builder(this).setTitle("Delete from the pendrive?").setMessage("This permanently deletes the $what. It cannot be undone.")
            .setPositiveButton("Delete") { _, _ -> thread { val ok = if (f.isDirectory) f.deleteRecursively() else f.delete(); main.post { if (!ok) android.widget.Toast.makeText(this, "Could not delete it", android.widget.Toast.LENGTH_LONG).show(); show(dir) } } }
            .setNegativeButton("Keep", null).show().getButton(AlertDialog.BUTTON_NEGATIVE)?.requestFocus()
    }

    override fun onBackPressed() {
        val d = dir
        val root = rootOfDir
        when {
            d == null || root == null -> finish()
            d.path == root.path -> if (roots().size > 1) show(null) else finish()
            else -> show(d.parentFile ?: root)
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // The remote's Google Play button does the same thing here as on the home screen: stay on the pendrive.
        if (event.keyCode == KeyEvent.KEYCODE_BUTTON_2) return true
        return super.dispatchKeyEvent(event)
    }
}
