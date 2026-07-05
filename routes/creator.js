const express = require("express");
const router = express.Router();

const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

router.get(
  "/dashboard",
  authMiddleware,
  async (req, res) => {
    try {

      const userId =
        req.user.userId || req.user.id;

      // TOTAL CREATED

      const totalMarketsRes =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM markets
          WHERE creator_id = $1
          `,
          [userId]
        );

      // LIVE

      const liveMarketsRes =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM markets
          WHERE creator_id = $1
          AND resolved = false
          `,
          [userId]
        );

      // TOTAL VOLUME

      const volumeRes =
        await pool.query(
          `
          SELECT
            COALESCE(
              SUM(mo.pool),
              0
            )::numeric AS volume
          FROM markets m
          JOIN market_outcomes mo
            ON mo.market_id = m.id
          WHERE m.creator_id = $1
          `,
          [userId]
        );

      // TOTAL CREATOR INCOME

      const incomeRes =
        await pool.query(
            `
            SELECT
              COALESCE(
                SUM(creator_income),
                0
              )::numeric AS income
            FROM markets
            WHERE creator_id = $1
            `,
            [userId]
        );

      // PENDING

      const pendingRes =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM market_submissions
          WHERE user_id = $1
          AND status = 'pending'
          `,
          [userId]
        );

      // APPROVED

      const approvedRes =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM market_submissions
          WHERE user_id = $1
          AND status = 'approved'
          `,
          [userId]
        );

      // REJECTED

      const rejectedRes =
        await pool.query(
          `
          SELECT COUNT(*)::int AS count
          FROM market_submissions
          WHERE user_id = $1
          AND status = 'rejected'
          `,
          [userId]
        );

      // MARKET LIST

      const marketsRes =
        await pool.query(
          `
          SELECT
            id,
            title,
            resolved,
            outcome,
            featured,
            created_at,
            creator_income,
            creator_paid
          FROM markets
          WHERE creator_id = $1
          ORDER BY id DESC
          `,
          [userId]
        );

      res.json({
        success: true,

        stats: {

          totalMarkets:
            totalMarketsRes.rows[0].count,

          liveMarkets:
            liveMarketsRes.rows[0].count,

          pendingMarkets:
            pendingRes.rows[0].count,

          approvedMarkets:
            approvedRes.rows[0].count,

          rejectedMarkets:
            rejectedRes.rows[0].count,

          totalVolume:
            Number(
              volumeRes.rows[0].volume
            ),

          totalIncome:
            Number(
                incomeRes.rows[0].income
            )
        },

        markets:
          marketsRes.rows
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        success: false
      });
    }
  }
);

module.exports = router;