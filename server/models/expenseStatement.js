const mongoose = require("mongoose");

// A bank statement the owner uploaded on the Money page, kept so its lines can be searched later (name or amount). The file itself is never
// stored, only its lines (models/expenseStatementLine.js). Kept until the owner deletes it; there is no automatic expiry.
const expenseStatementSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    filename: { type: String, default: "" },
    month: { type: String, default: "" },             // YYYY-MM the owner chose to match, or "" for the whole statement
    from: { type: String, default: "" },              // first and last date among the saved lines
    to: { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.ExpenseStatement || mongoose.model("ExpenseStatement", expenseStatementSchema);
