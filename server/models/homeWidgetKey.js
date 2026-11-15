const mongoose = require("mongoose");

// A read-only key for ONE phone's home-screen widgets. It can fetch the home dashboard (who is home, weather, TV, scenes) and
// nothing else: it is not a login, cannot run a command and cannot read the vault. Only its SHA-256 is stored; the owner can
// list and revoke keys. A phone that loses its key just asks for a new one.
const schema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, default: "Phone widgets", maxlength: 60 },
    hash: { type: String, required: true, unique: true },
    hint: { type: String, default: "" },                 // last 4 characters, to tell keys apart in a list
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null }
});

module.exports = mongoose.models.HomeWidgetKey || mongoose.model("HomeWidgetKey", schema);
