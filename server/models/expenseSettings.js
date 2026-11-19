const mongoose = require("mongoose");

// One per account: how the money feature is set up. NO transactions are kept here: they are either in the encrypted collection
// ExpenseTx (storage "db", the default) or only in the owner's Google Sheet (storage "sheet"). Stored here: which of the two, the
// optional sheet link, the owner's own category rules, the start date and when the last SMS batch arrived.
const expenseSettingsSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    storage: { type: String, enum: ["db", "sheet"], default: "db" },
    sheetId: { type: String, default: "" },
    sheetUrl: { type: String, default: "" },
    tab: { type: String, default: "Transactions" },
    rules: { type: [mongoose.Schema.Types.Mixed], default: [] },       // [{ match: "swiggy", category: "Food" }]
    categories: { type: [String], default: [] },                      // extra categories the owner added
    startDate: { type: String, default: "" },                       // chosen once: SMS older than this are never read
    knownAccounts: { type: [String], default: [] },                  // account endings (X9229) seen on genuine messages
    lastArchiveDay: { type: String, default: "" },
    retentionMonths: { type: Number, default: 4 },
    lastSmsAt: { type: Number, default: 0 },                          // newest SMS time already handled (ms)
    lastSyncAt: { type: Date },
    copyErrors: { type: Number, default: 0 },                        // failed writes to the optional sheet copy since the last success
    lastCopyError: { type: String, default: "" },
    lastCopyAt: { type: Date },
    budgets: { type: mongoose.Schema.Types.Mixed, default: {} },     // { Food: 8000 } monthly limit per category
    goals: { type: [mongoose.Schema.Types.Mixed], default: [] },     // [{ name, target, saved }]
    alertsSent: { type: mongoose.Schema.Types.Mixed, default: {} },  // { "2026-11|Food|near": true } so each budget alert goes out once
    lastStatement: { type: mongoose.Schema.Types.Mixed, default: null }, // summary numbers of the last reconcile (no rows)
    // The website's Refresh asks the phone (the only thing that can read the bank SMS) to look now; the phone answers with an ack.
    // Set when the owner moves the start date EARLIER on the website: the phone then reads the older messages again (once).
    rescanToken: { type: Number, default: 0 },
    syncRequestedAt: { type: Number, default: 0 },
    syncAckAt: { type: Number, default: 0 },
    phoneResult: { type: mongoose.Schema.Types.Mixed, default: null }  // { at, added, flagged, duplicates, skipped, error } of the phone's last pass
}, { minimize: false });

module.exports = mongoose.models.ExpenseSettings || mongoose.model("ExpenseSettings", expenseSettingsSchema);
