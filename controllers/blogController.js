const pool = require("../db");

function slugify(text) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

exports.createBlog = async (req, res) => {

    try {

        if (req.user.role !== "admin") {
            return res.json({
                success: false,
                error: "Unauthorized"
            });
        }

        const {
            title,
            subtitle,
            content,
            category,
            tags,
            featured_image
        } = req.body;

        if (!title || !content) {
            return res.json({
                success: false,
                error: "Missing title or content"
            });
        }

        let slug = slugify(title);

        let counter = 1;

        while (true) {

            const exists = await pool.query(
                `
                SELECT id
                FROM blogs
                WHERE slug=$1
                `,
                [slug]
            );

            if (exists.rows.length === 0)
                break;

            slug =
                slugify(title) +
                "-" +
                counter;

            counter++;

        }

        const result = await pool.query(
            `
            INSERT INTO blogs (

                title,
                subtitle,
                slug,
                content,
                category,
                tags,
                featured_image,
                author_id

            )

            VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8
            )

            RETURNING *
            `,
            [

                title,
                subtitle,
                slug,
                content,
                category,
                tags,
                featured_image,
                req.user.id

            ]
        );

        res.json({

            success: true,

            blog: result.rows[0]

        });

    } catch (err) {

        console.error(err);

        res.status(500).json({

            success: false,

            error: "Server error"

        });

    }

};

exports.getBlogs = async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT

                id,
                title,
                subtitle,
                slug,
                category,
                featured_image,
                published_at

            FROM blogs

            WHERE published = TRUE

            ORDER BY published_at DESC
        `);

        res.json({

            success: true,

            blogs: result.rows

        });

    } catch (err) {

        console.error(err);

        res.status(500).json({

            success: false,

            error: "Server error"

        });

    }

};
exports.getBlog = async (req, res) => {
  try {
    const { slug } = req.params;

    const result = await pool.query(
      `
      SELECT
        blogs.*,
        users.username AS author
      FROM blogs
      LEFT JOIN users
        ON blogs.author_id = users.id
      WHERE slug = $1
      LIMIT 1
      `,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: false,
        error: "Blog not found",
      });
    }

    res.json({
      success: true,
      blog: result.rows[0],
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};
