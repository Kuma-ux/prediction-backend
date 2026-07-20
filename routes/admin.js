// routes/admin.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

const adminMiddleware = require("../middleware/adminMiddleware");
const authMiddleware = require("../middleware/authMiddleware");

const { htmlToText } = require("html-to-text");

const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// routes/admin.js
router.post(
  "/create-market",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const {
      title,
      description,
      rules,
      category,
      b,
      end_date,
      options,
      market_type,
      bundle_predictions,
      featured,
      is_live,
      live_duration_minutes,
      event_id
    } = req.body;

    // -----------------------------
    // HANDLE BUNDLE OPTIONS
    // -----------------------------
    const finalOptions =
      market_type === "bundle"
        ? ["YES", "NO"]
        : options;

    // -----------------------------
    // VALIDATION
    // -----------------------------
    if (
      !title ||
      !Array.isArray(finalOptions) ||
      finalOptions.length < 2
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid market data",
      });
    }

    if (
      market_type === "bundle" &&
      (
        !bundle_predictions ||
        !Array.isArray(bundle_predictions) ||
        bundle_predictions.length === 0
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Bundle predictions required",
      });
    }

    let finalEndDate = end_date;

    if (is_live) {
      finalEndDate = new Date(
        Date.now() +
        (live_duration_minutes || 5) * 60 * 1000
      );
    }

    try {

      // -----------------------------
      // CREATE MARKET
      // -----------------------------
      const marketResult = await pool.query(
        `
        INSERT INTO markets
        (
          title,
          description,
          rules,
          category,
          b,
          end_date,
          resolved,
          market_type,
          bundle_predictions,
          featured,
          is_live,
          live_duration_minutes,
          event_id 
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          false,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12
        )
        RETURNING *
        `,
        [
          title,
          description,
          rules,
          category,
          Number(b || 50),
          finalEndDate,
          market_type || "standard",
          JSON.stringify(bundle_predictions || []),
          featured || false,
          is_live || false,
          live_duration_minutes || 5
          event_id || null
        ]
      );

      const marketId = marketResult.rows[0].id;

      // -----------------------------
      // CREATE OUTCOMES
      // -----------------------------
      for (const option of finalOptions) {

        await pool.query(
          `
          INSERT INTO market_outcomes
          (
            market_id,
            outcome,
            pool
          )
          VALUES
          (
            $1,
            $2,
            0
          )
          `,
          [marketId, option]
        );
      }

      res.json({
        success: true,
        market: marketResult.rows[0],
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  }
);

// CREATE EVENT
router.post(
  "/create-event",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const {
        title,
        category,
        description,
        start_date,
        end_date,
        image,
        featured
      } = req.body;

      if (!title || !category || !start_date) {
        return res.status(400).json({
          success: false,
          error: "Title, category and start date are required."
        });
      }

      const result = await pool.query(
        `
        INSERT INTO events
        (
          title,
          category,
          description,
          start_date,
          end_date,
          image,
          featured
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7
        )
        RETURNING *
        `,
        [
          title,
          category,
          description || null,
          start_date,
          end_date || null,
          image || null,
          featured || false
        ]
      );

      return res.json({
        success: true,
        event: result.rows[0]
      });

    } catch (err) {
      console.error(err);

      return res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }
);

router.post(
  "/update-event",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    try {

      const {
        eventId,
        title,
        category,
        description,
        start_date,
        end_date,
        image,
        featured
      } = req.body;

      await pool.query(
        `
        UPDATE events
        SET
          title = $1,
          category = $2,
          description = $3,
          start_date = $4,
          end_date = $5,
          image = $6,
          featured = $7
        WHERE id = $8
        `,
        [
          title,
          category,
          description,
          start_date,
          end_date,
          image,
          featured,
          eventId
        ]
      );

      res.json({
        success: true
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        success: false,
        error: err.message
      });

    }

  }
);

router.post(
  "/delete-event",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const { eventId } = req.body;

    if (!eventId) {
      return res.status(400).json({
        success:false,
        error:"Missing event id"
      });
    }

    const client = await pool.connect();

    try {

      await client.query("BEGIN");

      await client.query(
        `
        UPDATE markets
        SET event_id = NULL
        WHERE event_id = $1
        `,
        [eventId]
      );

      await client.query(
        `
        DELETE FROM events
        WHERE id = $1
        `,
        [eventId]
      );

      await client.query("COMMIT");

      res.json({
        success:true
      });

    } catch(err){

      await client.query("ROLLBACK");

      console.error(err);

      res.status(500).json({
        success:false,
        error:err.message
      });

    } finally {

      client.release();

    }

  }
);

