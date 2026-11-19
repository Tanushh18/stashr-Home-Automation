const { describe, test, before: beforeAll, after: afterAll } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const cleanup = require("../utils/photoCleanup");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

describe("removed photo data is cleaned out (only when asked)", () => {
    test("account arrays go, the Google connections stay, leftover collections are dropped, a second run does nothing", async () => {
        const db = mongoose.connection.db;
        await db.collection("users").insertOne({ email: "a@b.c", photoMedia: [{ a: 1 }], photoShares: [], photoConnections: [{ id: "g" }] });
        await db.collection("photoimportbatches").insertOne({ x: 1 });
        const first = await cleanup.run();
        expect(first.accounts).toBe(1);
        expect(first.dropped).toEqual(["photoimportbatches"]);
        const u = await db.collection("users").findOne({ email: "a@b.c" });
        expect(u.photoMedia).toBe(undefined);
        expect(u.photoConnections.length).toBe(1);
        const second = await cleanup.run();
        expect(second.accounts).toBe(0);
        expect(second.dropped).toEqual([]);
    });
});
