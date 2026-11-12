const mongoose = require("mongoose");

// The We Three account Stashr reads leads from. Only the refresh token is kept, sealed; the MPIN is never stored.
const waLinkSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    mobile: { type: String, default: "" },
    name: { type: String, default: "" },
    sealed: { type: String, required: true },
    connectedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.WaLink || mongoose.model("WaLink", waLinkSchema);
