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
  console.log("====================================");
  console.log("PAYSTACK WEBHOOK HIT");
  console.log("====================================");

  try {
    // ==========================================
    // VERIFY PAYSTACK SIGNATURE
    // ==========================================

    const signature = req.headers["x-paystack-signature"];

    if (!signature) {
      console.error("Missing Paystack signature");
      return res.sendStatus(401);
    }

    const hash = crypto
      .createHmac(
        "sha512",
        process.env.PAYSTACK_SECRET_KEY
      )
      .update(req.rawBody)
      .digest("hex");

    if (hash !== signature) {
      console.error("Invalid Paystack signature");
      return res.sendStatus(401);
    }

    console.log("✅ Paystack signature verified");

    const event = req.body;

    console.log("Paystack event:", event.event);

    // ==========================================
    // ONLY PROCESS SUCCESSFUL PAYMENTS
    // ==========================================

    if (event.event !== "charge.success") {
      console.log(
        "Ignoring event:",
        event.event
      );

      return res.sendStatus(200);
    }

    // ==========================================
    // GET PAYMENT DETAILS
    // ==========================================

    const email = event.data?.customer?.email;
    const reference = event.data?.reference;
    const amount = Number(event.data?.amount) / 100;

    console.log("Payment details:", {
      email,
      reference,
      amount,
    });

    if (
      !email ||
      !reference ||
      !amount ||
      amount <= 0
    ) {
      console.error(
        "Invalid payment information"
      );

      return res.sendStatus(200);
    }

    // ==========================================
    // FIND USER
    // ==========================================

    const userResult = await pool.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(email) = LOWER($1)
      `,
      [email]
    );

    if (userResult.rows.length === 0) {
      console.error(
        "No user found for email:",
        email
      );

      return res.sendStatus(200);
    }

    const userId = userResult.rows[0].id;

    console.log("User ID:", userId);

    // ==========================================
    // CHECK FOR DUPLICATE PAYMENT
    // ==========================================

    const existingTransaction = await pool.query(
      `
      SELECT id
      FROM transactions
      WHERE reference = $1
      LIMIT 1
      `,
      [reference]
    );

    if (existingTransaction.rows.length > 0) {
      console.log(
        "⚠️ Payment already processed:",
        reference
      );

      return res.sendStatus(200);
    }

    // ==========================================
    // DATABASE TRANSACTION
    // ==========================================

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // ----------------------------------------
      // LOCK USER WALLET
      // ----------------------------------------

      const walletResult = await client.query(
        `
        SELECT *
        FROM wallets
        WHERE user_id = $1
        FOR UPDATE
        `,
        [userId]
      );

      if (walletResult.rows.length === 0) {
        console.error(
          "❌ Wallet not found for user:",
          userId
        );

        await client.query("ROLLBACK");

        return res.sendStatus(200);
      }

      // ----------------------------------------
      // ADD MONEY TO WALLET
      // ----------------------------------------

      const updatedWallet = await client.query(
        `
        UPDATE wallets
        SET balance = balance + $1
        WHERE user_id = $2
        RETURNING *
        `,
        [amount, userId]
      );

      console.log(
        "✅ Wallet updated:",
        updatedWallet.rows[0]
      );

      // ----------------------------------------
      // RECORD TRANSACTION
      // ----------------------------------------

      await client.query(
        `
        INSERT INTO transactions
        (
          user_id,
          type,
          amount,
          status,
          reference
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          userId,
          "deposit",
          amount,
          "completed",
          reference,
        ]
      );

      // ----------------------------------------
      // COMMIT
      // ----------------------------------------

      await client.query("COMMIT");

      console.log(
        `✅ Successfully deposited KES ${amount} for user ${userId}`
      );

    } catch (dbError) {

      await client.query("ROLLBACK");

      throw dbError;

    } finally {

      client.release();

    }

    return res.sendStatus(200);

  } catch (err) {

    console.error(
      "❌ PAYSTACK WEBHOOK ERROR:",
      err
    );

    return res.sendStatus(500);
  }
});
module.exports = router;
