const mongoose = require("mongoose");

// One line of a saved bank statement. What says who was paid, how much and the balance is inside `enc`, sealed with the account's own data key
// (like Money entries). Only the date, the month and a keyed hash (to stop the same line being saved twice) stay readable.
// Uploading an overlapping statement again moves the shared lines to the newest upload instead of doubling them.
const expenseStatementLineSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true },
    statement: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    month: { type: String, required: true },          // YYYY-MM
    date: { type: String, required: true },           // YYYY-MM-DD
    hash: { type: String, required: true },           // HMAC-SHA256 under the account's data key
    enc: { type: String, required: true }             // "gcm:iv:tag:ciphertext" of { desc, amount, type, balance, ref }
});
expenseStatementLineSchema.index({ owner: 1, hash: 1 }, { unique: true });
expenseStatementLineSchema.index({ owner: 1, month: 1, date: -1 });

module.exports = mongoose.models.ExpenseStatementLine || mongoose.model("ExpenseStatementLine", expenseStatementLineSchema);
