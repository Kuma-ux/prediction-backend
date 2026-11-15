// prediction-backend/routes/kickoffapi.js  (new file)
const express = require("express");
const router = express.Router();
const { kickoff } = require("../services/kickoffapi");

// Only these paths can be called through the test route
const ALLOWED = [
  /^\/leagues$/,
  /^\/fixtures$/,
  /^\/fixtures\/[\w-]+(\/(events|statistics|lineups))?$/,
];

// TEMPORARY: delete this route once we've seen the real data
router.get("/debug", async (req, res) => {
  const { path, secret, ...params } = req.query;
  if (!process.env.DEBUG_SECRET || secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }
  if (!ALLOWED.some((r) => r.test(path || ""))) {
    return res.status(400).json({ error: "path not allowed" });
  }
  try {
    res.json(await kickoff(path, params, 60));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
