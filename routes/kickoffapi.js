// prediction-backend/routes/kickoffapi.js  (new file)
const express = require("express");
const router = express.Router();
const { kickoff, normalizeFixture, settleFromScore } = require("../services/kickoffapi");

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
// Only these query params can be passed through on the public routes
const PUBLIC_PARAMS = ["league", "season", "team", "date", "limit", "cursor"];
function pickParams(q) {
  const out = {};
  for (const k of PUBLIC_PARAMS) if (q[k]) out[k] = String(q[k]);
  if (!out.limit) out.limit = "50";
  return out;
}

router.get("/fixtures", async (req, res) => {
  try {
    const data = await kickoff("/fixtures", pickParams(req.query), 300);
    res.json({ fixtures: data.data.map(normalizeFixture), nextCursor: data.meta?.nextCursor ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/results", async (req, res) => {
  try {
    const data = await kickoff("/fixtures", pickParams(req.query), 120);
    res.json(data.data.filter((f) => f.status.short !== "NS").map(settleFromScore));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;
