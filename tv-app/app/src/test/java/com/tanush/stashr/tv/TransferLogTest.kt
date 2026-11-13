package com.tanush.stashr.tv

import com.tanush.stashr.tv.sync.TransferLog
import org.junit.Assert.assertEquals
import org.junit.Test

class TransferLogTest {
    @Test fun followsOneMovieFromWaitingToDone() {
        val log = TransferLog()
        log.waiting("a.mkv", 1000)
        assertEquals("waiting", log.snapshot()[0].status)
        log.start("a.mkv", 1000, 0, 10_000)
        log.progress("a.mkv", 400, 12_000)            // 400 bytes in 2 s = 200 B/s
        val mid = log.snapshot()[0]
        assertEquals("downloading", mid.status); assertEquals(40, mid.pct); assertEquals(200, mid.speedBps); assertEquals(10_000, mid.startedAt)
        log.finish("a.mkv", 15_000)                   // 1000 bytes in 5 s = 200 B/s on average
        val end = log.snapshot()[0]
        assertEquals("done", end.status); assertEquals(100, end.pct); assertEquals(200, end.speedBps); assertEquals(15_000, end.finishedAt)
    }

    @Test fun aResumedDownloadMeasuresOnlyWhatItFetched() {
        val log = TransferLog()
        log.start("b.mkv", 1000, 800, 0)
        log.finish("b.mkv", 1000)                     // 200 bytes in 1 s
        assertEquals(200, log.snapshot()[0].speedBps)
    }

    @Test fun failureKeepsTheReasonAndStopsTheSpeed() {
        val log = TransferLog()
        log.start("c.mkv", 500, 0, 0)
        log.progress("c.mkv", 100, 2000)
        log.fail("c.mkv", 500, "Network is unreachable", 3000)
        val t = log.snapshot()[0]
        assertEquals("failed", t.status); assertEquals("Network is unreachable", t.error); assertEquals(0, t.speedBps); assertEquals(20, t.pct)
    }

    @Test fun endOfSyncDropsWaitingAndMarksACutOffOneStopped() {
        val log = TransferLog()
        log.waiting("w.mkv", 10); log.start("d.mkv", 10, 0, 0)
        log.endSync(5000)
        val all = log.snapshot()
        assertEquals(listOf("d.mkv"), all.map { it.name }); assertEquals("failed", all[0].status)
    }

    @Test fun restoreShowsARunningTryAsStoppedAndKeepsOnlyTheNewest() {
        val log = TransferLog(keep = 2)
        val saved = listOf(
            com.tanush.stashr.tv.sync.Transfer("old.mkv", 1, "done", finishedAt = 1),
            com.tanush.stashr.tv.sync.Transfer("mid.mkv", 1, "done", finishedAt = 2),
            com.tanush.stashr.tv.sync.Transfer("new.mkv", 1, "done", finishedAt = 3),
            com.tanush.stashr.tv.sync.Transfer("run.mkv", 10, "downloading", done = 5, startedAt = 4),
        )
        log.restore(saved, 99)
        // the stopped run counts as finished now (newest), so with keep = 2 only it and new.mkv remain
        assertEquals(setOf("run.mkv", "new.mkv"), log.snapshot().map { it.name }.toSet())
        assertEquals("failed", log.snapshot().first { it.name == "run.mkv" }.status)
    }
}
