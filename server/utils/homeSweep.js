const HomeDevice = require("../models/homeDevice");
const { ONLINE_MS, isOnline } = require("./home");
const { record } = require("./homeEvents");
const automation = require("./homeAutomation");
const phonePush = require("./phonePush");

const COMMAND_WAIT_MS = 10 * 60 * 1000;

/** Marks devices that stopped reporting as offline, and gives up on commands nobody answered. */
async function sweepOnce(now = Date.now()) {
    const quiet = await HomeDevice.find({ online: true, kind: { $ne: "phone" }, lastSeen: { $lt: new Date(now - ONLINE_MS) } });
    const stale = quiet.filter((d) => !isOnline(d, now));            // a tablet on its battery (above 20%) is given longer
    for (const d of stale) {
        const res = await HomeDevice.updateOne({ _id: d._id, online: true }, { $set: { online: false } });
        if (res.modifiedCount) {
            await record({ owner: d.owner, device: d._id, deviceName: d.name, kind: "offline", text: `⚠️ ${d.name} disconnected (no signal since ${new Date(d.lastSeen).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })})`, notify: true });
        }
    }
    const cut = new Date(now - COMMAND_WAIT_MS);
    await HomeDevice.updateMany(
        { commands: { $elemMatch: { status: { $in: ["pending", "sent"] }, createdAt: { $lt: cut } } } },
        { $set: { "commands.$[c].status": "failed", "commands.$[c].result": "No answer from the device", "commands.$[c].doneAt": new Date(now) } },
        { arrayFilters: [{ "c.status": { $in: ["pending", "sent"] }, "c.createdAt": { $lt: cut } }] }
    );
}

function startHomeSweep() {
    const timer = setInterval(() => {
        sweepOnce().catch((e) => console.log("[home] sweep failed:", e.message));
        automation.tickAll().catch((e) => console.log("[home] automations failed:", e.message));
        require("./waSender").tickAll().catch((e) => console.log("[wa] sender failed:", e.message));
        phonePush.nudgeStale().catch((e) => console.log("[home] phone push failed:", e.message));
    }, 60 * 1000);
    if (typeof timer.unref === "function") timer.unref();
}

module.exports = { sweepOnce, startHomeSweep };
