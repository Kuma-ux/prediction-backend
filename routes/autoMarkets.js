// prediction-backend/routes/autoMarkets.js  (new file)
const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { getStatus } = require("../services/autoMarkets");

router.get("/suggestions", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT fm.market_id, m.title AS market_title, fe.title AS fixture, fe.kickoff,
             fm.suggestion_action AS action, fm.suggested_outcomes AS outcomes,
             fm.suggestion_reason AS reason, fm.suggested_at, fm.suggestion_data AS data
      FROM fixture_markets fm
      JOIN fixture_events fe ON fe.fixture_id = fm.fixture_id
      JOIN markets m ON m.id = fm.market_id
      WHERE fm.status = 'suggested'
      ORDER BY fe.kickoff ASC`);
    res.json({ success: true, count: r.rowCount, suggestions: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/status", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`SELECT status, COUNT(*)::int AS n FROM fixture_markets GROUP BY status`);
    res.json({ success: true, ...getStatus(), marketsByStatus: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
