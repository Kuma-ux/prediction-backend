const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

// GET WALLET
router.get("/", authMiddleware, async (req, res) => {
  try {
    const wallet = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [req.user.userId]
    );

    return res.json({
      success: true,
      wallet: wallet.rows[0] || { balance: 0 },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// DEPOSIT
router.post("/deposit", authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      });
    }

    // 1. Update wallet
    const updatedWallet = await pool.query(
      `
      UPDATE wallets 
      SET balance = balance + $1 
      WHERE user_id = $2 
      RETURNING *
      `,
      [amount, req.user.userId]
    );

    // 2. Log transaction (IMPORTANT)
    await pool.query(
      `
      INSERT INTO transactions (user_id, type, amount)
      VALUES ($1, 'deposit', $2)
      `,
      [req.user.userId, amount]
    );

    return res.json({
      success: true,
      wallet: updatedWallet.rows[0],
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

router.post(
  "/request-withdrawal",
  authMiddleware,
  async (req, res) => {
    try {

      const { amount, bank_name, account_number, account_name, } = req.body;

      if (
        !amount ||
        Number(amount) <= 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid amount",
        });
      }

      const walletRes = await pool.query(
        `
        SELECT balance
        FROM wallets
        WHERE user_id = $1
        `,
        [req.user.userId]
      );

      if (!walletRes.rows.length) {
        return res.status(404).json({
          success: false,
          error: "Wallet not found",
        });
      }

      const balance =
        Number(walletRes.rows[0].balance);

      if (balance < Number(amount)) {
        return res.status(400).json({
          success: false,
          error: "Insufficient balance",
        });
      }

      if (
        !bank_name ||
        !account_number ||
        !account_name
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Missing withdrawal details",
        });
      }

      await pool.query(
        `
        INSERT INTO withdrawals
        (
          user_id,
          amount,
          bank_name,
          account_number,
          account_name
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5
        )
        `,
        [
          req.user.userId,
          amount,
          bank_name,
          account_number,
          account_name,
        ]
      );

      return res.json({
        success: true,
      });

    } catch (err) {
      console.error(err);

      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  }
);

module.exports = router;