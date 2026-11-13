const mongoose = require("mongoose");

// One labelled scan: "this is what the phone heard in the Kitchen". The Wi-Fi and Bluetooth ids are hashed (utils/roomModel.hashId), so
// neighbours' network names are never stored. Each phone has its own samples (every phone hears a little differently). Gone after 120 days.
const hear = new mongoose.Schema({ b: { type: String, required: true }, r: { type: Number, required: true } }, { _id: false });
const homeRoomSampleSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true },
    phone: { type: mongoose.Schema.Types.ObjectId, required: true },
    room: { type: String, required: true, maxlength: 24 },
    session: { type: String, default: "" },          // the tap that made it: scans of one tap are hidden together when the accuracy is tested
    // "train" = "main yahan hoon", "fix" = the person said "wrong, I am in X", "confirm" = "Sahi hai" with a scan,
    // "auto" = a live scan the model was very sure about (auto-improve, see utils/roomModel.autoGate)
    src: { type: String, enum: ["train", "fix", "confirm", "auto"], default: "train" },
    wifi: { type: [hear], default: [] },
    ble: { type: [hear], default: [] },
    at: { type: Date, default: Date.now, expires: 120 * 24 * 3600 }
});
homeRoomSampleSchema.index({ owner: 1, phone: 1, room: 1, at: -1 });

module.exports = mongoose.models.HomeRoomSample || mongoose.model("HomeRoomSample", homeRoomSampleSchema);
