/*
 * Background mover: copies the old database into the new one, smallest collections first, in small batches, and stops at the size cap
 * (db/legacy.js). A collection that is fully copied is marked "drained" (in the new database, `_stashr_migration`) and from then on is
 * no longer looked up in the old database at all. Safe to stop and start again: it carries on from the last _id it copied.
 * Collections named in MIGRATE_SKIP (comma separated, e.g. "homeMedia.chunks,homeMedia.files") are left in the old database.
 */
const mongoose = require("mongoose");
const legacy = require("../db/legacy");

const PROGRESS = "_stashr_migration";
const BATCH = 400;
let running = false, stopFlag = false, last = null;

const skipList = () => String(process.env.MIGRATE_SKIP || "").split(",").map((s) => s.trim()).filter(Boolean);
const progressColl = () => mongoose.connection.db.collection(PROGRESS);

/** Load which collections are already drained (call after connecting). */
async function loadDrained() {
    if (!legacy.enabled()) return;
    const rows = await progressColl().find({ drained: true }).toArray();
    legacy.state.drained = new Set(rows.map((r) => r._id));
}

async function legacyCollections() {
    const list = await legacy.state.legacy.db.listCollections({}, { nameOnly: true }).toArray();
    const out = [];
    for (const c of list) {
        if (legacy.SKIP_COLLECTIONS.test(c.name) || legacy.SKIP_DATA.has(c.name) || c.type === "view") continue;
        const coll = legacy.legacyColl(c.name);
        out.push({ name: c.name, count: await coll.estimatedDocumentCount() });
    }
    return out.sort((a, b) => a.count - b.count);
}

/** One collection, from where it stopped. -> { name, copied, drained, full } */
async function moveCollection(name) {
    const src = legacy.legacyColl(name), dst = mongoose.connection.db.collection(name);
    const prog = (await progressColl().findOne({ _id: name })) || { _id: name, lastId: null, copied: 0 };
    let lastId = prog.lastId, copied = prog.copied || 0, full = false;
    for (;;) {
        if (stopFlag) break;
        if (await legacy.isFull()) { full = true; break; }
        const batch = await src.find(lastId ? { _id: { $gt: lastId } } : {}).sort({ _id: 1 }).limit(BATCH).toArray();
        if (!batch.length) { await progressColl().updateOne({ _id: name }, { $set: { drained: true, copied, lastId, at: new Date() } }, { upsert: true }); legacy.state.drained.add(name); return { name, copied, drained: true, full: false }; }
        const now = Date.now();
        legacy.strip(name, batch);
        const fresh = batch.filter((d) => !d.expireAt || new Date(d.expireAt).getTime() > now);
        if (fresh.length) {
            try { await dst.insertMany(fresh, { ordered: false }); }
            catch (e) { if (!(e && (e.code === 11000 || (e.writeErrors && e.writeErrors.every((w) => w.code === 11000))))) throw e; }
        }
        copied += fresh.length;
        lastId = batch[batch.length - 1]._id;
        await progressColl().updateOne({ _id: name }, { $set: { lastId, copied, drained: false, at: new Date() } }, { upsert: true });
        await legacy.usedBytes(true);
        await new Promise((r) => setTimeout(r, 50));                 // be gentle with a free-tier cluster
    }
    return { name, copied, drained: false, full };
}

/** Move everything it can. -> { moved: [...], full } ; only one run at a time. */
async function run() {
    if (!legacy.enabled()) return { moved: [], full: false, note: "No old database is attached." };
    if (running) return { moved: [], full: false, note: "Already running." };
    running = true; stopFlag = false;
    const moved = [];
    let full = false;
    try {
        for (const c of await legacyCollections()) {
            if (stopFlag || legacy.state.drained.has(c.name) || skipList().includes(c.name)) continue;
            const r = await moveCollection(c.name);
            moved.push(r);
            if (r.full) { full = true; break; }
        }
        last = { at: new Date().toISOString(), moved: moved.length, full };
    } finally { running = false; }
    return { moved, full };
}

const stop = () => { stopFlag = true; };

/** Where things stand: sizes, what is moved, what is left. */
async function status() {
    const base = { attached: legacy.enabled(), running, last, capMB: Math.round(legacy.state.capBytes / 1048576), skip: skipList() };
    if (!legacy.enabled()) return base;
    const used = await legacy.usedBytes(true);
    const cols = [];
    for (const c of await legacyCollections()) {
        const have = await mongoose.connection.db.collection(c.name).estimatedDocumentCount().catch(() => 0);
        cols.push({ name: c.name, inOld: c.count, inNew: have, drained: legacy.state.drained.has(c.name), skipped: skipList().includes(c.name) });
    }
    return { ...base, newUsedMB: Math.round((used / 1048576) * 10) / 10, full: used >= legacy.state.capBytes, remaining: cols.filter((c) => !c.drained).length, collections: cols };
}

module.exports = { run, stop, status, loadDrained, moveCollection };
