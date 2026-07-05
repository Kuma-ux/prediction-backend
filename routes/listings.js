const express = require("express");
const router = express.Router();

const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

router.post(
  "/create",
  authMiddleware,
  async (req, res) => {

    const userId = req.user.userId;

    const {
      marketId,
      outcome,
      shares,
      price,
    } = req.body;

    const client = await pool.connect();

    try {

      await client.query("BEGIN");

      if (
        Number(shares) <= 0 ||
        Number(price) <= 0
      ) {
        throw new Error("Invalid values");
      }

      // VERIFY USER OWNS SHARES
      const posRes = await client.query(
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

      if (posRes.rows.length === 0) {
        throw new Error("Position not found");
      }

      const ownedShares =
        Number(posRes.rows[0].shares);

      if (ownedShares < Number(shares)) {
        throw new Error("Not enough shares");
      }

      // PREVENT DUPLICATE ACTIVE LISTINGS
      const existingListing = await client.query(
        `
        SELECT id
        FROM share_listings
        WHERE seller_id = $1
          AND market_id = $2
          AND outcome = $3
          AND status = 'active'
        `,
        [
          userId,
          marketId,
          outcome,
        ]
      );

      if (existingListing.rows.length > 0) {
        throw new Error(
          "You already have an active listing for this outcome"
        );
      }

      // RESERVE SHARES
      await client.query(
        `
        UPDATE positions
        SET shares = shares - $1
        WHERE user_id = $2
          AND market_id = $3
          AND outcome = $4
        `,
        [
          shares,
          userId,
          marketId,
          outcome,
        ]
      );

      const outcomeRes = await client.query(
        `
        SELECT outcome, pool
        FROM market_outcomes
        WHERE market_id = $1
        `,
        [marketId]
      );

      const totalPool =
        outcomeRes.rows.reduce(
          (sum, row) => sum + Number(row.pool),
          0
        );

      const targetPool =
        outcomeRes.rows.find(
          r => r.outcome === outcome
        );

      if (!targetPool) {
        throw new Error("Outcome not found");
      }

      const currentProbability =
        Number(targetPool.pool) / totalPool;

      const listingProbability =
        Number(price) / Number(shares);

      if (
        listingProbability <
        currentProbability * 0.5
      ) {
        throw new Error("Listing price too far below market");
      }

      // ------------------------------------
      // APPLY SELL PRESSURE TO MARKET
      // ------------------------------------

      const SELL_PRESSURE_FACTOR = 0.25;
      const MAX_PRESSURE_PERCENT = 0.15;

      const pricePerShare =
        Number(price) / Number(shares);

      // reduce outcome pool slightly
      const pressureAmount =
        Number(shares) * pricePerShare * SELL_PRESSURE_FACTOR;

      // current outcome pool
      const outcomePoolRes = await client.query(
        `
        SELECT pool
        FROM market_outcomes
        WHERE market_id = $1
          AND outcome = $2
        FOR UPDATE
        `,
        [marketId, outcome]
      );

      if (outcomePoolRes.rows.length > 0) {

        const currentPool =
          Number(outcomePoolRes.rows[0].pool);

        const maxAllowedPressure =
           currentPool * MAX_PRESSURE_PERCENT;

        const pressureAmount = Math.min(
          rawPressure,
          maxAllowedPressure
        );

        // prevent negative pools
        const newPool = Math.max(
          1,
          currentPool - pressureAmount
        );

        await client.query(
          `
          UPDATE market_outcomes
          SET pool = $1
          WHERE market_id = $2
            AND outcome = $3
          `,
          [
            newPool,
            marketId,
            outcome,
          ]
        );
      }

      // CREATE LISTING
      await client.query(
        `
        INSERT INTO share_listings
        (
          seller_id,
          market_id,
          outcome,
          shares,
          price,
          status
        )
        VALUES ($1, $2, $3, $4, $5, 'active')
        `,
        [
          userId,
          marketId,
          outcome,
          shares,
          price,
        ]
      );

      await client.query("COMMIT");

      res.json({
        success: true,
      });

    } catch (err) {

      await client.query("ROLLBACK");

      console.error(err);

      res.status(500).json({
        success: false,
        error: err.message,
      });

    } finally {
      client.release();
    }
  }
);
// GET ALL ACTIVE LISTINGS
router.get("/", async (req, res) => {
  try {

    const listings = await pool.query(
      `
      SELECT
        l.id,
        l.market_id,
        l.outcome,
        l.shares,
        l.price,
        l.created_at,

        m.title,
        m.category,

        u.username as seller_username

      FROM share_listings l

      JOIN markets m
        ON m.id = l.market_id

      JOIN users u
        ON u.id = l.seller_id

      WHERE l.status = 'active'

      ORDER BY l.created_at DESC
      `
    );

    res.json({
      success: true,
      listings: listings.rows,
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message,
    });

  }
});
// BUY A LISTING
router.post(
  "/buy",
  authMiddleware,
  async (req, res) => {

    const { listingId, sharesToBuy, } = req.body;

    const buyerId = req.user.userId;

    const client = await pool.connect();

    try {

      await client.query("BEGIN");

      // listing
      const listingRes = await client.query(
        `
        SELECT *
        FROM share_listings
        WHERE id = $1
        FOR UPDATE
        `,
        [listingId]
      );

      if (listingRes.rows.length === 0) {
        throw new Error("Listing not found");
      }

      const listing = listingRes.rows[0];

      if (
        !sharesToBuy ||
        Number(sharesToBuy) <= 0
      ) {
        throw new Error("Invalid share amount");
      }

      if (!Number.isInteger(Number(sharesToBuy))) {
        throw new Error("Shares must be whole numbers");
      }

      if (
        Number(sharesToBuy) >
        Number(listing.shares)
      ) {
        throw new Error("Not enough shares available");
      }

      if (listing.status !== "active") {
        throw new Error("Listing unavailable");
      }

      if (listing.seller_id === buyerId) {
        throw new Error("Cannot buy your own listing");
      }

      // buyer wallet
      const buyerWallet = await client.query(
        `
        SELECT *
        FROM wallets
        WHERE user_id = $1
        FOR UPDATE
        `,
        [buyerId]
      );

      if (buyerWallet.rows.length === 0) {
        throw new Error("Buyer wallet missing");
      }

      // seller wallet
      const sellerWallet = await client.query(
        `
        SELECT *
        FROM wallets
        WHERE user_id = $1
        FOR UPDATE
        `,
        [listing.seller_id]
      );

      if (sellerWallet.rows.length === 0) {
        throw new Error("Seller wallet missing");
      }

      const pricePerShare =
        Number(
          (
            Number(listing.price) /
            Number(listing.shares)
          ).toFixed(4)
        );

      const totalCost =
        pricePerShare *
        Number(sharesToBuy);

      const fee = Number(
        (totalCost * 0.10).toFixed(2)
      );

      const sellerAmount = Number(
        (totalCost - fee).toFixed(2)
      );

      if (
        Number(buyerWallet.rows[0].balance)
        < totalCost
      ) {
        throw new Error("Insufficient balance");
      }

      // add fee to platform wallet
      await client.query(
        `
        UPDATE platform_wallet
        SET balance = balance + $1
        WHERE id = 1
        `,
        [fee]
      );

      // deduct buyer
      await client.query(
        `
        UPDATE wallets
        SET balance = balance - $1
        WHERE user_id = $2
        `,
        [totalCost, buyerId]
      );

      // pay seller 90%
      await client.query(
        `
        UPDATE wallets
        SET balance = balance + $1
        WHERE user_id = $2
        `,
        [sellerAmount, listing.seller_id]
      );

      // give shares to buyer
      const buyerPosition = await client.query(
        `
        SELECT *
        FROM positions
        WHERE user_id = $1
          AND market_id = $2
          AND outcome = $3
        FOR UPDATE
        `,
        [
          buyerId,
          listing.market_id,
          listing.outcome,
        ]
      );

      if (buyerPosition.rows.length === 0) {

        await client.query(
          `
          INSERT INTO positions
          (user_id, market_id, outcome, shares)
          VALUES ($1, $2, $3, $4)
          `,
          [
            buyerId,
            listing.market_id,
            listing.outcome,
            sharesToBuy,
          ]
        );

      } else {

        await client.query(
          `
          UPDATE positions
          SET shares = shares + $1
          WHERE user_id = $2
            AND market_id = $3
            AND outcome = $4
          `,
          [
            sharesToBuy,
            buyerId,
            listing.market_id,
            listing.outcome,
          ]
        );
      }

      const remainingShares =
        Number(listing.shares) -
        Number(sharesToBuy);

      if (remainingShares <= 0) {

        await client.query(
          `
          UPDATE share_listings
          SET status = 'sold'
          WHERE id = $1
          `,
          [listingId]
        );
      } else {

        const remainingPrice =
          pricePerShare *
          remainingShares;

        await client.query(
          `
          UPDATE share_listings
          SET shares = $1,
              price = $2
          WHERE id = $3
          `,
          [
            remainingShares,
            remainingPrice,
            listingId,
          ]
        );
      }

      // ------------------------------------
      // REDUCE SELL PRESSURE WHEN BOUGHT
      // ------------------------------------

      const RESTORE_FACTOR = 0.25;

      await client.query(
        `
        UPDATE market_outcomes
        SET pool = pool + $1
        WHERE market_id = $2
          AND outcome = $3
        `,
        [
          Number(sharesToBuy) * RESTORE_FACTOR,
          listing.market_id,
          listing.outcome,
        ]
      );

      await client.query("COMMIT");

      res.json({
        success: true,
      });

    } catch (err) {

      await client.query("ROLLBACK");

      console.error(err);

      res.status(500).json({
        success: false,
        error: err.message,
      });

    } finally {
      client.release();
    }
  }
);
router.post(
  "/cancel",
  authMiddleware,
  async (req, res) => {

    const { listingId } = req.body;

    const userId = req.user.userId;

    const client = await pool.connect();

    try {

      await client.query("BEGIN");

      const listingRes = await client.query(
        `
        SELECT *
        FROM share_listings
        WHERE id = $1
        FOR UPDATE
        `,
        [listingId]
      );

      if (listingRes.rows.length === 0) {
        throw new Error("Listing not found");
      }

      const listing = listingRes.rows[0];

      if (listing.seller_id !== userId) {
        throw new Error("Unauthorized");
      }

      if (listing.status !== "active") {
        throw new Error("Listing already closed");
      }

      const createdAt =
        new Date(listing.created_at).getTime();

      const now = Date.now();

      const MIN_LIFETIME_MS =
        5 * 60 * 1000;

      if (now - createdAt < MIN_LIFETIME_MS) {
        throw new Error(
          "Listing cannot be cancelled yet"
        );
      }

      // restore market confidence
      const RESTORE_FACTOR = 0.10;

      await client.query(
        `
        UPDATE market_outcomes
        SET pool = pool + $1
        WHERE market_id = $2
          AND outcome = $3
        `,
        [
          Number(listing.shares) * RESTORE_FACTOR,
          listing.market_id,
          listing.outcome,
        ]
      );

      const cancelFee =
        Number(listing.price) * 0.02;

      const walletRes = await client.query(
        `
        SELECT balance
        FROM wallets
        WHERE user_id = $1
        FOR UPDATE
        `,
        [userId]
      );

      if (walletRes.rows.length === 0) {
        throw new Error("Wallet not found");
      }

      const currentBalance =
        Number(walletRes.rows[0].balance);

      if (currentBalance < cancelFee) {
        throw new Error("Insufficient balance for cancellation fee");
      }

      await client.query(
        `
        UPDATE wallets
        SET balance = balance - $1
        WHERE user_id = $2
        `,
        [cancelFee, userId]
      );

      await client.query(
        `
        UPDATE platform_wallet
        SET balance = balance + $1
        WHERE id = 1
        `,
        [cancelFee]
      );

      // return shares
      await client.query(
        `
        UPDATE positions
        SET shares = shares + $1
        WHERE user_id = $2
          AND market_id = $3
          AND outcome = $4
        `,
        [
          listing.shares,
          userId,
          listing.market_id,
          listing.outcome,
        ]
      );

      // cancel listing
      await client.query(
        `
        UPDATE share_listings
        SET status = 'cancelled'
        WHERE id = $1
        `,
        [listingId]
      );

      await client.query("COMMIT");

      res.json({
        success: true,
      });

    } catch (err) {

      await client.query("ROLLBACK");

      res.status(500).json({
        success: false,
        error: err.message,
      });

    } finally {
      client.release();
    }
  }
);

module.exports = router;