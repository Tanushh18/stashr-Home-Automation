/**
 * Photos and short videos from the tablet camera, kept in the database (GridFS) for a few days and under a size limit per account
 * (utils/mediaBudget.js: MEDIA_KEEP_DAYS, MEDIA_KEEP_MB), and sent to your Telegram chat when the camera sees movement.
 */
const mongoose = require("mongoose");
const { Readable } = require("stream");

const budget = require("./mediaBudget");
const LIMITS = { photo: 8 * 1024 * 1024, video: 16 * 1024 * 1024 };
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

async function prune(owner) {
    try {
        const files = mongoose.connection.db.collection("homeMedia.files");
        const all = await files.find({ "metadata.owner": owner }).project({ _id: 1, length: 1, uploadDate: 1 }).toArray();
        for (const id of budget.toPrune(all)) await bucket().delete(id).catch(() => {});
    } catch (e) { console.log("[home] media prune failed:", e.message); }
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

module.exports = { save, list, find, stream, remove, prune, looksLike, LIMITS, TYPES };
