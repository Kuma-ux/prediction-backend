const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        title,
        category,
        description,
        start_date,
        end_date,
        image,
        featured
      FROM events
      ORDER BY
        featured DESC,
        start_date ASC,
        id DESC
    `);

    res.json({
      success: true,
      events: result.rows
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: "Failed to load events"
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const eventResult = await pool.query(
      `
      SELECT *
      FROM events
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (!eventResult.rows.length) {
      return res.json({
        success: false,
      });
    }

    const event = eventResult.rows[0];

    const marketsResult = await pool.query(
      `
      SELECT *
      FROM markets
      WHERE event_id = $1
      ORDER BY id ASC
      `,
      [req.params.id]
    );

    const markets = [];

    for (const market of marketsResult.rows) {
      const outcomesRes = await pool.query(
        `
        SELECT outcome, pool
        FROM market_outcomes
        WHERE market_id = $1
        `,
        [market.id]
      );

      const outcomes = outcomesRes.rows.map(o => ({
        outcome: o.outcome,
        pool: Number(o.pool),
      }));

      const totalVolume = outcomes.reduce(
        (sum, o) => sum + o.pool,
        0
      );

      const odds = {};

      for (const outcome of outcomes) {
        odds[outcome.outcome] =
          totalVolume > 0
            ? Number((outcome.pool / totalVolume).toFixed(4))
            : 0;
      }

      markets.push({
        ...market,
        options: outcomes.map(o => o.outcome),

        pools: Object.fromEntries(
          outcomes.map(o => [
                          o.outcome,
                          o.pool,
          ])
        ),
        
        odds,

        totalvolume: totalVolume,
      });
    }

    event.markets = markets;

    event.totalvolume = markets.reduce(
      (sum, market) => sum + market.totalvolume,
      0
    );

    res.json({
      success: true,
      event,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: "Failed to load event",
    });
  }
});

router.get("/:id/markets", async (req, res) => {
    const result = await pool.query(
        `
        SELECT *
        FROM markets
        WHERE event_id = $1
        ORDER BY id ASC
        `,
        [req.params.id]
    );

    res.json({
        success: true,
        markets: result.rows
    });
});

module.exports = router;
