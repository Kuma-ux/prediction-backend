// routes/support.js

const express = require("express");
const router = express.Router();

const authMiddleware =
  require("../middleware/authMiddleware");

const nodemailer = require("nodemailer");

router.post(
  "/contact",
  authMiddleware,
  async (req, res) => {

    try {

      const { subject, message } = req.body;

      if (!subject || !message) {
        return res.status(400).json({
          success: false,
          error: "Missing fields",
        });
      }

      console.log("EMAIL_USER:", process.env.EMAIL_USER);
      console.log("EMAIL_PASS:", process.env.EMAIL_PASS);

      const transporter =
        nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
          },
        });

      await transporter.sendMail({
        from: process.env.EMAIL_USER,

        to: "mollyjane797@gmail.com",

        subject: `[Help Center] ${subject}`,

        text: `
User ID: ${req.user.userId}
Username: ${req.user.username}

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
  }
);

module.exports = router;