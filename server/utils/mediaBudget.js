/*
 * Camera pictures and clips are the biggest single user of the free plan's bandwidth and of the 512 MB database: each one is written to
 * MongoDB and also uploaded to Telegram. This keeps them in check:
 *   - a daily allowance per account (MEDIA_DAILY_MB, default 40): once it is used, photos are still saved but not sent to Telegram,
 *     and clips are not accepted until tomorrow (the tablet is told, and keeps its own copy);
 *   - a clip bigger than TELEGRAM_CLIP_MAX_MB (default 8) is stored but not uploaded to Telegram;
 *   - clips are deleted after MEDIA_CLIP_KEEP_DAYS (default 1), photos after MEDIA_KEEP_DAYS (default 3), and the total kept per account
 *     is limited to MEDIA_KEEP_MB (default 60), oldest first.
 * Pure functions; the counters live in memory (a restart gives a fresh day, which only errs on the side of allowing).
 */
const MB = 1024 * 1024;
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

const dailyBytes = () => num(process.env.MEDIA_DAILY_MB, 40) * MB;
const telegramClipMax = () => num(process.env.TELEGRAM_CLIP_MAX_MB, 8) * MB;
const keepBytes = () => num(process.env.MEDIA_KEEP_MB, 60) * MB;
const keepMs = (kind) => num(kind === "video" ? process.env.MEDIA_CLIP_KEEP_DAYS : process.env.MEDIA_KEEP_DAYS, kind === "video" ? 1 : 3) * 24 * 3600 * 1000;   // clips are deleted after a day, photos (small) after three

const used = new Map();                        // "owner|day" -> bytes
const dayOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

/**
 * Ask to use `bytes` of today's allowance for this account. -> { ok, left }: ok=false when it would pass the allowance (nothing counted).
 * A photo that does not fit is still allowed to be saved (`allowStore`), it just is not sent on.
 */
function take(owner, bytes, now = Date.now()) {
    const key = `${owner}|${dayOf(now)}`;
    const have = used.get(key) || 0;
    if (have + bytes > dailyBytes()) return { ok: false, left: Math.max(0, dailyBytes() - have) };
    used.set(key, have + bytes);
    for (const k of used.keys()) if (!k.endsWith(dayOf(now))) used.delete(k);        // yesterday's counters are not needed
    return { ok: true, left: dailyBytes() - have - bytes };
}

const mayUploadToTelegram = (kind, bytes) => kind !== "video" || bytes <= telegramClipMax();

/**
 * Which stored files to delete: older than the keep time, then the oldest until the total is under the size limit.
 * files: [{ _id, length, uploadDate, metadata: { kind } }] -> the _ids to remove.
 */
function toPrune(files, now = Date.now()) {
  const sorted = [...files].sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));     // newest first
  const drop = [];
  let total = 0;
  for (const f of sorted) {
    const age = now - new Date(f.uploadDate).getTime();
    if (age > keepMs(f.metadata && f.metadata.kind) || total + f.length > keepBytes()) drop.push(f._id);
    else total += f.length;
  }
  return drop;
}

module.exports = { take, mayUploadToTelegram, toPrune, dailyBytes, telegramClipMax, keepBytes, keepMs, _reset: () => used.clear() };
