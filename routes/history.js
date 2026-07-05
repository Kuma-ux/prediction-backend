// routes/history.js

const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/:marketId", async (req, res) => {
  try {
    const { marketId } = req.params;

    const historyRes = await pool.query(
      `
      SELECT odds, created_at
      FROM market_history
      WHERE market_id = $1
      ORDER BY created_at ASC
      `,
      [marketId]
    );

    const history = historyRes.rows.map(row => {

      let odds = {};

      try {
        odds =
          typeof row.odds === "string"
            ? JSON.parse(row.odds)
            : row.odds;
      } catch {
        odds = {};
      }

      const formatted = {
        time: new Date(row.created_at)
          .toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
      };

      // dynamically add every outcome
      for (const key of Object.keys(odds)) {
        formatted[key] =
          Number(odds[key]) * 100;
      }

      return formatted;
    });

    res.json({
      success: true,
      history,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;