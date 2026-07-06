const express = require("express");
const router = express.Router();
const axios = require("axios");
const crypto = require("crypto");
const authMiddleware = require("../middleware/authMiddleware");
const pool = require("../db"); // ✅ FIX 1

// INIT PAYMENT
router.post("/initialize", authMiddleware, async (req, res) => {
  try {

    const { amount, email } = req.body;

    if (!amount || !email) {
      return res.status(400).json({
        success: false,
        message: "Missing amount or email",
      });
    }

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amount * 100,
        callback_url: "https://prediction-frontend-phi.vercel.app/payment-success",
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.json({
      success: true,
      data: response.data.data,
    });

  } catch (err) {

    console.error(
      err.response?.data || err.message
    );

    return res.status(500).json({
      success: false,
      message:
        err.response?.data?.message ||
        err.message,
    });
  }
});
router.post("/webhook", async (req, res) => {
  try {

    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.sendStatus(401);
    }

    const event = req.body;

    if (event.event === "charge.success") {

      const email = event.data.customer.email;
      const amount = event.data.amount / 100;
      const reference = event.data.reference;

      // prevent duplicate deposits
      const existing = await pool.query(
        "SELECT * FROM transactions WHERE reference = $1",
        [reference]
      );

      if (existing.rows.length > 0) {
        return res.sendStatus(200);
      }

      const user = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [email]
      );

      if (user.rows.length === 0) {
        return res.sendStatus(200);
      }

      await pool.query(
        "UPDATE wallets SET balance = balance + $1 WHERE user_id = $2",
        [amount, user.rows[0].id]
      );

      await pool.query(
        `INSERT INTO transactions
        (user_id, type, amount, reference)
        VALUES ($1, $2, $3, $4)`,
        [user.rows[0].id, "deposit", amount, reference]
      );
    }

    return res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(500);
  }
});

module.exports = router;
