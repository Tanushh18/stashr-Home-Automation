const mongoose = require("mongoose");

// The ggnHome admin session Stashr holds for its owner. Only the sealed access token is kept (never the OTP).
const schema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    mobile: { type: String, default: "" },
    name: { type: String, default: "" },
    sealed: { type: String, required: true },
    expiresAt: { type: Date, default: null },
    connectedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.GgnAdminLink || mongoose.model("GgnAdminLink", schema);
