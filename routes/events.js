const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        title,
        category,
        description,
        start_date,
        end_date,
        image,
        featured
      FROM events
      ORDER BY
        featured DESC,
        start_date ASC,
        id DESC
    `);

    res.json({
      success: true,
      events: result.rows
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: "Failed to load events"
    });
  }
});

router.get("/:id", async (req, res) => {
    const result = await pool.query(
        `
        SELECT *
        FROM events
        WHERE id = $1
        `,
        [req.params.id]
    );

    if (!result.rows.length) {
        return res.json({
            success: false
        });
    }

    res.json({
        success: true,
        event: result.rows[0]
    });
});

router.get("/:id/markets", async (req, res) => {
    const result = await pool.query(
        `
        SELECT *
        FROM markets
        WHERE event_id = $1
        ORDER BY id ASC
        `,
        [req.params.id]
    );

    res.json({
        success: true,
        markets: result.rows
    });
});

module.exports = router;
