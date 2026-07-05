const pool = require("../db");

//
// GET WALLET
//
exports.getWallet = async (req, res) => {
  try {
    const wallet = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [req.user.userId]
    );

    if (wallet.rows.length === 0) {
      return res.json({
        success: false,
        message: "Wallet not found",
      });
    }

    res.json({
      success: true,
      wallet: wallet.rows[0],
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

//
// DEPOSIT
//
exports.deposit = async (req, res) => {
  try {
    const { amount } = req.body;

    //
    // VALIDATION
    //
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      });
    }

    //
    // UPDATE WALLET
    //
    const updatedWallet = await pool.query(
      `
      UPDATE wallets
      SET balance = balance + $1
      WHERE user_id = $2
      RETURNING *
      `,
      [amount, req.user.userId]
    );

    //
    // SAVE TRANSACTION
    //
    await pool.query(
      `
      INSERT INTO transactions
      (user_id, type, amount)
      VALUES ($1, $2, $3)
      `,
      [req.user.userId, "deposit", amount]
    );

    res.json({
      success: true,
      wallet: updatedWallet.rows[0],
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};