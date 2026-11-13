const mongoose = require("mongoose");

// A device that reports to Stashr Home: the TV launcher ("tv"), the always-on tablet ("hub") or a family phone ("phone").
// The device token is shown once when the device is added; only its SHA-256 is stored.
const commandSchema = new mongoose.Schema({
    id: { type: String, required: true },
    type: { type: String, required: true },
    args: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["pending", "sent", "done", "failed"], default: "pending" },
    result: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    doneAt: { type: Date }
}, { _id: false });

const homeDeviceSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    kind: { type: String, enum: ["tv", "hub", "phone"], required: true },
    // Phone only: whose phone it is, for "who is home".
    person: { type: String, default: "" },
    // A device with its own token (the tablet). A TV that reports through the tablet has no token of its own.
    tokenHash: { type: String, unique: true, sparse: true },
    // Set on a device that reports through another one (the TV through the tablet).
    parent: { type: mongoose.Schema.Types.ObjectId, index: true },
    childKey: { type: String },
    tokenHint: { type: String, default: "" },
    status: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastSeen: { type: Date },
    online: { type: Boolean, default: false },
    // Paused from the website: the device stays linked, but its reports are not stored and it is shown as offline until resumed.
    syncPaused: { type: Boolean, default: false },
    onlineSince: { type: Date },
    // Hub only: every device the tablet has seen on the Wi-Fi, keyed by address, with first/last seen.
    lanBook: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Hub only: names and rooms you gave to devices, keyed the same way.
    lanLabels: { type: mongoose.Schema.Types.Mixed, default: {} },
    commands: { type: [commandSchema], default: [] },
    // Phone only: its Firebase push address (so the server can ask it to report where it is), and when it was last asked.
    // fcmFixAt is the phone's fix time at the last ask: if it has not moved since, the phone did not answer (off, killed, no signal).
    // Phone only: the person turned "room location" on for this phone (it then sends Wi-Fi/Bluetooth scans, and Stashr says which room it is in).
    roomOn: { type: Boolean, default: false },
    // Room location, measured in real life: how often the person said the room was right ("Sahi hai") or wrong ("Galat hai, main X mein hoon").
    roomStats: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Room location auto-improve for this phone: { off, added, lastAt, lastRoom, pausedUntil, pauseWhy, guard: { at, with, without, tested } }.
    roomAuto: { type: mongoose.Schema.Types.Mixed, default: {} },
    // The kernel width picked for this phone by measuring (utils/roomModel.tune, hourly): { width, accuracy, unsure, wrong, tested, tried, at, best, alertAt }.
    roomTune: { type: mongoose.Schema.Types.Mixed, default: {} },
    fcmToken: { type: String, default: "", select: false },
    fcmSet: { type: Boolean, default: false },     // the token above exists (the token itself is never sent to a page)
    fcmSeenAt: { type: Date },
    fcmPushedAt: { type: Date },
    fcmFixAt: { type: Number },
    fcmMisses: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
}, { minimize: false });

module.exports = mongoose.models.HomeDevice || mongoose.model("HomeDevice", homeDeviceSchema);
