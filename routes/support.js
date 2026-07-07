const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

router.post("/contact", authMiddleware, async (req, res) => {
  try {

    const { subject, message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        error: "Missing fields",
      });
    }

    await resend.emails.send({
      from: "Probability Support <support@theprobability.site>",

      to: "mollyjane797@gmail.com",

      replyTo: "mollyjane797@gmail.com",

      subject: `[Help Center] ${subject}`,

      text: `
User ID: ${req.user.userId}
Username: ${req.user.username}
Email: ${req.user.email}

Message:

${message}
      `,
    });

    return res.json({
      success: true,
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      error: "Failed to send email",
    });

  }
});

module.exports = router;
