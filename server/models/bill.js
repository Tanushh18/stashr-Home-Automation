const mongoose = require("mongoose");

// One bill to pay (electricity, water, gas, broadband, a card...). The consumer/customer number and the notes are sensitive, so they
// live inside `enc`, sealed with the account's own data key (the same envelope encryption as the vault and the Money list).
// What the list needs to sort and remind stays readable: the provider's name, the dates, the amount and the status.
const billSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },     // provider / what it is ("Electricity - BSES")
    enc: { type: String, default: "" },                                    // "gcm:..." of { account, notes }
    amount: { type: Number, default: null, min: 0 },                       // null: not known yet
    billDate: { type: String, default: "" },                               // YYYY-MM-DD, "" when unknown
    dueDate: { type: String, required: true },                             // YYYY-MM-DD
    status: { type: String, enum: ["unpaid", "paid"], default: "unpaid" },
    paidAt: { type: String, default: "" },                                 // YYYY-MM-DD the money went out
    paidAmount: { type: Number, default: null },
    txIndex: { type: String, default: "" },                                // the Money entry made when it was paid
    repeat: { type: Boolean, default: false },                             // monthly: paying it makes next month's bill
    nextOf: { type: mongoose.Schema.Types.ObjectId, default: null },       // the bill this one was repeated from
    notifiedDay: { type: String, default: "" }                             // the last day Telegram was told about it
}, { timestamps: true });
billSchema.index({ owner: 1, status: 1, dueDate: 1 });

module.exports = mongoose.models.Bill || mongoose.model("Bill", billSchema);
