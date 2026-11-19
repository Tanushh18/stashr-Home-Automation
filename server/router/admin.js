const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const User = require("../models/schema");
const authenticate = require("../middlewares/authenticate");
const { CATALOG, BY_KEY, resolveFeatures, isAdminEmail } = require("../utils/features");
const { serverError } = require("./helpers");
const AuditEvent = require("../models/AuditEvent");
const Registry = require("../models/registry");

/* Admin panel API: who has an account, and which features each person sees. Administrators only. */
const adminOnly = (req, res, next) => (isAdminEmail(req.rootUser?.email) ? next() : res.status(403).json({ error: "Not allowed." }));

const shape = (u) => ({
    id: String(u._id), email: u.email, name: u.name || "", createdAt: u.createdAt || null,
    isAdmin: isAdminEmail(u.email), overrides: u.featureOverrides || {}, features: resolveFeatures(u.email, u.featureOverrides)
});

router.get("/admin/features", authenticate, adminOnly, (req, res) => res.json({ features: CATALOG }));

router.get("/admin/users", authenticate, adminOnly, async (req, res) => {
    try {
        const q = String(req.query.q || "").trim().toLowerCase().slice(0, 80);
        const filter = q ? { email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") } } : {};
        const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit, 10) || 200));
        const [users, total] = await Promise.all([
            User.find(filter, "email name createdAt featureOverrides").sort({ createdAt: -1 }).limit(limit).lean(),
            User.countDocuments(filter)
        ]);
        res.set("Cache-Control", "no-store");
        return res.json({ users: users.map(shape), total, features: CATALOG });
    } catch (error) { return serverError(res, "admin/users", error); }
});

/* Set one switch for one person: enabled true/false, or null to go back to the default for that feature. */
router.put("/admin/users/:id/features", authenticate, adminOnly, async (req, res) => {
    const { key, enabled } = req.body || {};
    const feature = BY_KEY.get(key);
    if (!feature) return res.status(400).json({ error: "Unknown feature." });
    if (feature.locked) return res.status(400).json({ error: "This feature follows the account type and cannot be changed per person." });
    if (enabled !== null && typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true, false or null." });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "User not found." });
    try {
        const update = enabled === null ? { $unset: { [`featureOverrides.${key}`]: "" } } : { $set: { [`featureOverrides.${key}`]: enabled } };
        const user = await User.findOneAndUpdate({ _id: req.params.id }, update, { returnDocument: "after", projection: "email name createdAt featureOverrides" }).lean();
        if (!user) return res.status(404).json({ error: "User not found." });
        console.info(`[admin] ${req.rootUser.email} set ${key}=${enabled} for user=${user._id}`);
        return res.json({ user: shape(user) });
    } catch (error) { return serverError(res, "admin/users/features", error); }
});

/* Deletes one person and every record of theirs: the account document (passwords, projects, connected accounts,
   photo data, sessions, tokens) and everything stored apart from it. The admin types the email to confirm. */
router.delete("/admin/users/:id", authenticate, adminOnly, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "User not found." });
    try {
        const user = await User.findById(req.params.id, "email").lean();
        if (!user) return res.status(404).json({ error: "User not found." });
        if (String(user._id) === String(req.rootUser._id)) return res.status(400).json({ error: "You cannot delete your own account here." });
        if (isAdminEmail(user.email)) return res.status(400).json({ error: "Administrator accounts cannot be deleted here." });
        const confirm = String((req.body && req.body.confirmEmail) || "").trim().toLowerCase();
        if (!confirm || confirm !== String(user.email || "").toLowerCase()) return res.status(400).json({ error: "Type the person's email address to confirm." });

        const id = user._id;
        const [account, audit, lists] = await Promise.all([
            User.deleteOne({ _id: id }),
            AuditEvent.deleteMany({ userId: id }),
            Registry.deleteMany({ owner: id })
        ]);
        console.info(`[admin] ${req.rootUser.email} deleted user=${id}`);
        return res.json({
            deleted: account.deletedCount === 1,
            removed: { account: account.deletedCount, activityLog: audit.deletedCount, serverLists: lists.deletedCount }
        });
    } catch (error) { return serverError(res, "admin/users delete", error); }
});

module.exports = router;
