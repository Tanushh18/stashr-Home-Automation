/*
 * How long logs are kept. The free MongoDB is 512 MB, so the long-running logs get a shorter life than the models first asked for.
 * The models keep their original TTL index; this shortens it in place on boot (collMod, no rebuild, no conflict) and is a no-op once
 * done. DB_RETENTION=full keeps the original times. Anything older than the new time is removed by MongoDB itself shortly after.
 *   the fast-growing, heavy ones live 3 days at most: home events 60 -> 3, Telegram message copies 30 -> 3 (camera clips: 1 day, see
 *   mediaBudget.js; live frames: 10 minutes); the slow ones are trimmed: Wi-Fi access-point sightings 45 -> 21, internet speed tests
 *   90 -> 30, WhatsApp send records 90 -> 30, account activity log 180 -> 90, app-registry visitors 90 -> 30.
 */
const mongoose = require("mongoose");

const DAY = 24 * 3600;
const LEAN = [
  { model: "HomeEvent", key: { at: 1 }, seconds: 3 * DAY },
  { model: "TelegramNotification", key: { createdAt: 1 }, seconds: 3 * DAY },
  { model: "WaSend", key: { createdAt: 1 }, seconds: 30 * DAY },
  { model: "HomeApSeen", key: { lastSeen: 1 }, seconds: 21 * DAY },
  { model: "HomeApEdge", key: { lastSeen: 1 }, seconds: 21 * DAY },
  { model: "HomeSpeed", key: { at: 1 }, seconds: 30 * DAY },
  { model: "AuditEvent", key: { at: 1 }, seconds: 90 * DAY },
  { model: "RegistryVisit", key: { lastAt: 1 }, seconds: 30 * DAY }
];

/** -> [{ collection, from, to }] for what it changed. */
async function apply(db = mongoose.connection.db, models = mongoose.models) {
  if (String(process.env.DB_RETENTION || "lean").toLowerCase() === "full" || !db) return [];
  for (const f of ["homeEvent", "homeApSeen", "homeSpeed", "AuditEvent", "registryVisit", "TelegramNotification", "waSend"]) { try { require("../models/" + f); } catch { /* optional */ } }   // some load lazily; make sure they exist
  const changed = [];
  for (const t of LEAN) {
    const M = models[t.model];
    if (!M) continue;
    const name = M.collection.name;
    try {
      const idx = (await db.collection(name).indexes()).find((i) => i.expireAfterSeconds !== undefined && JSON.stringify(i.key) === JSON.stringify(t.key));
      if (!idx || idx.expireAfterSeconds <= t.seconds) continue;                 // no such index, or already as short
      await db.command({ collMod: name, index: { keyPattern: t.key, expireAfterSeconds: t.seconds } });
      changed.push({ collection: name, from: idx.expireAfterSeconds, to: t.seconds });
    } catch (e) { /* the collection may not exist yet: it is created with the model's own time and shortened on the next start */ }
  }
  return changed;
}

/** Size of every collection, biggest first: what the database really holds. */
async function usage(db = mongoose.connection.db) {
  const list = await db.listCollections({}, { nameOnly: true }).toArray();
  const rows = [];
  for (const c of list) {
    if (c.name.startsWith("system.")) continue;
    try {
      const s = await db.command({ collStats: c.name });
      rows.push({ collection: c.name, documents: s.count || 0, dataMB: Math.round(((s.size || 0) / 1048576) * 100) / 100, storageMB: Math.round((((s.storageSize || 0) + (s.totalIndexSize || 0)) / 1048576) * 100) / 100, avgDocKB: s.count ? Math.round(((s.size || 0) / s.count / 1024) * 10) / 10 : 0 });
    } catch { /* a view or a collection that vanished */ }
  }
  rows.sort((a, b) => b.storageMB - a.storageMB);
  const total = rows.reduce((n, r) => n + r.storageMB, 0);
  return { totalMB: Math.round(total * 10) / 10, capMB: 512, collections: rows };
}

module.exports = { apply, usage, LEAN };
