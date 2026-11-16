package com.tanush.stashr.tv.sync

import android.content.Context
import android.os.Environment
import android.os.StatFs
import com.tanush.stashr.tv.core.Api
import com.tanush.stashr.tv.core.Logic
import com.tanush.stashr.tv.core.Prefs
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean

/** One movie on the storage. */
data class Movie(val name: String, val size: Long, val file: File, val synced: Boolean)

/** Where the movies live (the USB drive when there is one), and which of them this app downloaded. */
object MovieStore {
    private const val FOLDER = "Stashr Movies"
    private const val INDEX = ".stashr-index.json"

    /** Every removable volume (each pendrive / SD card) that is plugged in, else the app's own folder on internal storage. */
    private fun roots(ctx: Context): List<File> {
        val all = ctx.getExternalFilesDirs(null).filterNotNull()
        val usb = all.filter { try { Environment.isExternalStorageRemovable(it) } catch (e: Exception) { false } }
        return usb.ifEmpty { listOf(all.firstOrNull() ?: ctx.filesDir) }
    }

    /** The movie folder on every drive, in plug-in order. With no pendrive this is just the internal folder. */
    fun dirs(ctx: Context): List<File> = roots(ctx).map { File(it, FOLDER).also { d -> d.mkdirs() } }

    /** The first drive's folder (kept for callers that only need one). */
    fun dir(ctx: Context): File = dirs(ctx).first()

    /** Where to download [name] of [size] bytes: the drive already holding its half file, else the first drive with room, so a full pendrive falls through to the next. Null when none has room. */
    fun dirFor(ctx: Context, name: String, size: Long): File? {
        val dirs = dirs(ctx)
        dirs.firstOrNull { File(it, "$name.part").exists() }?.let { return it }
        return dirs.firstOrNull { free(it) >= size + 64L * 1024 * 1024 }
    }

    private fun free(d: File): Long = try { StatFs(d.path).availableBytes } catch (e: Exception) { 0 }

    fun onUsb(ctx: Context): Boolean {
        val roots = ctx.getExternalFilesDirs(null).filterNotNull()
        return roots.any { try { Environment.isExternalStorageRemovable(it) } catch (e: Exception) { false } }
    }

    /** Which downloads this app made lives inside the app, so it survives swapping pendrives (older copies on the drives are still read). */
    private fun indexFile(ctx: Context) = File(ctx.filesDir, INDEX)

    /** Names this app downloaded (and so may delete again). */
    fun index(ctx: Context): MutableSet<String> {
        val out = mutableSetOf<String>()
        for (f in listOf(indexFile(ctx)) + dirs(ctx).map { File(it, INDEX) }) {
            if (!f.exists()) continue
            try { val a = JSONArray(f.readText()); for (i in 0 until a.length()) out.add(a.getString(i)) } catch (e: Exception) { /* unreadable: skip */ }
        }
        return out
    }

    fun saveIndex(ctx: Context, names: Set<String>) { try { indexFile(ctx).writeText(JSONArray(names.sorted()).toString()) } catch (e: Exception) { /* storage gone */ } }

    /** Every complete movie file on every drive, newest first. */
    fun list(ctx: Context): List<Movie> {
        val ours = index(ctx)
        return dirs(ctx).flatMap { d -> (d.listFiles() ?: emptyArray()).toList() }
            .filter { it.isFile && !it.name.startsWith(".") && !it.name.endsWith(".part") && it.length() > 0 }
            .sortedByDescending { it.lastModified() }
            .map { Movie(it.name, it.length(), it, it.name in ours) }
    }

    fun find(ctx: Context, name: String): Movie? { val n = Logic.safeName(name) ?: return null; return list(ctx).firstOrNull { it.name == n } }

    /** Deletes a movie from the storage. Only files directly inside a movie folder. */
    fun remove(ctx: Context, name: String): Boolean {
        val n = Logic.safeName(name) ?: return false
        var any = false
        for (d in dirs(ctx)) { val f = File(d, n); if (f.isFile && f.delete()) any = true }
        if (any) saveIndex(ctx, index(ctx).also { it.remove(n) })
        return any
    }

    /** A plugged-in pendrive / SD card with its room. */
    data class Drive(val label: String, val free: Long, val total: Long, val dir: File)

