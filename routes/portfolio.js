const express = require("express");
const router = express.Router();

const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", authMiddleware, async (req, res) => {
  try {

    const userId = req.user.userId;

    // UNIQUE MARKETS
    const tradedRes = await pool.query(
      `
      SELECT COUNT(DISTINCT market_id) AS total
      FROM positions
      WHERE user_id = $1
      `,
      [userId]
    );

    // ACTIVE POSITIONS
    const activeRes = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM positions p
      JOIN markets m
        ON m.id = p.market_id
      WHERE p.user_id = $1
        AND m.resolved = false
      `,
      [userId]
    );

    // TOTAL SHARES
    const sharesRes = await pool.query(
      `
      SELECT COALESCE(SUM(shares), 0) AS total
      FROM positions
      WHERE user_id = $1
      `,
      [userId]
    );

    // LOAD ALL USER POSITIONS
    const positionsRes = await pool.query(
      `
      SELECT *
      FROM positions
      WHERE user_id = $1
      `,
      [userId]
    );

    let totalPossiblePayout = 0;

    // CALCULATE LIVE VALUE
    for (const position of positionsRes.rows) {

      // load all outcomes
      const outcomesRes = await pool.query(
        `
        SELECT outcome, pool
        FROM market_outcomes
        WHERE market_id = $1
        `,
        [position.market_id]
      );

      const outcomes = outcomesRes.rows;

      const totalPool = outcomes.reduce(
        (sum, o) => sum + Number(o.pool),
        0
      );

      const matching = outcomes.find(
        o => o.outcome === position.outcome
      );

      if (!matching || totalPool <= 0) {
        continue;
      }

      // CURRENT PROBABILITY
      const probability =
        Number(matching.pool) / totalPool;

      // LIVE POSITION VALUE
      const liveValue =
        Number(position.shares) * probability;

      totalPossiblePayout += liveValue;
    }

    res.json({
      success: true,

      stats: {
        marketsTraded: Number(
          tradedRes.rows[0].total
        ),

        activePositions: Number(
          activeRes.rows[0].total
        ),

        totalShares: Number(
          sharesRes.rows[0].total
        ),

        totalPossiblePayout:
          Number(totalPossiblePayout.toFixed(2)),
      },
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