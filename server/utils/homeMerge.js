/**
 * Merges two entries of the same device (a tablet, TV or phone that was linked again under another name): everything recorded for the
 * old entry (events, trail, room samples, places, the live link, Wi-Fi sightings) is moved to the one you keep, and the old entry is removed.
 * Nothing is lost except the old entry's own token, which stops working (the device must use the new one).
 */
const mongoose = require("mongoose");
const HomeDevice = require("../models/homeDevice");
const HomeEvent = require("../models/homeEvent");
const { HomeApSeen } = require("../models/homeApSeen");
const HomeSpeed = require("../models/homeSpeed");
const HomePlaceFix = require("../models/homePlaceFix");
const HomeTrack = require("../models/homeTrack");
const HomeRoomSample = require("../models/homeRoomSample");
const HomeSettings = require("../models/homeSettings");
const WaSend = require("../models/waSend");

const fail = (status, error) => Object.assign(new Error(error), { status });

/** Moves rows one by one so a row that would collide with an existing one (unique index) is dropped instead of failing the merge. */
async function moveRows(Model, field, from, into, extra = {}) {
    const rows = await Model.find({ [field]: from }).select("_id").lean();
    for (const r of rows) {
        try { await Model.updateOne({ _id: r._id }, { $set: { [field]: into, ...extra } }); }
        catch (e) { if (e && e.code === 11000) await Model.deleteOne({ _id: r._id }); else throw e; }
    }
    return rows.length;
}

async function mergeDevices(owner, fromId, intoId) {
    if (!mongoose.isValidObjectId(fromId) || !mongoose.isValidObjectId(intoId)) throw fail(404, "Device not found.");
    if (String(fromId) === String(intoId)) throw fail(400, "Pick two different devices.");
    const [from, into] = await Promise.all([HomeDevice.findOne({ _id: fromId, owner }), HomeDevice.findOne({ _id: intoId, owner })]);
    if (!from || !into) throw fail(404, "Device not found.");
    if (from.kind !== into.kind) throw fail(400, "Only two devices of the same kind can be merged (a phone with a phone, a tablet with a tablet).");
    if (from.parent || into.parent) throw fail(400, "A device that reports through the tablet cannot be merged.");

    const moved = {};
    moved.events = await moveRows(HomeEvent, "device", from._id, into._id, { deviceName: into.name });
    moved.wifi = await moveRows(HomeApSeen, "device", from._id, into._id);
    moved.speed = await moveRows(HomeSpeed, "device", from._id, into._id);
    moved.trail = await moveRows(HomePlaceFix, "phone", from._id, into._id) + await moveRows(HomeTrack, "phone", from._id, into._id);
    moved.rooms = await moveRows(HomeRoomSample, "phone", from._id, into._id);
    await WaSend.updateMany({ owner, device: from._id }, { $set: { device: into._id } });
    await HomeDevice.updateMany({ owner, parent: from._id }, { $set: { parent: into._id } });   // a TV that reported through the old tablet

    // Places and the live link name phones by id.
    const settings = await HomeSettings.findOne({ owner });
    if (settings) {
        const a = String(from._id), b = String(into._id);
        const places = (settings.places || []).map((p) => (p && String(p.phone) === a ? { ...p, phone: into._id } : p));
        const share = settings.share && typeof settings.share === "object" ? { ...settings.share } : {};
        if (Array.isArray(share.phones)) share.phones = [...new Set(share.phones.map((x) => (String(x) === a ? b : String(x))))];
        settings.places = places; settings.share = share;
        settings.markModified("places"); settings.markModified("share");
        await settings.save();
    }

    // What the kept entry lacks is filled in from the old one; what it already has wins.
    const set = {};
    if (!into.person && from.person) set.person = from.person;
    if (from.roomOn && !into.roomOn) set.roomOn = true;
    if (from.lanBook && Object.keys(from.lanBook).length) set.lanBook = { ...from.lanBook, ...(into.lanBook || {}) };
    if (from.lanLabels && Object.keys(from.lanLabels).length) set.lanLabels = { ...from.lanLabels, ...(into.lanLabels || {}) };
    if (from.roomStats && Object.keys(from.roomStats).length) set.roomStats = { ...from.roomStats, ...(into.roomStats || {}) };
    if (Object.keys(set).length) await HomeDevice.updateOne({ _id: into._id }, { $set: set });
    await HomeDevice.deleteOne({ _id: from._id });
    return { kept: String(into._id), removed: String(from._id), moved };
}

module.exports = { mergeDevices };
