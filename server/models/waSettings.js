const mongoose = require("mongoose");

// One per account: the WhatsApp sender run from the tablet (on/off, daily limit, sending window, gap between messages).
const waSettingsSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    timezone: { type: String, default: "Asia/Kolkata" },
    dailyLimit: { type: Number, default: 13, min: 0, max: 60 },   // messages a day, spread over the window
    from: { type: String, default: "10:00" },
    to: { type: String, default: "18:00" },
    windowV2: { type: Boolean, default: true },                   // false/missing: an older account whose 10:00 to 19:00 default is moved to 18:00 once
    gapMin: { type: Number, default: 6, min: 1, max: 120 },       // minutes between two messages: random in [gapMin, gapMax]
    gapMax: { type: Number, default: 12, min: 1, max: 240 },
    reportNowDay: { type: String, default: "" },                  // set by "Send the report now": that day's report goes out at once
    reportEnabled: { type: Boolean, default: true },              // a WhatsApp report each night when the day's sending is done
    reportNumbers: { type: [String], default: ["918130483894", "919310994032"] },
    testMode: { type: Boolean, default: false },                  // ignores the window, the daily limit, the gap and the rest days (for testing)
    // Rest days: each week this many days are picked at random when nothing goes out (see utils/waRhythm.js).
    restDaysPerWeek: { type: Number, default: 2, min: 0, max: 3 },
    // The picked weeks, oldest first (the last 8 are kept, so a new week can avoid the days of the weeks before it).
    restWeeks: { type: [{ week: String, days: [String], perWeek: Number, count: Number, _id: false }], default: [] },
    // Today's own plan: how many messages, when sending starts and stops, the lunch break and the rounds (minutes since midnight), picked once a day.
    dayPlan: {
        type: new mongoose.Schema({
            day: String, target: Number, start: Number, end: Number, basis: String,
            lunch: { type: new mongoose.Schema({ start: Number, end: Number }, { _id: false }), default: null },
            rounds: { type: [{ at: Number, count: Number, _id: false }], default: undefined }
        }, { _id: false }),
        default: null
    },
    nextDueAt: { type: Date, default: null },
    lastTickAt: { type: Date, default: null },
    status: { type: String, default: "" }                         // what the sender is doing now, shown on the website
}, { timestamps: true });

module.exports = mongoose.models.WaSettings || mongoose.model("WaSettings", waSettingsSchema);
