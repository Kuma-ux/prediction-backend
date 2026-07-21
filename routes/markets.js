const express = require("express");
const router = express.Router();
const pool = require("../db");
const db = require("../db");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/chat");
  },

  filename: function (req, file, cb) {
    cb(
      null,
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname)
    );
  }
});

const upload = multer({
  storage
});
const authMiddleware = require("../middleware/authMiddleware");
const requireAuth = require("../middleware/requireAuth");
const {
  buyOutcome,
  sellOutcome,
  getOdds
} = require("../services/marketEngine");

router.get("/", async (req, res) => {

  try {

    // -----------------------------------
    // AUTO-EXPIRE LIVE MARKETS
    // -----------------------------------

    const expiredLiveMarkets = await pool.query(
      `
      SELECT id
      FROM markets
      WHERE
        is_live = true
        AND resolved = false
        AND resolving = false
        AND end_date <= NOW()
      `
    );

    for (const liveMarket of expiredLiveMarkets.rows) {

      try {

        await pool.query(
          `
          UPDATE markets
          SET resolving = true
          WHERE id = $1
            AND resolving = false
          `,
          [liveMarket.id]
        );

      } catch (err) {
        console.error("Failed locking live market:", err);
      }
    }

    // -----------------------------------
    // LOAD MARKETS
    // -----------------------------------

    const marketsRes = await pool.query(`
      SELECT *
      FROM markets
      WHERE resolved = false
      ORDER BY featured DESC, id DESC
    `);

    const eventsRes = await pool.query(`
    SELECT *
    FROM events
    ORDER BY featured DESC, start_date ASC
    `);

    const markets = [];
    const events = [];

    // -----------------------------------
    // LOAD ALL OUTCOMES IN ONE QUERY
    // -----------------------------------

    const marketIds = marketsRes.rows.map(m => m.id);

    const outcomesMap = {};

    if (marketIds.length > 0) {

      const allOutcomesRes = await pool.query(
        `
        SELECT market_id, outcome, pool
        FROM market_outcomes
        WHERE market_id = ANY($1::int[])
        `,
        [marketIds]
      );

      for (const row of allOutcomesRes.rows) {

        if (!outcomesMap[row.market_id]) {
          outcomesMap[row.market_id] = [];
        }

        outcomesMap[row.market_id].push({
          outcome: row.outcome,
          pool: Number(row.pool),
        });
      }
    }

    // -----------------------------------
    // BUILD MARKET RESPONSE
    // -----------------------------------

    for (const market of marketsRes.rows) {

      const outcomes = outcomesMap[market.id] || [];

      // -----------------------------------
      // TOTAL POOL
      // -----------------------------------

      const totalVolume = outcomes.reduce(
        (sum, o) => sum + o.pool,
        0
      );

      // -----------------------------------
      // ODDS
      // -----------------------------------

      const odds = {};

      for (const outcome of outcomes) {

        odds[outcome.outcome] =
          totalVolume > 0
            ? Number(
                (outcome.pool / totalVolume).toFixed(4)
              )
            : 0;
      }

      // -----------------------------------
      // LIVE MARKET STATUS
      // -----------------------------------

      const now = Date.now();

      const endTime =
        market.end_date
          ? new Date(market.end_date).getTime()
          : null;

      const timeRemaining =
        endTime
          ? Math.max(0, endTime - now)
          : 0;

      const isExpired =
        endTime
          ? now >= endTime
          : false;

      // -----------------------------------
      // FRONTEND FORMAT
      // -----------------------------------

      markets.push({

        id: market.id,
        event_id: market.event_id,

        title: market.title,

        description: market.description,

        rules: market.rules,

        category: market.category,

        end_date: market.end_date,

        resolved: market.resolved,

        resolving: market.resolving || false,

        featured: market.featured,

        is_live: market.is_live || false,

        live_duration_minutes:
          market.live_duration_minutes || null,

        market_type:
          market.market_type || "standard",

        bundle_predictions:
          market.bundle_predictions || [],

        options:
          outcomes.map(o => o.outcome),

        pools:
          Object.fromEntries(
            outcomes.map(o => [
              o.outcome,
              o.pool,
            ])
          ),

        odds,

        totalvolume: totalVolume,

        outcome: market.outcome || null,

        resolution: market.resolution || null,

        resolved_at: market.resolved_at || null,

        time_remaining_ms: timeRemaining,

        expired: isExpired,
      });
    }

    for (const event of eventsRes.rows) {

        const eventMarkets = markets.filter(
          m => m.event_id === event.id
        );

        const totalVolume = eventMarkets.reduce(
          (sum, market) => sum + Number(market.totalvolume || 0),
          0
        );
      
        events.push({

          id: event.id,

          title: event.title,

          category: event.category,

          description: event.description,

          start_date: event.start_date,

          end_date: event.end_date,

          image: event.image,

          markets: eventMarkets,

          featured: event.featured,

          totalvolume: totalVolume,
        });
    }

    const standaloneMarkets =
      markets.filter(
        m => !m.event_id
      );

    return res.json({
      success: true,
      markets,
      events,
      standaloneMarkets
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Failed to load markets",
    });
  }
});
router.post(
  "/submit-market",
  authMiddleware,
  async (req, res) => {
    try {
      const {
        title,
        description,
        resolution,
        category,
        end_date,
        options,
        market_type,
        bundle_predictions,
      } = req.body;

      if (!title || !description || !resolution || !category) {
        return res.status(400).json({
          success: false,
          error: "Missing fields",
        });
      }

      console.log("USER:", req.user);
      console.log("BODY:", req.body);
      console.log("options:", options);
      console.log("options type:", typeof options);
      console.log("isArray:", Array.isArray(options));
      console.log("bundle_predictions:", bundle_predictions);
      console.log("bundle_predictions type:", typeof bundle_predictions);
      console.log(
        "bundle_predictions isArray:",
        Array.isArray(bundle_predictions)
      );

      await pool.query(
        `
        INSERT INTO market_submissions
        (
          user_id,
          title,
          description,
          rules,
          category,
          end_date,
          options,
          market_type,
          bundle_predictions
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,
        [
          req.user.userId || req.user.id,
          title,
          description,
          resolution,
          category,
          end_date ? new Date(end_date) : null,
          JSON.stringify(options || []),
          market_type || "standard",
          JSON.stringify(bundle_predictions || [])
        ]
      );

      res.json({ success: true });

    } catch (err) {
      console.error(err.message);
      console.error(err.detail);
      console.error(err);

      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  }
);

router.get("/:id/comments", async (req, res) => {
  try {
    const marketId = req.params.id;

    let currentUserId = null;

    try{
      const token = req.cookies.token;

      if (token) {
        const decoded = jwt.verify(
          token,
          process.env.JWT_SECRET
        );

        currentUserId = decoded.userId;
      }
    } catch {}

    const commentsRes = await pool.query(
      `
      SELECT
        mc.*,
        u.username,
        COUNT(DISTINCT cl.id)::int AS likes,
        EXISTS (
          SELECT 1
          FROM comment_likes my_like
          WHERE my_like.comment_id = mc.id
          AND my_like.user_id = $2
        ) AS liked_by_me,
        
        (
          SELECT COUNT(*)
          FROM comment_replies cr
          WHERE cr.comment_id = mc.id
        )::int AS reply_count
      FROM market_comments mc
      JOIN users u
        ON u.id = mc.user_id
      LEFT JOIN comment_likes cl
        ON cl.comment_id = mc.id
      WHERE mc.market_id = $1
      GROUP BY
        mc.id,
        u.username
      ORDER BY mc.created_at DESC
      `,
      [marketId, currentUserId]
    );

    return res.json({
      success: true,
      comments: commentsRes.rows,
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      error: "Failed to load comments",
    });
  }
});

router.post("/:id/comments", async (req, res) => {
  try {
    const marketId = req.params.id;
    const { content } = req.body;

    if (!content?.trim()) {
      return res.json({
        success: false,
        error: "Comment cannot be empty",
      });
    }

    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Please login first",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    await pool.query(
      `
      INSERT INTO market_comments
      (
        market_id,
        user_id,
        content
      )
      VALUES ($1, $2, $3)
      `,
      [
        marketId,
        decoded.userId,
        content.trim(),
      ]
    );

    return res.json({
      success: true,
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      error: "Failed to post comment",
    });
  }
});

router.post("/comments/:commentId/like", requireAuth, async (req, res) => {
  try {
    const { commentId } = req.params;

    // Has the user already liked this comment?
   const existing = await pool.query(
     `
     SELECT id
     FROM comment_likes
     WHERE comment_id = $1
       AND user_id = $2
    `,
    [commentId, req.user.id]
   );

   let liked;

   if (existing.rows.length > 0) {
     // Unlike
     await pool.query(
       `
       DELETE FROM comment_likes
       WHERE comment_id = $1
         AND user_id = $2
       `,
       [commentId, req.user.id]
      );

      liked = false;
   } else {
     // Like
     await pool.query(
       `
       INSERT INTO comment_likes
       (comment_id, user_id)
       VALUES ($1, $2)
       `,
       [commentId, req.user.id]
      );

      liked = true;
   }

   // Get the latest like count
   const countResult = await pool.query(
     `
     SELECT COUNT(*)::int AS likes
     FROM comment_likes
     WHERE comment_id = $1
     `,
     [commentId]
    );

    res.json({
      success: true,
      liked,
      likes: countResult.rows[0].likes,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: "Failed to update like",
    });
  }
});

router.get("/:id/holders", async (req, res) => {
  try {
    const marketId = req.params.id;

    const holders = await pool.query(
      `
      SELECT
        u.username,
        SUM(p.shares) AS shares
      FROM positions p
      JOIN users u
        ON u.id = p.user_id
      WHERE p.market_id = $1
      GROUP BY u.username
      ORDER BY SUM(p.shares) DESC
      LIMIT 25
      `,
      [marketId]
    );

    res.json({
      success: true,
      holders: holders.rows,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
    });
  }
});

router.get("/:id/activity", async (req, res) => {
  try {
    const marketId = req.params.id;

    const activity = await pool.query(
      `
      SELECT
        t.*,
        u.username
      FROM trades t
      JOIN users u
        ON u.id = t.user_id
      WHERE t.market_id = $1
      ORDER BY t.created_at DESC
      LIMIT 100
      `,
      [marketId]
    );

    res.json({
      success: true,
      activity: activity.rows,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
    });
  }
});
router.post(
  "/comments/:commentId/replies",
  requireAuth,
  async (req, res) => {
    try {

      const { commentId } = req.params;
      const { content } = req.body;

      await pool.query(
        `
        INSERT INTO comment_replies
        (
          comment_id,
          user_id,
          content
        )
        VALUES ($1,$2,$3)
        `,
        [
          commentId,
          req.user.id,
          content,
        ]
      );

      res.json({
        success: true,
      });

    } catch (err) {
      console.error(err);

      res.json({
        success: false,
      });
    }
  }
);

router.get(
  "/comments/:commentId/replies",
  async (req, res) => {

    const { commentId } = req.params;

    const replies = await pool.query(
      `
      SELECT
        r.*,
        u.username
      FROM comment_replies r
      JOIN users u
        ON u.id = r.user_id
      WHERE r.comment_id = $1
      ORDER BY r.created_at ASC
      `,
      [commentId]
    );

    res.json({
      success: true,
      replies: replies.rows,
    });
  }
);
router.get(
  "/:id/my-positions",
  requireAuth,
  async (req, res) => {

    try {

      const marketId = req.params.id;

      const positionsRes = await pool.query(
        `
        SELECT
          id,
          outcome,
          shares,
          avg_cost
        FROM positions
        WHERE market_id = $1
          AND user_id = $2
          AND archived = false
          AND shares > 0
        ORDER BY id DESC
        `,
        [
          marketId,
          req.user.id
        ]
      );

      res.json({
        success: true,
        positions: positionsRes.rows
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        success: false,
        error: "Failed loading positions"
      });

    }
  }
);
router.post(
  "/cashout",
  requireAuth,
  async (req, res) => {

    const {
      positionId,
      sharesToSell
    } = req.body;

    const client =
      await pool.connect();

    try {

      await client.query("BEGIN");

      const positionRes =
        await client.query(
          `
          SELECT *
          FROM positions
          WHERE id = $1
            AND user_id = $2
            AND archived = false
          `,
          [
            positionId,
            req.user.id
          ]
        );

      if (
        positionRes.rows.length === 0
      ) {
        throw new Error(
          "Position not found"
        );
      }

      const position =
        positionRes.rows[0];

      const sellAmount =
        Number(sharesToSell);

      if (
        sellAmount <= 0 ||
        sellAmount >
          Number(position.shares)
      ) {
        throw new Error(
          "Invalid share amount"
        );
      }

      const marketRes = await client.query(
        `
        SELECT b
        FROM markets
        WHERE id = $1
        `,
        [position.market_id]
      );

      const market = marketRes.rows[0];

      const outcomesRes = await client.query(
        `
        SELECT outcome, pool
        FROM market_outcomes
        WHERE market_id = $1
        FOR UPDATE
        `,
        [position.market_id]
      );

      if(
        !outcomesRes.rows.some(
          o => o.outcome === position.outcome
        )
      ) {
        throw new Error(
          "Outcome not found"
        );
      }

      const result = sellOutcome(
        {
          outcomes: outcomesRes.rows.map(o => ({
            outcome: o.outcome,
            pool: Number(o.pool),
          })),
          b: Number(market.b || 50),
        },
        position.outcome,
        sellAmount
      );

      const payout = result.payout * 0.85;
      const updatedOutcomes = result.market.outcomes;
      const currentPrice =
        result.odds[position.outcome];

      for (const outcome of updatedOutcomes) {
        await client.query(
          `
          UPDATE market_outcomes
          SET pool = $1
          WHERE market_id = $2
            AND outcome = $3
          `,
          [
            outcome.pool,
            position.market_id,
            outcome.outcome
          ]
        );
      }

      await client.query(
        `
        UPDATE wallets
        SET balance =
          balance + $1
        WHERE user_id = $2
        `,
        [
          payout,
          req.user.id
        ]
      );

      const remainingShares =
        Number(position.shares)
        - sellAmount;

      if (
        remainingShares <= 0
      ) {

        await client.query(
          `
          UPDATE positions
          SET
            shares = 0,
            archived = true
          WHERE id = $1
          `,
          [position.id]
        );

      } else {

        await client.query(
          `
          UPDATE positions
          SET shares = $1
          WHERE id = $2
          `,
          [
            remainingShares,
            position.id
          ]
        );

      }

      await client.query(
        `
        INSERT INTO trades
        (
          user_id,
          market_id,
          outcome,
          shares,
          cost_paid,
          price,
          trade_type
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          'cashout'
        )
        `,
        [
          req.user.id,
          position.market_id,
          position.outcome,
          sellAmount,
          payout,
          currentPrice
        ]
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        success: true,
        payout:
          payout.toFixed(2),
        currentPrice:
          currentPrice.toFixed(4)
      });

    } catch (err) {

      await client.query(
        "ROLLBACK"
      );

      console.error(err);

      res.status(500).json({
        success: false,
        error: err.message
      });

    } finally {

      client.release();

    }
  }
);
router.get("/:id/chat", async (req, res) => {
  try {

    const marketId = req.params.id;

    const messages = await pool.query(
      `
      SELECT
        m.id,
        m.message,
        m.image_url,
        m.created_at,
        m.reply_to_id,
        m.reply_to_username,
        u.username,
        COALESCE(
        (
          SELECT json_agg(x)
          FROM(
            SELECT
              emoji,
              COUNT(*)::int AS count
            FROM market_chat_reactions
            WHERE message_id = m.id
            GROUP BY emoji
            ) x
        ),
        '[]'
        ) AS reactions
      FROM market_chat_messages m
      JOIN users u
        ON u.id = m.user_id
      WHERE m.market_id = $1
      ORDER BY m.created_at ASC
      LIMIT 200
      `,
      [marketId]
    );

    res.json({
      success: true,
      messages: messages.rows,
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
    });
  }
});
router.post(
  "/:id/chat",
  requireAuth,
  upload.single("image"),
  async (req, res) => {

    try {

      const marketId = req.params.id;

      const {
        message,
        replyToId,
        replyToUsername
      } = req.body;

      const imageUrl = req.file
        ? `/uploads/chat/${req.file.filename}`
        : null;

      if (
        !message?.trim() &&
        !imageUrl
      ) {
        return res.json({
          success: false,
          error: "Message or image required"
        });
      }

      const inserted = await pool.query(
        `
        INSERT INTO market_chat_messages
        (
          market_id,
          user_id,
          message,
          image_url,
          reply_to_id,
          reply_to_username
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *
        `,
        [
          marketId,
          req.user.id,
          message?.trim() || null,
          imageUrl,
          replyToId || null,
          replyToUsername || null
        ]
      );

      const userRes = await pool.query(
        `
        SELECT username
        FROM users
        WHERE id = $1
        `,
        [req.user.id]
      );

      const chatMessage = {
        ...inserted.rows[0],
        username: userRes.rows[0].username
      };

      req.app
        .get("io")
        .to(`market_${marketId}`)
        .emit(
          "new_message",
          chatMessage
        );

      res.json({
        success: true,
        message: chatMessage
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        success: false
      });
    }
  }
);
router.post(
  "/chat/:messageId/react",
  requireAuth,
  async (req, res) => {

    const { messageId } = req.params;
    const { emoji } = req.body;

    await pool.query(
      `
      INSERT INTO market_chat_reactions
      (
        message_id,
        user_id,
        emoji
      )
      VALUES ($1,$2,$3)
      ON CONFLICT DO NOTHING
      `,
      [
        messageId,
        req.user.id,
        emoji
      ]
    );

    const io = req.app.get("io");

    const reactions = await pool.query(
      `
      SELECT
        emoji,
        COUNT(*)::int AS count
      FROM market_chat_reactions
      WHERE message_id = $1
      GROUP BY emoji
      `,
      [messageId]
    );

    io.emit(
      "message_reactions",
      {
        messageId: Number(messageId),
        reactions: reactions.rows
      }
    );

    res.json({
      success: true
    });
  }
);
router.delete(
  "/chat/:messageId/react",
  requireAuth,
  async (req,res) => {

    const { messageId } = req.params;
    const { emoji } = req.body;

    await pool.query(
      `
      DELETE FROM market_chat_reactions
      WHERE message_id = $1
      AND user_id = $2
      AND emoji = $3
      `,
      [
        messageId,
        req.user.id,
        emoji
      ]
    );

    const io = req.app.get("io");

    const reactions = await pool.query(
      `
      SELECT
        emoji,
        COUNT(*)::int AS count
      FROM market_chat_reactions
      WHERE message_id = $1
      GROUP BY emoji
      `,
      [messageId]
    );

    io.emit(
      "message_reactions",
      {
        messageId: Number(messageId),
        reactions: reactions.rows
      }
    );

    res.json({
      success:true
    });
  }
);
router.get("/:id", async (req, res) => {
  try {

    const marketId = req.params.id;

    // -----------------------------------
    // LOAD MARKET
    // -----------------------------------

    const marketRes = await pool.query(
      `
      SELECT *
      FROM markets
      WHERE id = $1
        AND resolved = false
      `,
      [marketId]
    );

    if (!marketRes.rows.length) {
      return res.json({
        success: false,
        error: "Market not found",
      });
    }

    const market = marketRes.rows[0];

    // -----------------------------------
    // LOAD OUTCOMES
    // -----------------------------------

    const outcomesRes = await pool.query(
      `
      SELECT outcome, pool
      FROM market_outcomes
      WHERE market_id = $1
      `,
      [marketId]
    );

    const outcomes = outcomesRes.rows.map(o => ({
      outcome: o.outcome,
      pool: Number(o.pool),
    }));

    // -----------------------------------
    // TOTAL VOLUME
    // -----------------------------------

    const totalVolume = outcomes.reduce(
      (sum, o) => sum + o.pool,
      0
    );

    // -----------------------------------
    // ODDS
    // -----------------------------------

    const odds = {};

    for (const outcome of outcomes) {

      odds[outcome.outcome] =
        totalVolume > 0
          ? Number(
              (outcome.pool / totalVolume).toFixed(4)
            )
          : 0;
    }

    // -----------------------------------
    // RESPONSE
    // -----------------------------------

    return res.json({
      success: true,

      market: {

        id: market.id,

        title: market.title,

        description: market.description,

        rules: market.rules,

        category: market.category,

        end_date: market.end_date,

        resolved: market.resolved,

        resolving: market.resolving || false,

        featured: market.featured,

        is_live: market.is_live || false,

        live_duration_minutes:
          market.live_duration_minutes || null,

        market_type:
          market.market_type || "standard",

        bundle_predictions:
          market.bundle_predictions || [],

        options:
          outcomes.map(o => o.outcome),

        pools:
          Object.fromEntries(
            outcomes.map(o => [
              o.outcome,
              o.pool,
            ])
          ),

        odds,

        totalvolume: totalVolume,

        outcome: market.outcome || null,

        resolution: market.resolution || null,

        resolved_at: market.resolved_at || null,
      },
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

module.exports = router;