    /** Every mounted removable drive, in plug-in order. Empty when no pendrive is in. */
    fun drives(ctx: Context): List<Drive> {
        if (!onUsb(ctx)) return emptyList()
        val sm = ctx.getSystemService(Context.STORAGE_SERVICE) as? android.os.storage.StorageManager
        return dirs(ctx).map { d ->
            val label = (try { sm?.getStorageVolume(d)?.getDescription(ctx) } catch (e: Exception) { null })?.takeIf { it.isNotBlank() } ?: "USB drive"
            val st = try { StatFs(d.path) } catch (e: Exception) { null }
            Drive(label, st?.availableBytes ?: 0, st?.totalBytes ?: 0, d)
        }
    }

    /** One entry per drive (empty drives too), movies newest first. Without a pendrive: the internal storage as one unnamed drive. */
    fun byDrive(ctx: Context): List<Pair<Drive?, List<Movie>>> {
        val ours = index(ctx)
        fun moviesIn(d: File) = (d.listFiles() ?: emptyArray())
            .filter { it.isFile && !it.name.startsWith(".") && !it.name.endsWith(".part") && it.length() > 0 }
            .sortedByDescending { it.lastModified() }
            .map { Movie(it.name, it.length(), it, it.name in ours) }
        val usb = drives(ctx)
        if (usb.isEmpty()) return moviesIn(dir(ctx)).let { if (it.isEmpty()) emptyList() else listOf(null to it) }
        return usb.map { it to moviesIn(it.dir) }
    }

    /** The most room on any single drive: what the biggest next movie can use. */
    fun freeBytes(ctx: Context): Long = dirs(ctx).maxOfOrNull { free(it) } ?: 0
    fun totalBytes(ctx: Context): Long = dirs(ctx).sumOf { try { StatFs(it.path).totalBytes } catch (e: Exception) { 0L } }
    fun usedByMovies(ctx: Context): Long = list(ctx).sumOf { it.size }
}

/** What the sync is doing, for the next status and for the home screen. */
data class SyncState(val active: Boolean = false, val name: String = "", val pct: Int = 0, val error: String = "", val finishedAt: Long = 0)

/** Downloads the movies in the Drive folder to the storage, one at a time, resuming a half file. */
class MovieSync(private val ctx: Context) {
    private val running = AtomicBoolean(false)
    @Volatile var state = SyncState()
        private set
    /** Every movie's download (progress, start time, speed, outcome) for the website; the last ones are kept across restarts. */
    val transfers = TransferLog()
    private val transfersFile = File(ctx.filesDir, "movie-transfers.json")
    init { loadTransfers() }

    private fun loadTransfers() {
        try {
            if (!transfersFile.exists()) return
            val a = JSONArray(transfersFile.readText())
            transfers.restore((0 until a.length()).map { i ->
                val o = a.getJSONObject(i)
                Transfer(o.getString("name"), o.optLong("size"), o.optString("status"), o.optLong("done"), o.optLong("startedAt"), o.optLong("finishedAt"), o.optLong("speedBps"), o.optString("error"))
            }, System.currentTimeMillis())
        } catch (e: Exception) { /* a damaged file only loses the history */ }
    }
    private fun saveTransfers() { try { transfersFile.writeText(transfersJson(transfers.snapshot()).toString()) } catch (e: Exception) { /* storage gone */ } }

