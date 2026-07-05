const express = require("express");
const router = express.Router();
const pool = require("../db");

// ADMIN ONLY (you can secure later)
router.post("/resolve", async (req, res) => {
  const { marketId, outcome } = req.body;

  if (!["YES", "NO"].includes(outcome)) {
    return res.status(400).json({
      success: false,
      message: "Invalid outcome",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Close market
    await client.query(
      `UPDATE markets
       SET status='RESOLVED',
           resolution=$1,
           resolved_at=NOW()
       WHERE id=$2`,
      [outcome, marketId]
    );

    // 2. Fetch all positions
    const positionsRes = await client.query(
      `SELECT * FROM positions WHERE market_id=$1`,
      [marketId]
    );

    const positions = positionsRes.rows;

    // 3. Payout logic
    for (const p of positions) {
      const win = p.side === outcome;

      if (win) {
        // winner gets 2x (simple model)
        await client.query(
          `UPDATE wallets
           SET balance = balance + $1
           WHERE user_id = $2`,
          [p.amount * 2, p.user_id]
        );
      }
    }

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Market resolved",
    });

  } catch (err) {
    await client.query("ROLLBACK");

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    client.release();
  }
});

module.exports = router;