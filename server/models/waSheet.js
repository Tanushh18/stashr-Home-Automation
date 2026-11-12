const mongoose = require("mongoose");

// A list of people to message (a lead sheet, or a group made from Google contacts) with its own message and picture.
const waSheetSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    source: { type: String, enum: ["leads", "contacts", "manual"], default: "manual" },
    enabled: { type: Boolean, default: false },                   // a new or imported sheet sends nothing until it is switched on here
    dailyLimit: { type: Number, default: 0, min: 0, max: 60 },    // 0: only the account limit applies
    texts: { type: [String], default: [] },                        // one is picked at random for each message
    image: { type: String, default: "" },                          // the first picture (older sheets); see images
    imageType: { type: String, default: "" },
    images: { type: [{ data: String, mime: String, _id: false }], default: [] }   // up to 5 pictures (data URLs, 2 MB each); one is picked at random for each message
}, { timestamps: true });
waSheetSchema.index({ owner: 1, name: 1 }, { unique: true });

module.exports = mongoose.models.WaSheet || mongoose.model("WaSheet", waSheetSchema);
