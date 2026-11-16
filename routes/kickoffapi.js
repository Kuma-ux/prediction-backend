// prediction-backend/routes/kickoffapi.js  (new file)
const express = require("express");
const router = express.Router();
const { kickoff, normalizeFixture, settleFromScore, fetchSettlement } = require("../services/kickoffapi");
const { LEAGUES, buildEventPayload, buildMarketPayloads } = require("../services/marketTemplates");

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
router.get("/debug/full", async (req, res) => {
  const { id, secret } = req.query;
  if (!process.env.DEBUG_SECRET || secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }
  if (!/^[\w-]+$/.test(id || "")) return res.status(400).json({ error: "bad id" });

  const out = {};
  for (const part of ["", "/events", "/statistics", "/lineups"]) {
    const name = part ? part.slice(1) : "fixture";
    try {
      out[name] = await kickoff(`/fixtures/${id}${part}`, {}, 60);
    } catch (e) {
      out[name] = { error: e.message };
    }
  }
  res.json(out);
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
router.get("/settlement/:id", async (req, res) => {
  if (!process.env.DEBUG_SECRET || req.query.secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }
  if (!/^[\w-]+$/.test(req.params.id)) return res.status(400).json({ error: "bad id" });
  try {
    res.json(await fetchSettlement(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get("/preview", async (req, res) => {
  if (!process.env.DEBUG_SECRET || req.query.secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }
  try {
    const out = [];
    for (const leagueId of Object.keys(LEAGUES)) {
      const data = await kickoff("/fixtures", { league: leagueId, limit: "50" }, 300);
      const rows = data.data || [];
      const filterIgnored = rows.some((f) => f.league.id !== leagueId);
      for (const raw of rows.filter((f) => f.league.id === leagueId && f.status.short === "NS")) {
        const f = normalizeFixture(raw);
        out.push({
          warning: filterIgnored ? "API ignored the league filter; results were filtered by us" : null,
          event: buildEventPayload(f),
          markets: buildMarketPayloads(f).map((m) => ({
            key: m.templateKey, title: m.payload.title, options: m.payload.options,
            closes: m.payload.end_date,
          })),
        });
      }
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;
