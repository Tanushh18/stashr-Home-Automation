const mongoose = require("mongoose");

// One per account: the Smart home automations (alerts, TV schedules and limits, scenes, briefs, camera, slideshow).
const homeSettingsSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    timezone: { type: String, default: "Asia/Kolkata" },
    alerts: {
        newDevice: { type: Boolean, default: true },     // a device the Wi-Fi has never seen
        night: { type: Boolean, default: true },         // a device joins during the night window
        nightFrom: { type: String, default: "00:00" },
        nightTo: { type: String, default: "05:00" },
        emptyHomeTv: { type: Boolean, default: true },   // nobody is home and the TV is on
        camera: { type: Boolean, default: true },        // the tablet camera saw movement
        presence: { type: Boolean, default: false },     // someone came home or left (the full report)
        everything: { type: Boolean, default: true }     // every event on the Home timeline also goes to Telegram as one short line
    },
    weather: { city: { type: String, default: "" }, lat: Number, lon: Number },
    brief: { enabled: { type: Boolean, default: false }, time: { type: String, default: "08:00" }, lastSent: { type: String, default: "" } },
    weekly: { enabled: { type: Boolean, default: false }, lastSent: { type: String, default: "" } },
    tvLimit: {
        minutes: { type: Number, default: 0 },           // 0: no limit
        action: { type: String, enum: ["notify", "pause", "home"], default: "home" },
        lastEnforced: { type: String, default: "" },
        lateNight: { type: Boolean, default: true },     // tell you when the TV is still on late at night
        lateNightNotified: { type: String, default: "" }
    },
    // TV minutes per day, by app: { "2026-11-02": { minutes: 95, apps: { Netflix: 60, YouTube: 35 } } }. 35 days kept.
    usage: { type: mongoose.Schema.Types.Mixed, default: {} },
    schedules: { type: [mongoose.Schema.Types.Mixed], default: [] },
    scenes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    camera: { sensitivity: { type: Number, default: 5 }, video: { type: Boolean, default: true }, auto: { type: Boolean, default: false }, autoState: { type: mongoose.Schema.Types.Mixed, default: {} } },
    // Places: a family phone arrives at / leaves a spot, and the tablet sends a WhatsApp message to a group.
    places: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Where home is, for "Papa is 10 minutes away" (the phones' location shared with Stashr Hub).
    news: { enabled: { type: Boolean, default: true }, lang: { type: String, enum: ["en", "hi", "both"], default: "en" }, count: { type: Number, default: 6 } },
    rain: { type: Boolean, default: true },       // "Chhatri le lo" to the phone of someone who leaves when rain is likely
    // Shared secret for the tablet's local mode on the home Wi-Fi (the tablet and the TV use it to talk to each other when the server is unreachable).
    localKey: { type: String, default: "" },
    // Family insights: keep a location history for places, trips and the commute (off until the owner turns it on).
    history: { enabled: { type: Boolean, default: false }, speedKmh: { type: Number, default: 80 } },
    spots: { type: [mongoose.Schema.Types.Mixed], default: [] },   // named places: { id, name, lat, lon, radius }
    // Live map on the TV: phones that are out check their location every few seconds while the TV shows it.
    tvLive: { enabled: { type: Boolean, default: true } },
    liveUntil: { type: Date },
    // "Refresh location" on the page: until then every phone is asked for a fresh fix every few seconds.
    locateUntil: { type: Date },
    // The secret "see where I am live" link: { enabled, token, phones: [device ids; empty = every phone], createdAt, lastViewAt }
    share: { type: mongoose.Schema.Types.Mixed, default: {} },
    homeSpot: { lat: Number, lon: Number, radius: { type: Number, default: 200 } },
    eta: { enabled: { type: Boolean, default: true }, maxKm: { type: Number, default: 40 }, notifyMinutes: { type: Number, default: 15 }, routing: { type: Boolean, default: true }, toTablet: { type: Boolean, default: true }, toTv: { type: Boolean, default: true }, toPhones: { type: Boolean, default: true } },
    locationCode: { type: String, default: "", index: true },
    // The fixed code that links the home tablet (Stashr Hub). Separate from locationCode: a tablet can see the dashboard and photos.
    hubCode: { type: String, default: "", index: true },
    etaState: { type: mongoose.Schema.Types.Mixed, default: {} },
    emptyHomeNotifiedAt: { type: Date },
    presenceState: { type: mongoose.Schema.Types.Mixed, default: {} },
    // The house map: names you gave the learned zones, the optional floor-plan picture, and what the last learning pass found (to tell you about a new zone).
    map: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { minimize: false });

homeSettingsSchema.index({ "share.token": 1 }, { sparse: true });

module.exports = mongoose.models.HomeSettings || mongoose.model("HomeSettings", homeSettingsSchema);
