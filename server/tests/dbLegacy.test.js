// Old database read, new database written: reads pull old data over, writes never touch the old one, the mover drains it.
const { describe, test, before: beforeAll, after: afterAll } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const legacy = require("../db/legacy");
const migrate = require("../utils/dbMigrate");

const Note = mongoose.model("LegacyNote", new mongoose.Schema({ owner: String, text: String, n: Number, email: { type: String, unique: true, sparse: true } }));
let oldSrv, newSrv, oldConn;
const oldNotes = () => oldConn.db.collection("legacynotes");

beforeAll(async () => {
    oldSrv = await MongoMemoryServer.create(); newSrv = await MongoMemoryServer.create();
    oldConn = await mongoose.createConnection(oldSrv.getUri()).asPromise();
    await mongoose.connect(newSrv.getUri());
    await Note.init();
    await oldNotes().insertMany([{ owner: "a", text: "old one", n: 1, email: "x@y.z" }, { owner: "a", text: "old two", n: 2 }, { owner: "b", text: "old three", n: 3 }]);
    legacy.attach(oldConn);
});
afterAll(async () => { legacy.detach(); await oldConn.close(); await mongoose.disconnect(); await oldSrv.stop(); await newSrv.stop(); });

describe("old database read, new database written", () => {
    test("a lookup that misses the new database finds the old one and copies it over", async () => {
        const doc = await Note.findOne({ text: "old one" });
        expect(doc.n).toBe(1);
        expect(await mongoose.connection.db.collection("legacynotes").countDocuments({ text: "old one" })).toBe(1);
    });
    test("a list merges old and new, sorted and limited", async () => {
        await Note.create({ owner: "a", text: "new one", n: 10 });
        const rows = await Note.find({ owner: "a" }).sort({ n: -1 }).limit(2).lean();
        expect(rows.map((r) => r.n)).toEqual([10, 2]);
    });
    test("an update of an old-only document works and is written to the new database only", async () => {
        await Note.updateOne({ text: "old three" }, { $set: { n: 33 } });
        expect((await Note.findOne({ text: "old three" })).n).toBe(33);
        expect((await oldNotes().findOne({ text: "old three" })).n).toBe(3);
    });
    test("a new document cannot clash with a unique value that only the old database has", async () => {
        await oldNotes().insertOne({ owner: "c", text: "dup", email: "dup@x.y" });
        let err = null;
        try { await Note.create({ owner: "d", text: "again", email: "dup@x.y" }); } catch (e) { err = e; }
        expect(Boolean(err && /E11000|duplicate/.test(err.message))).toBe(true);
    });
    test("a delete is also sent to the old database so the document does not come back", async () => {
        await Note.deleteOne({ text: "old two" });
        await new Promise((r) => setTimeout(r, 100));
        expect(await Note.countDocuments({ text: "old two" })).toBe(0);
        expect(await oldNotes().countDocuments({ text: "old two" })).toBe(0);
    });
    test("the size cap stops copying but reads still work from the old database", async () => {
        await oldNotes().insertOne({ owner: "z", text: "only old", n: 99 });
        const cap = legacy.state.capBytes; legacy.state.capBytes = 1; legacy.state.sizeAt = 0;
        try {
            expect((await Note.findOne({ text: "only old" })).n).toBe(99);
            expect(await mongoose.connection.db.collection("legacynotes").countDocuments({ text: "only old" })).toBe(0);
            expect((await Note.find({ owner: "z" })).length).toBe(1);
        } finally { legacy.state.capBytes = cap; legacy.state.sizeAt = 0; }
    });
    test("the mover copies everything left and marks the collection drained", async () => {
        const r = await migrate.run();
        expect(r.full).toBe(false);
        expect(legacy.state.drained.has("legacynotes")).toBe(true);
        expect(await mongoose.connection.db.collection("legacynotes").countDocuments({ text: "only old" })).toBe(1);
        const st = await migrate.status();
        expect(st.attached).toBe(true);
        expect(st.collections.find((c) => c.name === "legacynotes").drained).toBe(true);
    });
});

describe("removed photo data is never carried over", () => {
    test("the big photo arrays are stripped from account documents on the way in", () => {
        const [doc] = legacy.strip("users", [{ email: "a@b.c", photoMedia: [1, 2, 3], photoConnections: [{ id: "x" }] }]);
        expect(doc.photoMedia).toBe(undefined);
        expect(doc.photoConnections.length).toBe(1);
        expect(legacy.SKIP_DATA.has("photoimportbatches")).toBe(true);
    });
});
