/*
 * Two databases, one app. When MONGO_URL_NEW is set:
 *   - the NEW database (free tier, 512 MB) is the default connection: EVERY write goes there.
 *   - the OLD database (MONGO_URL) is only read from. Whatever a query needs from it is first copied ("pulled") into the new
 *     database, then the query runs on the new one. So the old data keeps working, moves over by itself as it is used (and in the
 *     background, see utils/dbMigrate.js), and nothing new is ever written to the old database.
 *
 * It works by wrapping Query.exec / Aggregate.exec / Model.save once, so no route or model has to change. With no OLD connection
 * attached, every wrapper is a straight pass-through.
 *
 * Space guard: the free tier is 512 MB. Copying stops at CAP_MB (default 460). Past it, reads still work: old documents are
 * returned straight from the old database without being copied (read-only until space is freed).
 */
const mongoose = require("mongoose");

const state = { legacy: null, capBytes: Math.round(Number(process.env.NEW_DB_CAP_MB || 460) * 1024 * 1024), drained: new Set(), sizeAt: 0, size: 0, warned: false };
const PULL_MAX = 5000;                                   // most documents one query copies over
const SKIP_COLLECTIONS = /^(system\.|_stashr_)/;

const attach = (conn) => { state.legacy = conn; };
const detach = () => { state.legacy = null; state.drained = new Set(); };
const enabled = () => Boolean(state.legacy && state.legacy.readyState === 1);
const legacyColl = (name) => state.legacy.db.collection(name);
const watched = (model) => enabled() && model && model.collection && !SKIP_COLLECTIONS.test(model.collection.name) && !state.drained.has(model.collection.name);

/** Bytes the NEW database uses (data + indexes), cached for a minute. */
async function usedBytes(force = false) {
    if (!force && Date.now() - state.sizeAt < 60000) return state.size;
    try { const s = await mongoose.connection.db.stats(); state.size = (s.storageSize || s.dataSize || 0) + (s.indexSize || 0); state.sizeAt = Date.now(); }
    catch { /* keep the last known size */ }
    return state.size;
}
const isFull = async () => (await usedBytes()) >= state.capBytes;

/** Copy documents from the old database into the new one: { copied, full }. Documents already there (same _id, or a unique clash) are left alone. */
async function copyIn(collName, collection, filter, { limit = PULL_MAX, sort = null } = {}) {
    if (await isFull()) { if (!state.warned) { state.warned = true; console.warn("[db] the new database is at its size cap: old data is read but no longer copied."); } return { copied: 0, full: true }; }
    let cur = legacyColl(collName).find(filter);
    if (sort) cur = cur.sort(sort);
    const docs = await cur.limit(limit).toArray();
    const now = Date.now();
    const fresh = docs.filter((d) => !d.expireAt || new Date(d.expireAt).getTime() > now);   // an entry past its expiry is not worth moving
    if (!fresh.length) return { copied: 0, full: false };
    try { await collection.insertMany(fresh, { ordered: false }); return { copied: fresh.length, full: false }; }
    catch (e) {
        if (e && (e.code === 11000 || (e.writeErrors && e.writeErrors.every((w) => w.code === 11000)))) return { copied: (e.result && e.result.insertedCount) || 0, full: false };
        throw e;
    }
}

const castFilter = (q) => { try { q.cast(q.model); } catch { /* the real exec reports a bad filter */ } return q.getFilter(); };
const isLean = (q) => Boolean(q._mongooseOptions && q._mongooseOptions.lean);

/** Pull what this query needs from the old database. -> { copied, full } */
async function pullFor(q, limit) {
    const o = q.getOptions ? q.getOptions() : {};
    const want = limit || (o.limit ? Math.min(PULL_MAX, o.limit + (o.skip || 0)) : PULL_MAX);
    return copyIn(q.model.collection.name, q.model.collection, castFilter(q), { limit: want, sort: o.limit ? o.sort : null });
}

const sortFn = (spec) => {
    const keys = Object.entries(spec || {});
    return (a, b) => { for (const [k, dir] of keys) { const x = a[k], y = b[k]; if (x === y) continue; return (x > y ? 1 : -1) * (Number(dir) < 0 || dir === "desc" ? -1 : 1); } return 0; };
};

