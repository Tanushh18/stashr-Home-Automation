/* Admin only: where the database move stands, and a button to run or stop it. See db/legacy.js and utils/dbMigrate.js. */
const express = require("express");
const router = express.Router();
const authenticate = require("../middlewares/authenticate");
const registry = require("./registry");
const migrate = require("../utils/dbMigrate");

const requireAdmin = (req, res, next) => (registry.isAdminUser(req.rootUser) ? next() : res.status(403).json({ error: "Not allowed." }));

router.get("/system/db", authenticate, requireAdmin, async (req, res) => {
  try { res.set("Cache-Control", "no-store"); return res.json(await migrate.status()); }
  catch (e) { return res.status(500).json({ error: "Could not read the database status." }); }
});
router.post("/system/db/migrate", authenticate, requireAdmin, (req, res) => {
  migrate.run().then((r) => console.log("Old to new copy:", r.full ? "paused at the size cap" : "finished a pass")).catch((e) => console.error("Old to new copy failed:", e.message));
  return res.status(202).json({ started: true });
});
router.post("/system/db/stop", authenticate, requireAdmin, (req, res) => { migrate.stop(); return res.json({ stopping: true }); });

const bandwidth = require("../middlewares/bandwidth");
router.get("/system/bandwidth", authenticate, requireAdmin, (req, res) => { res.set("Cache-Control", "no-store"); return res.json(bandwidth.report(Math.min(60, Number(req.query.limit) || 25))); });
router.post("/system/bandwidth/reset", authenticate, requireAdmin, (req, res) => { bandwidth.reset(); return res.json({ reset: true }); });

module.exports = router;
