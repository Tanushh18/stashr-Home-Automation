const { describe, test, before: beforeAll, after: afterAll } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
process.env.SECRET_KEY = "t"; process.env.CRYPTO_SECRET_KEY = "t";
const { purgeOwner, ownedModels } = require("../utils/purgeOwner");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

describe("deleting an account removes everything it owned", () => {
    test("every collection with an owner reference is emptied for that account and only that account", async () => {
        require("../utils/purgeOwner");
        const first = await purgeOwner(new mongoose.Types.ObjectId());            // loads all the models
        expect(first.total).toBe(0);
        const mine = new mongoose.Types.ObjectId(), other = new mongoose.Types.ObjectId();
        const owned = ownedModels().filter((m) => ["HomeEvent", "HomeDevice", "ExpenseTx", "WaSend", "TelegramNotification", "HomeSettings"].includes(m.name));
        expect(owned.length >= 5).toBe(true);
        for (const m of owned) { await m.M.collection.insertOne({ [m.field]: mine, x: 1 }); await m.M.collection.insertOne({ [m.field]: other, x: 2 }); }
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "homeMedia" });
        await new Promise((res, rej) => { const up = bucket.openUploadStream("a.jpg", { metadata: { owner: mine } }); up.on("finish", res).on("error", rej).end(Buffer.from("x")); });
        const r = await purgeOwner(mine);
        expect(r.total).toBe(owned.length);
        expect(r.media).toBe(1);
        for (const m of owned) {
            expect(await m.M.collection.countDocuments({ [m.field]: mine })).toBe(0);
            expect(await m.M.collection.countDocuments({ [m.field]: other })).toBe(1);        // someone else's stays
        }
        expect(await mongoose.connection.db.collection("homeMedia.files").countDocuments({ "metadata.owner": mine })).toBe(0);
    });
});