    /** Runs a whole sync; returns false if one was already running. Blocking: call from a background thread. */
    fun runOnce(onChange: () -> Unit): Boolean {
        if (!running.compareAndSet(false, true)) return false
        val prefs = Prefs(ctx)
        try {
            if (!prefs.linked) return true
            state = SyncState(active = true); onChange()
            val api = Api(ctx)
            // The Drive link (refresh token, folder, mode) comes from the server once and is kept, so the TV works without it.
            val grant = loadGrant(prefs, api)
            if (grant == null) { state = SyncState(finishedAt = System.currentTimeMillis(), error = "No Drive link yet. Connect Google in Smart home."); return true }
            val drive = DriveDirect(grant)
            val mode = if (grant.optString("mode") == "move") "move" else "mirror"
            data class Item(val name: String, val size: Long, val id: String)
            val items = drive.list().mapNotNull { f -> Logic.safeName(f.name)?.let { Item(it, f.size, f.id) } }
            val ours = MovieStore.index(ctx)

            // The USB copy follows the Drive folder ("mirror"): drop what this app downloaded and Drive no longer has.
            for (gone in Logic.mirrorDeletes(mode, ours, items.map { it.name }.toSet())) {
                MovieStore.dirs(ctx).forEach { File(it, gone).delete() }; ours.remove(gone)
            }
            MovieStore.saveIndex(ctx, ours)

            val local = MovieStore.list(ctx).associate { it.name to it.size }
            val todo = Logic.missing(items.map { it.name to it.size }, local)
            for ((name, size) in todo) transfers.waiting(name, size)
            onChange()
            for ((name, size) in todo) {
                val item = items.first { it.name == name }
                val dir = MovieStore.dirFor(ctx, name, size)
                if (dir == null) { state = SyncState(active = true, name = name, error = "Not enough free space for $name"); transfers.fail(name, size, "Not enough free space on the drive", System.currentTimeMillis()); saveTransfers(); onChange(); continue }
                try {
                    download(drive, item.id, File(dir, name), size, { from -> transfers.start(name, size, from, System.currentTimeMillis()); saveTransfers(); onChange() }) { pct, done ->
                        transfers.progress(name, done, System.currentTimeMillis()); state = SyncState(active = true, name = name, pct = pct); onChange()
                    }
                    transfers.finish(name, System.currentTimeMillis()); saveTransfers()
                    ours.add(name); MovieStore.saveIndex(ctx, ours)
                    prefs.lastUploadAt = System.currentTimeMillis(); prefs.lastUploadName = name
                    onChange()
                } catch (e: Exception) {
                    transfers.fail(name, size, e.message ?: "Download failed", System.currentTimeMillis()); saveTransfers()
                    state = SyncState(active = true, name = name, error = e.message ?: "Download failed"); com.tanush.stashr.tv.core.Health.record("sync", "Download of $name failed: " + (e.message ?: "")); onChange()
                    if (e is com.tanush.stashr.tv.core.ApiError && e.status == 401) throw e
                }
            }
            val err = state.error
            state = SyncState(finishedAt = System.currentTimeMillis(), error = err)
        } catch (e: Exception) {
            state = SyncState(finishedAt = System.currentTimeMillis(), error = e.message ?: "Sync failed"); com.tanush.stashr.tv.core.Health.record("sync", e.message ?: "Sync failed")
        } finally { transfers.endSync(System.currentTimeMillis()); saveTransfers(); running.set(false); onChange() }
        return true
    }

    /** The grant from the server when it answers (kept for later), else the one kept from before. */
    private fun loadGrant(prefs: Prefs, api: Api): JSONObject? {
        try {
            val fresh = api.movieGrant()
            prefs.driveGrant = fresh.toString()
            return fresh
        } catch (e: Exception) {
            val saved = prefs.driveGrant
            return if (saved.isNotEmpty()) try { JSONObject(saved) } catch (x: Exception) { null } else null
        }
    }

    /** [begun] is told where the download starts (0, or the part already on the storage); [progress] gets the percent and the bytes on the storage. */
    private fun download(drive: DriveDirect, fileId: String, target: File, total: Long, begun: (Long) -> Unit, progress: (Int, Long) -> Unit) {
        val part = File(target.parentFile, target.name + ".part")
        var start = Logic.resumeFrom(if (part.exists()) part.length() else 0, total)
        if (start == -1L) { begun(total); part.renameTo(target); return }
        fun connect(from: Long) = drive.open(fileId, from)
        var conn = connect(start)
        if (start > 0 && conn.responseCode != 206) { conn.disconnect(); part.delete(); start = 0; conn = connect(0) }
        var done = start
        begun(start)
        var lastPct = -1
        try {
            FileOutputStream(part, start > 0).use { out ->
                conn.inputStream.use { input ->
                    val buf = ByteArray(256 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n); done += n
                        val pct = (done * 100 / total).toInt()
                        if (pct != lastPct) { lastPct = pct; progress(pct, done) }
                    }
                    out.fd.sync()
                }
            }
        } finally { conn.disconnect() }
        if (part.length() != total) throw java.io.IOException("The download of ${target.name} stopped early; it will continue next time.")
        if (target.exists()) target.delete()
        if (!part.renameTo(target)) throw java.io.IOException("Could not save ${target.name}.")
    }
}

internal fun movieJson(list: List<Movie>): JSONArray = JSONArray().also { a ->
    for (m in list) a.put(JSONObject().put("name", m.name).put("size", m.size).put("where", if (m.synced) "Synced" else "USB drive"))
}

/** The downloads for the website's status report. */
internal fun transfersJson(list: List<Transfer>): JSONArray = JSONArray().also { a ->
    for (t in list) a.put(JSONObject().put("name", t.name).put("size", t.size).put("status", t.status).put("done", t.done).put("pct", t.pct)
        .put("startedAt", t.startedAt).put("finishedAt", t.finishedAt).put("speedBps", t.speedBps).put("error", t.error))
}
