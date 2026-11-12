const mongoose = require("mongoose");

// The record of every message handed to the tablet. The counts on the website and the daily limit are read from here,
// so what the website shows is what actually went out.
const waSendSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true },
    sheet: { type: mongoose.Schema.Types.ObjectId, index: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, index: true },
    phone: { type: String, default: "" },
    name: { type: String, default: "" },
    text: { type: String, default: "" },
    kind: { type: String, enum: ["scheduled", "test", "report"], default: "scheduled" },
    imageIndex: { type: Number, default: 0 },                      // which of the sheet's pictures this message uses
    status: { type: String, enum: ["queued", "sent", "failed"], default: "queued", index: true },
    result: { type: String, default: "" },
    device: { type: mongoose.Schema.Types.ObjectId },
    commandId: { type: String, default: "", index: true },
    day: { type: String, default: "", index: true },               // the account's local date, "2026-11-12"
    queuedAt: { type: Date, default: Date.now },
    doneAt: Date
}, { timestamps: true });
waSendSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.models.WaSend || mongoose.model("WaSend", waSendSchema);
