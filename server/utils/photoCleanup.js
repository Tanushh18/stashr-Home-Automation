/*
 * The Photos feature (library, albums, people, backup, Google Photos import, shared folders) was removed. This frees what it left in
 * the database: the big per-account arrays and the collections for imports and shared folders. It DELETES DATA, so it never runs by
 * itself: set PHOTO_DATA_CLEANUP=true for one boot (see config.env.example). Safe to repeat. The Google connections that Smart
 * home's movies use (photoConnections) are kept.
 */
const mongoose = require("mongoose");

const FIELDS = ["photoMedia", "photoAlbums", "photoFolders", "photoBackupJobs", "photoSettings", "photoShares"];
const COLLECTIONS = ["photoimportbatches", "photoimportitems", "photofoldershares"];

async function run(db = mongoose.connection.db) {
    if (!db) return { accounts: 0, dropped: [] };
    const r = await db.collection("users").updateMany({ $or: FIELDS.map((f) => ({ [f]: { $exists: true } })) }, { $unset: Object.fromEntries(FIELDS.map((f) => [f, ""])) });
    const dropped = [];
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of COLLECTIONS) if (existing.has(name)) { await db.collection(name).drop().catch(() => {}); dropped.push(name); }
    return { accounts: r.modifiedCount || 0, dropped };
}

module.exports = { run, FIELDS, COLLECTIONS };