const ONE = new Set(["findOne"]);
const MANY = new Set(["find"]);
const PULL_THEN_RUN = new Set(["countDocuments", "distinct", "updateOne", "updateMany", "replaceOne", "findOneAndUpdate", "findOneAndReplace"]);
const PULL_ONE = new Set(["updateOne", "replaceOne", "findOneAndUpdate", "findOneAndReplace"]);

const rawExec = mongoose.Query.prototype.exec;
mongoose.Query.prototype.exec = async function (...args) {
    if (this._noLegacy || !watched(this.model)) return rawExec.apply(this, args);
    const op = this.op, name = this.model.collection.name;
    try {
        if (ONE.has(op)) {
            const hit = await rawExec.apply(this, args);
            if (hit) return hit;
            const got = await pullFor(this, 1);
            if (got.copied) { const again = this.clone(); again._noLegacy = true; return again.exec(); }
            if (!got.full) return hit;
            const raw = await legacyColl(name).findOne(castFilter(this));           // full: serve it from the old database, read only
            return raw ? (isLean(this) ? raw : this.model.hydrate(raw)) : hit;
        }
        if (MANY.has(op)) {
            const got = await pullFor(this);
            const mine = await rawExec.apply(this, args);
            if (!got.full) return mine;
            const o = this.getOptions(), have = new Set(mine.map((d) => String(d._id)));          // full: merge the old ones in, read only
            const extra = (await legacyColl(name).find(castFilter(this)).limit(PULL_MAX).toArray()).filter((d) => !have.has(String(d._id)));
            const all = mine.concat(extra.map((d) => (isLean(this) ? d : this.model.hydrate(d))));
            if (o.sort) all.sort(sortFn(o.sort));
            return all.slice(o.skip || 0, o.limit ? (o.skip || 0) + o.limit : undefined);
        }
        if (PULL_THEN_RUN.has(op)) { await pullFor(this, PULL_ONE.has(op) ? 1 : undefined); return rawExec.apply(this, args); }
        if (op === "deleteOne" || op === "findOneAndDelete") {
            await pullFor(this, 1);
            const res = await rawExec.apply(this, args);
            const id = op === "findOneAndDelete" ? res && res._id : null;
            const f = castFilter(this);
            legacyColl(name).deleteOne(id ? { _id: id } : f).catch(() => {});             // best effort: a read-only old user cannot, and then it may come back
            return res;
        }
        if (op === "deleteMany") {
            const f = { ...castFilter(this) };
            const res = await rawExec.apply(this, args);
            legacyColl(name).deleteMany(f).catch(() => {});
            return res;
        }
    } catch (e) { console.error(`[db] old-database fallback failed for ${name}.${op}:`, e && e.message); }
    return rawExec.apply(this, args);
};

const rawAgg = mongoose.Aggregate.prototype.exec;
mongoose.Aggregate.prototype.exec = async function (...args) {
    const model = this._model;
    if (watched(model)) {
        try {
            const first = (this.pipeline()[0] || {}).$match;
            const q = model.find(first || {});
            await copyIn(model.collection.name, model.collection, first ? castFilter(q) : {});
        } catch (e) { console.error("[db] old-database fallback failed for aggregate:", e && e.message); }
    }
    return rawAgg.apply(this, args);
};

const rawSave = mongoose.Model.prototype.save;
mongoose.Model.prototype.save = async function (...args) {
    const M = this.constructor;
    if (this.isNew && watched(M) && M.schema) {
        try {
            for (const [fields, opts] of M.schema.indexes()) {                          // a new document must not clash with one that is still only in the old database
                if (!opts || !opts.unique) continue;
                const f = {};
                for (const k of Object.keys(fields)) f[k] = this.get(k);
                if (Object.values(f).some((v) => v === undefined || v === null)) continue;
                await copyIn(M.collection.name, M.collection, f, { limit: 1 });
            }
        } catch (e) { console.error("[db] old-database check failed on save:", e && e.message); }
    }
    return rawSave.apply(this, args);
};

mongoose.Model.prototype.$save = mongoose.Model.prototype.save;   // Model.create saves through $save

module.exports = { state, attach, detach, enabled, copyIn, usedBytes, isFull, legacyColl, SKIP_COLLECTIONS };
