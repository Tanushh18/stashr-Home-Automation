package com.tanush.stashr.hub.whatsapp

/**
 * The pure rules for the picture of one WhatsApp message (no Android types, unit-tested): what kind of picture the bytes are,
 * the file name it is stored under, and when a leftover file is old enough to delete.
 *
 * The picture lives in its own folder (cache/wa-share) under a name made from the message's id, so two messages can never share a
 * file and nothing else saved on the tablet can be taken for it.
 */
object WaImage {
    const val FOLDER = "wa-share"
    const val STALE_MS = 3_600_000L          // a picture older than an hour is a leftover of a crashed send

    /** "image/png", "image/webp" or (anything else) "image/jpeg", from the first bytes of the file. */
    fun mimeOf(bytes: ByteArray): String = when {
        bytes.size > 3 && bytes[0] == 0x89.toByte() && bytes[1] == 'P'.code.toByte() -> "image/png"
        bytes.size > 11 && String(bytes, 0, 4, Charsets.ISO_8859_1) == "RIFF" && String(bytes, 8, 4, Charsets.ISO_8859_1) == "WEBP" -> "image/webp"
        else -> "image/jpeg"
    }

    fun extOf(mime: String): String = when (mime) { "image/png" -> "png"; "image/webp" -> "webp"; else -> "jpg" }
    fun mimeOfExt(ext: String): String = when (ext.lowercase()) { "png" -> "image/png"; "webp" -> "image/webp"; else -> "image/jpeg" }

    /** "wa-<message id letters and digits>.<ext>"; a message with no usable id gets the time instead. */
    fun fileName(sendId: String, mime: String, now: Long): String {
        val id = sendId.filter { it.isLetterOrDigit() }.take(24).ifEmpty { now.toString() }
        return "wa-$id.${extOf(mime)}"
    }

    fun isStale(lastModified: Long, now: Long) = now - lastModified > STALE_MS

    /** The view ids seen on WhatsApp's screen, shortened ("com.whatsapp.w4b:id/send" -> "send"), in order, without repeats, at most [max]. */
    fun shortIds(ids: List<String?>, max: Int = 14): List<String> =
        ids.mapNotNull { it?.substringAfterLast('/')?.takeIf { s -> s.isNotBlank() } }.distinct().take(max)
}
