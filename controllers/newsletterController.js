const { Resend } = require("resend");
const pool = require("../db");

const resend = new Resend(process.env.RESEND_API_KEY);

exports.subscribe = async (req, res) => {

  try {

    const { email } = req.body;

    if (!email) {
      return res.json({
        success: false,
        message: "Email required",
      });
    }

    // Already subscribed?

    const existing = await pool.query(
      `
      SELECT *
      FROM newsletter_subscribers
      WHERE email=$1
      `,
      [email]
    );

    if (existing.rows.length > 0) {

      return res.json({
        success: true,
        message: "Already subscribed",
      });

    }

    // Save

    await pool.query(
      `
      INSERT INTO newsletter_subscribers(email)
      VALUES($1)
      `,
      [email]
    );

    // Welcome Email

    await resend.emails.send({

      from: "Probability <news@theprobability.site>",

      to: email,

      subject: "Welcome to Probability News",

      html: `
      <h2>Welcome to Probability!</h2>

      <p>
      Thanks for subscribing to Probability News.
      </p>

      <p>
      You'll now receive:
      </p>

      <ul>
        <li>Breaking Market News</li>
        <li>Economic Analysis</li>
        <li>Company Updates</li>
        <li>Crypto News</li>
        <li>Political Events</li>
        <li>Sports Predictions</li>
      </ul>

      <p>
      Stay informed.
      Stay ahead.
      Trade smarter.
      </p>

      <p>
      — Probability
      </p>
      `

    });

    res.json({

      success: true,

      message: "Subscribed successfully"

    });

  }

  catch(err){

    console.error(err);

    res.status(500).json({

      success:false,

      error:err.message

    });

  }

};
