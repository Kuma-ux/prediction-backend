const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const {
  buyOutcome, 
  getOdds 
} = require("../services/marketEngine");

function logSumExp(outcomes, b) {
  const max = Math.max(...outcomes.map(o => o.pool / b));

  return (
    b *
    (max +
      Math.log(
        outcomes.reduce(
          (sum, o) => sum + Math.exp(o.pool / b - max),
          0
        )
      ))
  );
}
function getProbabilities(outcomes, b) {
  const pools = outcomes.map(o => o.pool / b);
  const max = Math.max(...pools);
  
  // Shift the exponents by the max value to prevent infinity issues
  const exp = pools.map(p => Math.exp(p - max));
  const sum = exp.reduce((a, b) => a + b, 0);

  return outcomes.map((o, i) => ({
    outcome: o.outcome,
    prob: exp[i] / sum,
  }));
}
router.post("/buy", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userId = req.user.userId;
    const { marketId, outcome, amount } = req.body;

    if (!marketId || !outcome || !amount) {
      throw new Error("Missing fields");
    }

    // 1. SAFE WALLET FETCH
    const walletRes = await client.query(
      "SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE",
      [userId]
    );

    if (!walletRes.rows.length) {
      throw new Error("Wallet not found for user");
    }

    const balance = Number(walletRes.rows[0].balance);

    // 2. MARKET CHECK
    const marketRes = await client.query(
      "SELECT * FROM markets WHERE id = $1",
      [marketId]
    );

    const market = marketRes.rows[0];

    if (!market) throw new Error("Market not found");
    if (market.resolved) throw new Error("Market already resolved");

    // 3. OUTCOMES
    const outcomesRes = await client.query(
      "SELECT outcome, pool FROM market_outcomes WHERE market_id = $1 FOR UPDATE",
      [marketId]
    );

    if (!outcomesRes.rows.length) {
      throw new Error("No outcomes found");
    }

    const engineInput = outcomesRes.rows.map(r => ({
      outcome: r.outcome,
      pool: Number(r.pool),
    }));

    // 4. VALIDATE OUTCOME EXISTS
    const exists = engineInput.find(o => o.outcome === outcome);

    if (!exists) {
      throw new Error("Invalid outcome");
    }

    // 5. ENGINE
    const result = buyOutcome(
      {
        outcomes: engineInput,
        b: Number(market.b || 50),
      },
      outcome,
      Number(amount)
    );

    const updatedOutcomes = result.market.outcomes;
    const cost = result.cost;
    const odds = result.odds;

    // 6. BALANCE CHECK
    if (balance < cost) {
      throw new Error("Insufficient balance");
    }

    // 7. UPDATE POOLS
    for (const o of updatedOutcomes) {
      await client.query(
        `UPDATE market_outcomes
         SET pool = $1
         WHERE market_id = $2 AND outcome = $3`,
        [o.pool, marketId, o.outcome]
      );
    }

    // 8. UPDATE WALLET
    await client.query(
      "UPDATE wallets SET balance = balance - $1 WHERE user_id = $2",
      [cost, userId]
    );

    const sharesBought = Number(amount);
    const pricePerShare =
      sharesBought > 0
        ? cost / sharesBought
        : 0;

    // 9. LOG TRADE
    await client.query(
      `INSERT INTO trades (user_id, market_id, outcome, shares, cost_paid, price, trade_type)
       VALUES ($1, $2, $3, $4, $5, $6, 'buy')`,
      [userId, marketId, outcome, Number(amount), cost, pricePerShare]
    );

    // UPDATE USER POSITION
    const existingPosition = await client.query(
      `
      SELECT *
      FROM positions
      WHERE user_id = $1
        AND market_id = $2
        AND outcome = $3
      FOR UPDATE
      `,
      [userId, marketId, outcome]
    );
    if (existingPosition.rows.length > 0) {

      const currentShares =
        Number(existingPosition.rows[0].shares);

      const currentAvgCost =
        Number(existingPosition.rows[0].avg_cost);

      const newShares = currentShares + Number(amount);

      const newAvgCost =
        (
          (currentShares * currentAvgCost) +
          cost
        ) / newShares;

        await client.query(
          `
          UPDATE positions
          SET shares = $1,
              avg_cost = $2
          WHERE user_id = $3
            AND market_id = $4
            AND outcome = $5
          `,
          [
            newShares,
            newAvgCost,
            userId,
            marketId,
            outcome,
          ]
        );
    } else {
      await client.query(
        `
        INSERT INTO positions
        (
          user_id,
          market_id,
          outcome,
          shares,
          avg_cost
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          userId,
          marketId,
          outcome,
          Number(amount),
          pricePerShare,
        ]
      );
    }

    // 10. HISTORY
    await client.query(
      `INSERT INTO market_history (market_id, odds, metadata)
       VALUES ($1, $2, $3)`,
      [marketId, JSON.stringify(odds), JSON.stringify(updatedOutcomes)]
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      cost,
      outcomes: updatedOutcomes,
    });

  } catch (err) {
    console.error("TRADE ERROR:", err.message);

    try {
      await client.query("ROLLBACK");
    } catch (e) {
      console.error("ROLLBACK FAILED:", e.message);
    }

    return res.status(500).json({
      success: false,
      error: err.message,
    });

  } finally {
    client.release();
  }
});

module.exports = router;