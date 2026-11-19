/*
 * Everything one account owns, outside the account document: devices, events, Money entries, WhatsApp lists, Telegram copies, camera
 * pictures... Found by looking at every model for an owner/user reference, so a feature added later is covered too. Used when an
 * administrator deletes a person: before this, those records stayed behind for ever and slowly filled the free database.
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const OWNER_FIELDS = ["owner", "userId", "ownerId", "user"];

function loadAllModels() {
  for (const f of fs.readdirSync(path.join(__dirname, "..", "models"))) if (f.endsWith(".js")) { try { require(path.join("..", "models", f)); } catch { /* a model that cannot load has nothing to delete */ } }
}

/** [{ name, collection, field }] for every model that points at an account by ObjectId. */
function ownedModels(models = mongoose.models) {
  const out = [];
  for (const [name, M] of Object.entries(models)) {
    if (name === "User" || !M.schema) continue;
    const field = OWNER_FIELDS.find((f) => { const p = M.schema.path(f); return p && p.instance === "ObjectId"; });
    if (field) out.push({ name, M, collection: M.collection.name, field });
  }
  return out;
}

/** Deletes it all for one account id. -> { total, byCollection: { name: count }, media } */
async function purgeOwner(id, { models = mongoose.models, db = mongoose.connection.db } = {}) {
  loadAllModels();
  const byCollection = {};
  let total = 0;
  for (const m of ownedModels(models)) {
    try { const r = await m.M.deleteMany({ [m.field]: id }); if (r.deletedCount) { byCollection[m.collection] = r.deletedCount; total += r.deletedCount; } }
    catch { /* keep going: one collection failing must not leave the rest behind */ }
  }
  let media = 0;
  try {                                                                                   // camera pictures and clips (GridFS)
    const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: "homeMedia" });
    const files = await db.collection("homeMedia.files").find({ "metadata.owner": id }).project({ _id: 1 }).toArray();
    for (const f of files) { await bucket.delete(f._id).catch(() => {}); media++; }
  } catch { /* none */ }
  return { total, byCollection, media };
}

module.exports = { purgeOwner, ownedModels, OWNER_FIELDS };
