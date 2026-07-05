const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/:username", async (req, res) => {
  try {
    const { username } = req.params;

    // -------------------------
    // USER
    // -------------------------

    const userRes = await pool.query(
      `
      SELECT
        id,
        username,
        created_at,
        bio,
        avatar_url
      FROM users
      WHERE username = $1
      `,
      [username]
    );

    if (!userRes.rows.length) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const user = userRes.rows[0];
    const userId = user.id;

    // -------------------------
    // PREDICTIONS COUNT
    // -------------------------

    const predictionRes = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM trades
      WHERE user_id = $1
      `,
      [userId]
    );

    const predictions =
      Number(predictionRes.rows[0]?.total || 0);

    // -------------------------
    // TOTAL SPENT
    // -------------------------

    const spentRes = await pool.query(
      `
      SELECT
        COALESCE(SUM(cost_paid),0) AS total
      FROM trades
      WHERE user_id = $1
      `,
      [userId]
    );

    const totalSpent =
      Number(spentRes.rows[0]?.total || 0);

    // -------------------------
    // TOTAL PROFIT / LOSS
    // -------------------------

    const pnlRes = await pool.query(
      `
      SELECT
        COALESCE(
          SUM(
            payout -
            (shares * avg_cost)
          ),
          0
        ) AS pnl
      FROM positions
      WHERE user_id = $1
        AND settled = true
      `,
      [userId]
    );

    const totalProfitLoss =
      Number(pnlRes.rows[0].pnl || 0);

    // -------------------------
    // BIGGEST WIN
    // -------------------------

    const biggestWinRes = await pool.query(
      `
      SELECT
        COALESCE(
          MAX(
            payout -
            (shares * avg_cost)
          ),
          0
        ) AS biggest_win
      FROM positions
      WHERE user_id = $1
        AND settled = true
      `,
      [userId]
    );

    const biggestWin =
      Number(
        biggestWinRes.rows[0].biggest_win || 0
      );

    // -------------------------
    // ACTIVE POSITIONS
    // -------------------------

    const activePositionsRes = await pool.query(
      `
      SELECT
        p.*,
        m.title,
        m.category,
        m.end_date,
        m.resolved
      FROM positions p
      JOIN markets m
        ON m.id = p.market_id
      WHERE
        p.user_id = $1
        AND p.archived = false
        AND p.settled = false
      ORDER BY p.id DESC
      `,
      [userId]
    );

    // -------------------------
    // CLOSED POSITIONS
    // -------------------------

    const closedPositionsRes = await pool.query(
      `
      SELECT
        p.*,
        m.title,
        m.category,
        m.outcome AS winning_outcome,
        m.resolution,
        m.resolved_at,
        m.resolved
      FROM positions p
      JOIN markets m
        ON m.id = p.market_id
      WHERE
        p.user_id = $1
        AND (
          p.settled = true
          OR p.archived = true
        )
      ORDER BY
        m.resolved_at DESC NULLS LAST,
        p.id DESC
      `,
      [userId]
    );

    const activePositions =
      activePositionsRes.rows.length;

    // -------------------------
    // EQUITY CURVE
    // -------------------------

    const equityRes = await pool.query(
      `
      SELECT
        m.resolved_at,
        p.payout,
        p.shares,
        p.avg_cost
      FROM positions p
      JOIN markets m
        ON m.id = p.market_id
      WHERE
        p.user_id = $1
        AND p.settled = true
      ORDER BY m.resolved_at ASC
      `,
      [userId]
    );

    let running = 0;

    const equityCurve =
      equityRes.rows.map((row) => {

        const profit =
          Number(row.payout) -
          (
            Number(row.shares) *
            Number(row.avg_cost)
          );

        running += profit;

        return {
          date: row.resolved_at,
          value: Number(running.toFixed(2)),
        };
      });

    // -------------------------
    // RESPONSE
    // -------------------------

    return res.json({
      success: true,

      user: {
        username: user.username,
        joined: user.created_at,

        bio: user.bio,
        avatar_url: user.avatar_url,

        predictions,

        biggestWin,

        activePositions,

        closedPositions:
          closedPositionsRes.rows.length,

        totalSpent,

        profitLoss:
          Number(totalProfitLoss.toFixed(2)),
      },

      equityCurve,

      activePositions:
        activePositionsRes.rows,

      closedPositions:
        closedPositionsRes.rows,
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      error: "Failed to load profile",
    });
  }
});

module.exports = router;