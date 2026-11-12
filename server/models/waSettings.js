const mongoose = require("mongoose");

// One per account: the WhatsApp sender run from the tablet (on/off, daily limit, sending window, gap between messages).
const waSettingsSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    timezone: { type: String, default: "Asia/Kolkata" },
    dailyLimit: { type: Number, default: 13, min: 0, max: 60 },   // messages a day, spread over the window
    from: { type: String, default: "10:00" },
    to: { type: String, default: "19:00" },
    gapMin: { type: Number, default: 6, min: 1, max: 120 },       // minutes between two messages: random in [gapMin, gapMax]
    gapMax: { type: Number, default: 12, min: 1, max: 240 },
    reportNowDay: { type: String, default: "" },                  // set by "Send the report now": that day's report goes out at once
    reportEnabled: { type: Boolean, default: true },              // a WhatsApp report each night when the day's sending is done
    reportNumbers: { type: [String], default: ["918130483894", "919310994032"] },
    testMode: { type: Boolean, default: false },                  // ignores the window, the daily limit and the gap (for testing)
    nextDueAt: { type: Date, default: null },
    lastTickAt: { type: Date, default: null },
    status: { type: String, default: "" }                         // what the sender is doing now, shown on the website
}, { timestamps: true });

module.exports = mongoose.models.WaSettings || mongoose.model("WaSettings", waSettingsSchema);
