const { describe, test, before: beforeAll, after: afterAll, beforeEach } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const media = require("../utils/homeMedia");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { const db = mongoose.connection.db; for (const c of ["homeMedia.files", "homeMedia.chunks"]) await db.collection(c).deleteMany({}); });

const jpeg = (kb) => { const b = Buffer.alloc(kb * 1024, 1); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
const count = () => mongoose.connection.db.collection("homeMedia.files").countDocuments({});
const age = (id, hours) => mongoose.connection.db.collection("homeMedia.files").updateOne({ _id: id }, { $set: { uploadDate: new Date(Date.now() - hours * 3600 * 1000) } });

describe("camera media is kept for 24 hours only, with a limit", () => {
    test("the keep rules", () => {
        expect(media.KEEP_MS).toBe(24 * 3600 * 1000);
        expect(media.KEEP_COUNT).toBe(30);
    });
    test("media older than 24 hours is removed, with its chunks; newer media stays", async () => {
        const owner = "o1";
        const oldId = await media.save({ owner, device: "d", kind: "photo", reason: "t", buffer: jpeg(10) });
        const newId = await media.save({ owner, device: "d", kind: "photo", reason: "t", buffer: jpeg(10) });
        await age(oldId, 25);
        await age(newId, 23);
        expect(await media.prune(owner)).toBe(1);
        expect(await count()).toBe(1);
        const left = await mongoose.connection.db.collection("homeMedia.chunks").countDocuments({ files_id: oldId });
        expect(left).toBe(0);
    });
    test("never more than 30 files: the newest 30 stay", async () => {
        const owner = "o2";
        for (let i = 0; i < 34; i++) { const id = await media.save({ owner, device: "d", kind: "photo", reason: "t", buffer: jpeg(1) }); await age(id, 1 + i * 0.01); }
        await media.prune(owner);
        expect(await count()).toBe(30);
    });
    test("never more than 100 MB: the oldest go first (also right when a file is saved)", async () => {
        const owner = "o3";
        let last;
        for (let i = 0; i < 4; i++) { last = await media.save({ owner, device: "d", kind: "photo", reason: "t", buffer: jpeg(30 * 1024) }); await new Promise((r) => setTimeout(r, 400)); }   // four 30 MB files
        await media.prune(owner);
        expect(await count()).toBe(3);                                  // 90 MB fits, a 4th would make 120 MB
        expect(await mongoose.connection.db.collection("homeMedia.files").countDocuments({ _id: last })).toBe(1);   // the newest is kept
    });
    test("another account's media is not touched", async () => {
        const a = await media.save({ owner: "a", device: "d", kind: "photo", reason: "t", buffer: jpeg(5) });
        await age(a, 100);
        await media.save({ owner: "b", device: "d", kind: "photo", reason: "t", buffer: jpeg(5) });
        await media.prune("b");
        expect(await count()).toBe(2);
    });
});
