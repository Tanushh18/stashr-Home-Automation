const mongoose = require("mongoose");

// A We Three lead that must be deleted because the Stashr sheet it came from was deleted "here and in We Three".
// Kept in the database so the work survives a restart and a We Three that is down for a while; the sweep removes each entry once We Three has deleted the lead.
const waLeadDeleteSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    externalId: { type: String, required: true },
    list: { type: String, default: "" },                       // the sheet's name, so its (empty) list can be removed afterwards
    tries: { type: Number, default: 0 }
}, { timestamps: true });
waLeadDeleteSchema.index({ owner: 1, externalId: 1 }, { unique: true });

module.exports = mongoose.models.WaLeadDelete || mongoose.model("WaLeadDelete", waLeadDeleteSchema);
