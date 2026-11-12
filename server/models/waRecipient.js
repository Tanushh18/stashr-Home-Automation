const mongoose = require("mongoose");

// One person in a sheet. status: pending -> queued (handed to the tablet) -> sent | failed | skipped (not on WhatsApp, or a duplicate).
const waRecipientSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true },
    sheet: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, default: "", maxlength: 120 },
    phone: { type: String, required: true },                       // digits with the country code, e.g. 919810012345
    status: { type: String, enum: ["pending", "queued", "sent", "failed", "skipped"], default: "pending", index: true },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: "" },
    queuedAt: Date,
    sentAt: Date,
    externalId: { type: String, default: "" },                     // the lead's id in We Three, so the "sent" mark can go back
    order: { type: Number, default: 0 }
}, { timestamps: true });
waRecipientSchema.index({ owner: 1, sheet: 1, phone: 1 }, { unique: true });
waRecipientSchema.index({ owner: 1, status: 1, order: 1 });

module.exports = mongoose.models.WaRecipient || mongoose.model("WaRecipient", waRecipientSchema);
