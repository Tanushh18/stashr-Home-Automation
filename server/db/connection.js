const mongoose = require("mongoose");
require("./legacy");     // wraps queries once; does nothing until an old database is attached

// Accept the common variable names so the same code runs locally and on Render
const databaseUrl = () => process.env.MONGO_URL || process.env.DATABASE || process.env.MONGODB_URI;

// A second, empty database (e.g. a fresh 512 MB free tier). When set, it takes every write and the database in MONGO_URL becomes the
// old, read-only one (see db/legacy.js).
const newDatabaseUrl = () => process.env.MONGO_URL_NEW || process.env.MONGODB_URI_NEW || process.env.DATABASE_NEW;

const connect = async (url = databaseUrl()) =>
{
    const fresh = newDatabaseUrl();
    if (fresh && url && fresh !== url) return connectBoth(url, fresh);
    if (!url)
    {
        console.error("No database URL found. Set MONGO_URL (or DATABASE) in your environment.");
        return null;
    }

    mongoose.connection.on("disconnected", () => console.warn("Database disconnected."));
    mongoose.connection.on("reconnected", () => console.log("Database reconnected."));
    mongoose.connection.on("error", (error) => console.error("Database error:", error.message));

    try
    {
        await mongoose.connect(url);
        console.log("Connection success.");
        require("../utils/retention").apply().then((c) => { if (c.length) console.log("Shortened log retention:", c); }).catch(() => {});
        if (process.env.PHOTO_DATA_CLEANUP === "true") require("../utils/photoCleanup").run().then((r) => console.log("Photo data cleanup (PHOTO_DATA_CLEANUP=true):", r)).catch((e) => console.error("Photo data cleanup failed:", e.message));
    }
    catch (error)
    {
        console.log("Database connection failed:", error.message);
    }
    return mongoose.connection;
};

async function connectBoth(oldUrl, newUrl)
{
    const legacy = require("./legacy");
    mongoose.connection.on("error", (error) => console.error("Database error:", error.message));
    try
    {
        await mongoose.connect(newUrl);
        console.log("New database connected (all writes go here).");
        require("../utils/retention").apply().catch(() => {});
        if (process.env.PHOTO_DATA_CLEANUP === "true") require("../utils/photoCleanup").run().then((r) => console.log("Photo data cleanup (PHOTO_DATA_CLEANUP=true):", r)).catch((e) => console.error("Photo data cleanup failed:", e.message));
    }
    catch (error)
    {
        console.log("New database connection failed:", error.message);
        return mongoose.connection;
    }
    try
    {
        const old = await mongoose.createConnection(oldUrl).asPromise();
        old.on("error", (error) => console.error("Old database error:", error.message));
        legacy.attach(old);
        await require("../utils/dbMigrate").loadDrained();
        console.log("Old database attached (read only; copied over as it is used).");
        if (process.env.MIGRATE_AUTO !== "false") setTimeout(() => require("../utils/dbMigrate").run().then((r) => console.log("Old to new copy:", r.full ? "paused at the size cap" : "finished a pass")).catch((e) => console.error("Old to new copy failed:", e.message)), 30000);
    }
    catch (error)
    {
        console.log("Old database could not be attached, running on the new one only:", error.message);
    }
    return mongoose.connection;
}

module.exports = { connect, databaseUrl, newDatabaseUrl };
