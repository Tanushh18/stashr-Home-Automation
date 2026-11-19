// Camera media is the biggest user of bandwidth and database space on the free plan: a daily allowance, a Telegram size cap, and pruning by age and size.
const { describe, test } = require("node:test");
const expect = require("./expect");
const b = require("../utils/mediaBudget");
const MB = 1024 * 1024;

describe("camera media budget", () => {
    test("a daily allowance per account, reset the next day", () => {
        b._reset();
        const t = Date.parse("2026-11-19T10:00:00Z");
        expect(b.take("a", 30 * MB, t).ok).toBe(true);
        expect(b.take("a", 15 * MB, t).ok).toBe(false);            // 30 + 15 > 40
        expect(b.take("a", 5 * MB, t).ok).toBe(true);
        expect(b.take("b", 30 * MB, t).ok).toBe(true);             // another account has its own
        expect(b.take("a", 30 * MB, t + 24 * 3600 * 1000).ok).toBe(true);
    });
    test("a big clip is stored but not uploaded to Telegram; photos always may be", () => {
        expect(b.mayUploadToTelegram("video", 3 * MB)).toBe(true);
        expect(b.mayUploadToTelegram("video", 12 * MB)).toBe(false);
        expect(b.mayUploadToTelegram("photo", 7 * MB)).toBe(true);
    });
    test("pruning drops what is too old, then the oldest until it fits", () => {
        const now = Date.parse("2026-11-19T00:00:00Z"), day = 24 * 3600 * 1000;
        const f = (id, ageDays, mb) => ({ _id: id, length: mb * MB, uploadDate: new Date(now - ageDays * day) });
        const drop = b.toPrune([f("new", 0.1, 20), f("mid", 1, 20), f("mid2", 2, 15), f("old", 5, 1), f("edge", 1.5, 20)], now);
        expect(drop.includes("old")).toBe(true);                    // older than 3 days
        expect(drop.includes("new") || drop.includes("mid")).toBe(false);
        expect(drop.includes("edge")).toBe(false);                  // 20+20+20 = 60 MB still fits exactly
        expect(drop.includes("mid2")).toBe(true);                   // 15 more would pass the 60 MB limit
    });
});
