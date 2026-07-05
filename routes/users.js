const express = require("express");
const router = express.Router();
const pool = require("../db");
const multer = require("multer");
const requireAuth = require("../middleware/requireAuth");

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(
      null,
      Date.now() + "-" + file.originalname
    );
  },
});

const upload = multer({
  storage,
});

router.get(
  "/me",
  requireAuth,
  async (req, res) => {
    try {

      const result = await pool.query(
        `
        SELECT
          id,
          username,
          bio,
          avatar_url,
          created_at
        FROM users
        WHERE id = $1
        `,
        [req.user.id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
        });
      }

      return res.json({
        success: true,
        user: result.rows[0],
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        success: false,
      });
    }
  }
);

router.post(
  "/update-profile",
  requireAuth,
  upload.single("avatar"),
  async (req, res) => {

    try {

      const {
        username,
        bio,
        removeAvatar,
      } = req.body;

      // Check if username is already taken
      if (username?.trim()) {

        const existingUser = await pool.query(
          `
          SELECT id
          FROM users
          WHERE LOWER(username) = LOWER($1)
            AND id != $2
          `,
          [
            username.trim(),
            req.user.id,
          ]
        );

        if (existingUser.rows.length > 0){
          return res.status(400).json({
            success: false,
            error: "Username already exists",
          });
        }
      }

      let avatarUrl = null;

      if (req.file) {
        avatarUrl =
          `/uploads/${req.file.filename}`;
      }

      await pool.query(
        `
        UPDATE users
        SET

          username =
            COALESCE(
              NULLIF($1, ''),
              username
            ),

          bio =
            COALESCE(
              NULLIF($2, ''),
              bio
            ),

          avatar_url =
            CASE

              WHEN $4 = 'true'
              THEN NULL

              ELSE COALESCE(
                $3,
                avatar_url
              )

            END

        WHERE id = $5
        `,
        [
          username,
          bio,
          avatarUrl,
          removeAvatar,
          req.user.id,
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

router.get("/:username/preview", async (req, res) => {
  try {
    const { username } = req.params;

    const userRes = await pool.query(
      `
      SELECT
        id,
        username,
        created_at,
        bio,
        avatar_url
      FROM users
      WHERE LOWER(username) = LOWER($1)
      `,
      [username]
    );

    if (!userRes.rows.length) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const user = userRes.rows[0];

    // Total predictions
    const predictionRes = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM trades
      WHERE user_id = $1
      `,
      [user.id]
    );

    // Profit / Loss
    const pnlRes = await pool.query(
      `
      SELECT
        COALESCE(
          SUM(
            payout -
            (shares * avg_cost)
          ),
          0
        ) AS pnl
      FROM positions
      WHERE user_id = $1
        AND settled = true
      `,
      [user.id]
    );

    // Biggest win
    const biggestWinRes = await pool.query(
      `
      SELECT
        COALESCE(
          MAX(
            payout -
            (shares * avg_cost)
          ),
          0
        ) AS biggest_win
      FROM positions
      WHERE user_id = $1
        AND settled = true
      `,
      [user.id]
    );

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        joined: user.created_at,
        bio: user.bio,
        avatar_url: user.avatar_url,

        predictions:
          Number(predictionRes.rows[0]?.total || 0),

        profitLoss:
          Number(
            Number(
              pnlRes.rows[0]?.pnl || 0
            ).toFixed(2)
          ),

        biggestWin:
          Number(
            biggestWinRes.rows[0]?.biggest_win || 0
          ),
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