router.post(
  "/feature-event",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const {
      eventId,
      featured
    } = req.body;

    if (
      !eventId ||
      typeof featured !== "boolean"
    ) {
      return res.status(400).json({
        success:false,
        error:"Invalid payload"
      });
    }

    try {

      await pool.query(
        `
        UPDATE events
        SET featured = $1
        WHERE id = $2
        `,
        [
          featured,
          eventId
        ]
      );

      res.json({
        success:true
      });

    } catch(err){

      console.error(err);

      res.status(500).json({
        success:false,
        error:err.message
      });

    }

  }
);

router.post(
  "/add-market-to-event",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const {
      marketId,
      eventId
    } = req.body;

    try {

      await pool.query(
        `
        UPDATE markets
        SET event_id = $1
        WHERE id = $2
        `,
        [
          eventId || null,
          marketId
        ]
      );

      res.json({
        success:true
      });

    } catch(err){

      console.error(err);

      res.status(500).json({
        success:false,
        error:err.message
      });

    }

  }
);

// FEATURE / UNFEATURE MARKET
router.post(
  "/feature-market",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const {
      marketId,
      featured,
    } = req.body;

    if (
      typeof featured !== "boolean" ||
      !marketId
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid payload",
      });
    }

    try {

      await pool.query(
        `
        UPDATE markets
        SET featured = $1
        WHERE id = $2
        `,
        [featured, marketId]
      );

      res.json({
        success: true,
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  }
);
router.post("/update-market", authMiddleware, adminMiddleware, async (req, res) => {
  try {

    const {
      marketId,
      title,
      description,
      rules,
      category,
      end_date,
      featured,
      bundle_predictions,
    } = req.body;

    await pool.query(
      `
      UPDATE markets
      SET
        title = $1,
        description = $2,
        rules = $3,
        category = $4,
        end_date = $5,
        featured = $6,
        bundle_predictions = $7
      WHERE id = $8
      `,
      [
        title,
        description,
        rules,
        category,
        end_date,
        featured,
        JSON.stringify(bundle_predictions || []),
        marketId,
      ]
    );

    return res.json({
      success: true,
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      error: "Failed to update market",
    });
  }
});

// Resolve market
router.post(
  "/resolve",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const { marketId, outcomes } = req.body;

    const client = await pool.connect();

    try {

      await client.query("BEGIN");

      // check market
      const marketRes = await client.query(
        `
        SELECT *
        FROM markets
        WHERE id = $1
        `,
        [marketId]
      );

      if (marketRes.rows.length === 0) {
        throw new Error("Market not found");
      }

      const market = marketRes.rows[0];

      const lockRes = await client.query(
        `
        UPDATE markets
        SET resolving = true
        WHERE id = $1
          AND resolving = false
          AND resolved = false
        RETURNING *
        `,
        [marketId]
      );

      if (lockRes.rows.length === 0) {
        throw new Error("Already resolving");
      }

      // validate outcome dynamically
      const validOutcomes = await client.query(
        `
        SELECT outcome
        FROM market_outcomes
        WHERE market_id = $1
        `,
        [marketId]
      );

      const allowed =
        validOutcomes.rows.map(
          r => r.outcome
        );

      if (
        !Array.isArray(outcomes) ||
        outcomes.length === 0
      ) {
        throw new Error(
          "No winning outcomes selected"
        );
      }

      for (const outcome of outcomes) {
        if (!allowed.includes(outcome)) {
          throw new Error(
            `Invalid outcome: ${outcome}`
          );
        }
      }

      // ------------------------------------
      // FIND WINNING POSITIONS
      // ------------------------------------

      const winnersRes = await client.query(
        `
        SELECT *
        FROM positions
        WHERE market_id = $1
          AND outcome = ANY($2)
          AND archived = false
          AND settled = false
        `,
        [marketId, outcomes]
      );

      // ------------------------------------
      // PAY WINNERS
      // ------------------------------------

      for (const winner of winnersRes.rows) {

        const payout = Number(winner.shares) * 1;

        const profit =
          (1 - Number(winner.avg_cost)) *
          Number(winner.shares);

        // update wallet
        await client.query(
          `
          UPDATE wallets
          SET balance = balance + $1
          WHERE user_id = $2
          `,
          [payout, winner.user_id]
        );

        // mark position settled
        await client.query(
          `
          UPDATE positions
          SET settled = true,
              payout = $1
          WHERE id = $2
          `,
          [payout, winner.id]
        );

        console.log(
          `User ${winner.user_id} profit:`,
          profit
        );
      }

      // ------------------------------------
      // FIND LOSERS
      // ------------------------------------

      const losersRes = await client.query(
        `
        SELECT *
        FROM positions
        WHERE market_id = $1
          AND NOT (
            outcome = ANY($2)
          )
          AND archived = false
          AND settled = false
        `,
        [marketId, outcomes]
      );

      // ------------------------------------
      // SETTLE LOSING POSITIONS
      // ------------------------------------

      for (const loser of losersRes.rows) {

        await client.query(
          `
          UPDATE positions
          SET settled = true,
             payout = 0
          WHERE id = $1
          `,
          [loser.id]
        );
      }

      // ------------------------------------
      // CALCULATE CREATOR REVENUE
      // ------------------------------------

      const volumeRes = await client.query(
        `
        SELECT COALESCE(
          SUM(shares * avg_cost),
          0
        ) AS volume
         FROM positions
         WHERE market_id = $1
        `,
        [marketId]
      );

      const totalVolume =
        Number(volumeRes.rows[0].volume || 0);

      const creatorIncome =
        totalVolume * 0.35;

      const lockedMarket = lockRes.rows[0];

      if (lockedMarket.is_live) {

        await client.query(
          `
          UPDATE positions
          SET archived = true
          WHERE market_id = $1
            AND archived = false
          `,
          [marketId]
        );

        await client.query(
          `
          UPDATE market_outcomes
          SET pool = 0
          WHERE market_id = $1
          `,
          [marketId]
        );

        const newEnd = new Date(
          Date.now() +
          lockedMarket.live_duration_minutes * 60 * 1000
        );

        await client.query(
          `
          UPDATE markets
          SET
            resolved = false,
            outcome = NULL,
            resolving = false,
            resolution = NULL,
            resolved_at = NULL,
            end_date = $1
          WHERE id = $2
          `,
          [newEnd, marketId]
        );
      } else {
        await client.query(
          `
          UPDATE markets
          SET
            resolved = true,
            winning_outcomes = $1,
            resolved_at = NOW(),
            creator_income = $3
          WHERE id = $2
          `,
          [JSON.stringify(outcomes), marketId, creatorIncome]
        );
      }

      const creatorRes = await client.query(
        `
        SELECT creator_id
        FROM markets
        WHERE id = $1
        `,
        [marketId]
      );

      const creatorId =
        creatorRes.rows[0]?.creator_id;

      if(
        creatorId &&
        creatorIncome > 0
      ) {
        await client.query(
          `
          UPDATE wallets
          SET balance = balance + $1
          WHERE user_id = $2
          `,
          [
            creatorIncome,
            creatorId
          ]
        );

        await client.query(
          `
          UPDATE markets
          SET creator_paid = true
          WHERE id = $1
          `,
          [marketId]
        );
      }

      await client.query(
        `
        UPDATE markets
        SET resolving = false
        WHERE id = $1
        `,
        [marketId]
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        message: `Market resolved as ${outcomes.join(", ")}`,
      });

    } catch (err) {

      await client.query("ROLLBACK");

      try {
        await pool.query(
          `
          UPDATE markets
          SET resolving = false
          WHERE id = $1
          `,
          [marketId]
        );
      } catch {}

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
// DELETE MARKET COMPLETELY
router.post(
  "/delete-market",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const { marketId } = req.body;

    if (!marketId) {
      return res.status(400).json({
        success: false,
        error: "Market ID required",
      });
    }

    const client = await pool.connect();

    try {

      await client.query("BEGIN");

      // DELETE TRADES
      await client.query(
        `
        DELETE FROM trades
        WHERE market_id = $1
        `,
        [marketId]
      );

      // DELETE POSITIONS
      await client.query(
        `
        DELETE FROM positions
        WHERE market_id = $1
        `,
        [marketId]
      );

      // DELETE OUTCOMES
      await client.query(
        `
        DELETE FROM market_outcomes
        WHERE market_id = $1
        `,
        [marketId]
      );

      // DELETE HISTORY
      // ONLY if this table exists in your DB
      try {
        await client.query(
          `
          DELETE FROM market_history
          WHERE market_id = $1
          `,
          [marketId]
        );
      } catch {}

      // DELETE MARKET
      await client.query(
        `
        DELETE FROM markets
        WHERE id = $1
        `,
        [marketId]
      );

      await client.query("COMMIT");

      return res.json({
        success: true,
      });

    } catch (err) {

      await client.query("ROLLBACK");

      console.error(err);

      return res.status(500).json({
        success: false,
        error: err.message,
      });

    } finally {

      client.release();
    }
  }
);
router.post(
  "/shutdown-market",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    const { marketId } = req.body;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const marketRes = await client.query(
        `
        SELECT *
        FROM markets
        WHERE id = $1
        `,
        [marketId]
      );

      if (!marketRes.rows.length) {
        throw new Error("Market not found");
      }

      const market = marketRes.rows[0];

      if (market.shutdown) {
        throw new Error("Market already shut down");
      }

      // Get all unsettled positions
      const positionsRes = await client.query(
        `
        SELECT *
        FROM positions
        WHERE market_id = $1
          AND settled = false
          AND archived = false
        `,
        [marketId]
      );

      // Refund original stake
      for (const position of positionsRes.rows) {

        const refund =
          Number(position.shares) *
          Number(position.avg_cost);

        await client.query(
          `
          UPDATE wallets
          SET balance = balance + $1
          WHERE user_id = $2
          `,
          [
            refund,
            position.user_id
          ]
        );

        await client.query(
          `
          UPDATE positions
          SET
            settled = true,
            payout = $1
          WHERE id = $2
          `,
          [
            refund,
            position.id
          ]
        );
      }

      await client.query(
        `
        UPDATE markets
        SET
          shutdown = true,
          resolved = true,
          outcome = 'SHUT_DOWN'
        WHERE id = $1
        `,
        [marketId]
      );

      await client.query("COMMIT");

      return res.json({
        success: true
      });

    } catch (err) {

      await client.query("ROLLBACK");

      return res.status(500).json({
        success: false,
        error: err.message
      });

    } finally {
      client.release();
    }
  }
);
router.get(
  "/market-submissions",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {

      const result = await pool.query(`
        SELECT
          ms.*,
          u.username
        FROM market_submissions ms
        JOIN users u
          ON u.id = ms.user_id
        WHERE ms.status = 'pending'
        ORDER BY ms.created_at ASC
      `);

      res.json({
        success: true,
        submissions: result.rows,
      });

    } catch (err) {

      res.status(500).json({
        success: false,
        error: err.message,
      });

    }
  }
);
router.post(
  "/update-submission",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    try {

      const {
        submissionId,
        title,
        description,
        rules,
        category,
        end_date,
        options,
        bundle_predictions,
        b,
        featured
      } = req.body;

      await pool.query(
        `
        UPDATE market_submissions
        SET
          title = $1,
          description = $2,
          rules = $3,
          category = $4,
          end_date = $5,
          options = $6,
          bundle_predictions = $7,
          b = $8,
          featured = $9
        WHERE id = $10
        `,
        [
          title,
          description,
          rules,
          category,
          end_date,
          JSON.stringify(options),
          JSON.stringify(bundle_predictions),
          b,
          featured,
          submissionId
        ]
      );

      res.json({
        success: true
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        success: false,
        error: err.message
      });

    }
  }
);
router.post(
  "/approve-submission",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const { submissionId } = req.body;

    const client = await pool.connect();

    try {

      await client.query("BEGIN");

      const submissionRes =
        await client.query(
          `
          SELECT *
          FROM market_submissions
          WHERE id = $1
          `,
          [submissionId]
        );

      if (!submissionRes.rows.length) {
        throw new Error("Submission not found");
      }

      const submission =
        submissionRes.rows[0];

      const marketRes =
        await client.query(
          `
          INSERT INTO markets
          (
            title,
            description,
            rules,
            category,
            b,
            end_date,
            resolved,
            market_type,
            bundle_predictions,
            creator_id
          )
          VALUES
          (
            $1,$2,$3,$4,$5,$6,
            false,
            $7,
            $8,
            $9
          )
          RETURNING *
          `,
          [
            submission.title,
            submission.description,
            submission.rules,
            submission.category,
            submission.b || 50,
            submission.end_date,
            submission.market_type,
            JSON.stringify(submission.bundle_predictions || []),
            submission.user_id
          ]
        );

      const marketId =
        marketRes.rows[0].id;

      const options =
        submission.options || [];

      for (const option of options) {

        await client.query(
          `
          INSERT INTO market_outcomes
          (
            market_id,
            outcome,
            pool
          )
          VALUES
          (
            $1,
            $2,
            0
          )
          `,
          [marketId, option]
        );
      }

      await client.query(
        `
        UPDATE market_submissions
        SET status = 'approved'
        WHERE id = $1
        `,
        [submissionId]
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
router.post(
  "/reject-submission",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const { submissionId } = req.body;

    try {

      await pool.query(
        `
        UPDATE market_submissions
        SET status = 'rejected'
        WHERE id = $1
        `,
        [submissionId]
      );

      res.json({
        success: true,
      });

    } catch (err) {

      res.status(500).json({
        success: false,
        error: err.message,
      });

    }
  }
);
router.get(
  "/withdrawals",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {

      const result = await pool.query(`
        SELECT
          w.*,
          u.username
        FROM withdrawals w
        JOIN users u
          ON u.id = w.user_id
        WHERE w.status = 'pending'
        ORDER BY w.created_at ASC
      `);

      return res.json({
        success: true,
        withdrawals: result.rows,
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
router.post(
  "/approve-withdrawal",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const { withdrawalId } = req.body;

    try {

      await pool.query(
        `
        UPDATE withdrawals
        SET
          status = 'approved',
          processed_at = NOW()
        WHERE id = $1
        `,
        [withdrawalId]
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
router.post(
  "/reject-withdrawal",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {

    const { withdrawalId } = req.body;

    const client = await pool.connect();

    try {

      await client.query("BEGIN");

      const withdrawalRes =
        await client.query(
          `
          SELECT *
          FROM withdrawals
          WHERE id = $1
            AND status = 'pending'
          `,
          [withdrawalId]
        );

      if (!withdrawalRes.rows.length) {
        throw new Error(
          "Withdrawal not found"
        );
      }

      const withdrawal =
        withdrawalRes.rows[0];

      await client.query(
        `
        UPDATE wallets
        SET balance = balance + $1
        WHERE user_id = $2
        `,
        [
          withdrawal.amount,
          withdrawal.user_id,
        ]
      );

      await client.query(
        `
        UPDATE withdrawals
        SET
          status = 'rejected',
          processed_at = NOW()
        WHERE id = $1
        `,
        [withdrawalId]
      );

      await client.query("COMMIT");

      return res.json({
        success: true,
      });

    } catch (err) {

      await client.query("ROLLBACK");

      console.error(err);

      return res.status(500).json({
        success: false,
        error: err.message,
      });

    } finally {
      client.release();
    }
  }
);

router.get(
  "/search-users",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {

      const q = req.query.q?.trim();

      if (!q) {
        return res.json({
          success: true,
          users: []
        });
      }

      const result = await pool.query(
        `
        SELECT
          id,
          username,
          email
        FROM users
        WHERE
          username ILIKE $1
          OR email ILIKE $1
        LIMIT 10
        `,
        [`%${q}%`]
      );

      res.json({
        success: true,
        users: result.rows
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        success:false,
        error:err.message
      });

    }
  }
);
router.post(
  "/send-email",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const {
        userId,
        subject,
        message = "",
        html = ""
      } = req.body;

      if (!userId || !subject) {
        return res.status(400).json({
          success: false,
          error: "Missing fields"
        });
      }

      const userRes = await pool.query(
        `
        SELECT username, email
        FROM users
        WHERE id = $1
        `,
        [userId]
      );

      if (!userRes.rows.length) {
        return res.status(404).json({
          success: false,
          error: "User not found"
        });
      }

      const user = userRes.rows[0];

      const hasHtml = html && /<[^>]+>/.test(html);

      let email;

      if (hasHtml) {
        email = {
          from: "Probability Support <support@theprobability.site>",
          to: user.email,
          subject,
          html,
          text: htmlToText(html),
          replyTo: "support@theprobability.site"
        };
      } else {
        email = {
          from: "Probability Support <support@theprobability.site>",
          to: user.email,
          subject,
          text: message,
          html: `<div style="white-space:pre-wrap">${message}</div>`,
          replyTo: "support@theprobability.site"
        };
      }

      await resend.emails.send(email);

      res.json({
        success: true
      });

    } catch (err) {
      console.error(err);

      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }
);
module.exports = router;
