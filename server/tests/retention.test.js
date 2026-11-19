const { describe, test, before: beforeAll, after: afterAll } = require("node:test");
const expect = require("./expect");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
process.env.SECRET_KEY = "t"; process.env.CRYPTO_SECRET_KEY = "t";
const HomeEvent = require("../models/homeEvent");
const retention = require("../utils/retention");

let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); await HomeEvent.init(); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

describe("log retention for the free database", () => {
    test("a long TTL is shortened in place, once, and DB_RETENTION=full leaves it alone", async () => {
        const ttl = async () => (await HomeEvent.collection.indexes()).find((i) => i.expireAfterSeconds !== undefined).expireAfterSeconds;
        expect(await ttl()).toBe(60 * 24 * 3600);
        process.env.DB_RETENTION = "full";
        expect((await retention.apply()).length).toBe(0);
        expect(await ttl()).toBe(60 * 24 * 3600);
        delete process.env.DB_RETENTION;
        const changed = await retention.apply();
        expect(changed.find((c) => /homeevents/i.test(c.collection)).to).toBe(3 * 24 * 3600);
        expect(await ttl()).toBe(3 * 24 * 3600);
        expect((await retention.apply()).length).toBe(0);                   // nothing more to do
    });
    test("the usage report lists collections by size", async () => {
        await HomeEvent.create({ owner: new mongoose.Types.ObjectId(), kind: "online", text: "x" });
        const u = await retention.usage();
        expect(u.collections.some((c) => /homeevents/i.test(c.collection) && c.documents === 1)).toBe(true);
        expect(u.capMB).toBe(512);
    });
});
