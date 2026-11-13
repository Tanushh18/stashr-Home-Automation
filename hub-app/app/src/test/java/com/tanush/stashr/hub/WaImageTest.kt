package com.tanush.stashr.hub

import com.tanush.stashr.hub.whatsapp.WaImage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WaImageTest {
    private val png = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 13, 10, 26, 10, 0, 0, 0, 0)
    private val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0, 16, 0, 0, 0, 0, 0, 0)
    private val webp = "RIFF".toByteArray() + byteArrayOf(1, 2, 3, 4) + "WEBP".toByteArray()

    @Test fun theKindOfPictureIsFoundFromItsFirstBytes() {
        assertEquals("image/png", WaImage.mimeOf(png))
        assertEquals("image/jpeg", WaImage.mimeOf(jpeg))
        assertEquals("image/webp", WaImage.mimeOf(webp))
        assertEquals("image/jpeg", WaImage.mimeOf(ByteArray(0)))
        // a RIFF file that is not WebP (a WAV, say) is not taken for one
        assertEquals("image/jpeg", WaImage.mimeOf("RIFF".toByteArray() + byteArrayOf(1, 2, 3, 4) + "WAVE".toByteArray()))
    }

    @Test fun theExtensionAndTheKindMatchBothWays() {
        for (m in listOf("image/png", "image/webp", "image/jpeg")) assertEquals(m, WaImage.mimeOfExt(WaImage.extOf(m)))
        assertEquals("image/jpeg", WaImage.mimeOfExt("JPG"))
        assertEquals("image/png", WaImage.mimeOfExt("PNG"))
    }

    @Test fun everyMessageGetsItsOwnFileName() {
        val a = WaImage.fileName("65f1a2b3c4d5e6f7a8b9c0d1", "image/png", 1L)
        val b = WaImage.fileName("65f1a2b3c4d5e6f7a8b9c0d2", "image/png", 1L)
        assertEquals("wa-65f1a2b3c4d5e6f7a8b9c0d1.png", a)
        assertNotEquals(a, b)
        // no way to climb out of the folder through the id
        assertEquals("wa-abc.jpg", WaImage.fileName("../../abc", "image/jpeg", 1L))
        // a message without an id still gets a name
        assertEquals("wa-12345.webp", WaImage.fileName("", "image/webp", 12345L))
        assertTrue(WaImage.fileName("x".repeat(100), "image/png", 1L).length <= "wa-".length + 24 + ".png".length)
    }

    @Test fun onlyOldLeftoversAreStale() {
        val now = 10_000_000L
        assertFalse(WaImage.isStale(now - 59 * 60_000L, now))
        assertTrue(WaImage.isStale(now - 61 * 60_000L, now))
    }

    @Test fun theScreenIdsAreShortenedWithoutRepeatsAndCapped() {
        val ids = listOf("com.whatsapp.w4b:id/send", null, "com.whatsapp.w4b:id/entry", "com.whatsapp.w4b:id/send", "", "android:id/content")
        assertEquals(listOf("send", "entry", "content"), WaImage.shortIds(ids))
        assertEquals(3, WaImage.shortIds((1..50).map { "p:id/v$it" }, 3).size)
    }
}
