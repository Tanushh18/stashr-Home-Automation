/**
 * Photos and short videos from the tablet camera, kept in the database (GridFS) for 24 hours only, at most 30 files and
 * 100 MB per account (the newest are kept), and sent to your Telegram chat when the camera sees movement. The cleanup runs
 * after every save and every minute from the home sweep, so old media goes even when the camera has gone quiet.
 */
const mongoose = require("mongoose");
const { Readable } = require("stream");

const KEEP_MS = 24 * 3600 * 1000;
const KEEP_COUNT = 30;
const KEEP_BYTES = 100 * 1024 * 1024;
const LIMITS = { photo: 8 * 1024 * 1024, video: 30 * 1024 * 1024 };
const TYPES = { photo: ["image/jpeg"], video: ["video/mp4"] };

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "homeMedia" });

/** JPEG starts FF D8 FF; MP4 has "ftyp" at byte 4. Anything else is refused, whatever the header says. */
function looksLike(kind, buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
    if (kind === "photo") return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    return buf.slice(4, 8).toString("latin1") === "ftyp";
}

async function save({ owner, device, kind, reason, buffer }) {
    const id = await new Promise((resolve, reject) => {
        const up = bucket().openUploadStream(`${kind}-${Date.now()}.${kind === "video" ? "mp4" : "jpg"}`, {
            metadata: { owner, device, kind, reason: String(reason || "").slice(0, 40) }, contentType: TYPES[kind][0]
        });
        Readable.from(buffer).pipe(up).on("error", reject).on("finish", () => resolve(up.id));
    });
    void prune(owner);
    return id;
}

const running = new Map();     // one cleanup at a time per account, so two overlapping ones never delete the same files twice over

/** Deletes media older than 24 hours, then the oldest beyond 30 files or 100 MB (newest first are kept). Returns how many files went. */
function prune(owner, now = Date.now()) {
    const key = String(owner);
    const next = (running.get(key) || Promise.resolve()).then(() => pruneNow(owner, now));
    running.set(key, next.catch(() => 0));
    return next;
}

async function pruneNow(owner, now) {
    try {
        const files = mongoose.connection.db.collection("homeMedia.files");
        const all = await files.find({ "metadata.owner": owner }).sort({ uploadDate: -1 }).project({ _id: 1, length: 1, uploadDate: 1 }).toArray();
        const cut = now - KEEP_MS;
        let count = 0, bytes = 0;
        const drop = [];
        for (const f of all) {
            count++; bytes += Number(f.length) || 0;
            if (new Date(f.uploadDate).getTime() < cut || count > KEEP_COUNT || bytes > KEEP_BYTES) drop.push(f._id);
        }
        for (const id of drop) await bucket().delete(id).catch(() => {});
        return drop.length;
    } catch (e) { console.log("[home] media prune failed:", e.message); return 0; }
}

async function list(owner, limit = 40) {
    const files = await mongoose.connection.db.collection("homeMedia.files").find({ "metadata.owner": owner }).sort({ uploadDate: -1 }).limit(limit).toArray();
    return files.map((f) => ({ id: String(f._id), kind: f.metadata.kind, reason: f.metadata.reason || "", size: f.length, at: f.uploadDate }));
}

async function find(owner, id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return mongoose.connection.db.collection("homeMedia.files").findOne({ _id: new mongoose.Types.ObjectId(id), "metadata.owner": owner });
}

const stream = (file, opts) => bucket().openDownloadStream(file._id, opts);
const remove = (file) => bucket().delete(file._id);

module.exports = { KEEP_MS, KEEP_COUNT, KEEP_BYTES, save, list, find, stream, remove, prune, looksLike, LIMITS, TYPES };
