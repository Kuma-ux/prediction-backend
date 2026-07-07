const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

require("dotenv").config();

// REGISTER
exports.register = async (req, res) => {
  try {

    const {
      email,
      password,
      username,
    } = req.body;

    // VALIDATION
    if (
      !username ||
      username.length < 3
    ) {
      return res.json({
        success: false,
        message: "Username too short",
      });
    }

    // EMAIL EXISTS
    const userExists = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (userExists.rows.length > 0) {
      return res.json({
        success: false,
        message: "User already exists",
      });
    }

    // USERNAME EXISTS
    const usernameExists = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    if (usernameExists.rows.length > 0) {
      return res.json({
        success: false,
        message: "Username already taken",
      });
    }

    const hashedPassword = await bcrypt.hash(
      password,
      10
    );

    // CREATE USER
    const newUser = await pool.query(
      `
      INSERT INTO users
      (email, password, username)
      VALUES ($1, $2, $3)
      RETURNING id, email, username, role
      `,
      [
        email,
        hashedPassword,
        username,
      ]
    );

    const userId = newUser.rows[0].id;

    // CREATE WALLET
    await pool.query(
      `
      INSERT INTO wallets
      (user_id, balance)
      VALUES ($1, 0)
      `,
      [userId]
    );

    res.json({
      success: true,
      user: newUser.rows[0],
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// LOGIN
exports.login = async (req, res) => {
  try {
    console.log("LOGIN REQUEST");
    console.log("Origin:", req.headers.origin);
    console.log("Host:", req.headers.host);

    console.log({
      protocol: req.protocol,
      secure: req.secure,
      forwarded: req.headers["x-forwarded-proto"],
    });
  
    const { email, password } = req.body;

    const user = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (user.rows.length === 0) {
      return res.json({ success: false, message: "User not found" });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.rows[0].password
    );

    if (!validPassword) {
      return res.json({ success: false, message: "Invalid password" });
    }

    const token = jwt.sign(
      { userId: user.rows[0].id, username: user.rows[0].username, role: user.rows[0].role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    console.log("Cookie attached.");
    console.log("Set-Cookie header:");
    console.log(res.getHeader("Set-Cookie"));

    return res.json({
      success: true,
      message: "Login successful",
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};
exports.me = async (req, res) => {
  try {
    console.log("=================================");
    console.log("REQUEST:", req.method, req.originalUrl);
    console.log("Host:", req.headers.host);
    console.log("Origin:", req.headers.origin);
    console.log("Referer:", req.headers.referer);
    console.log("User-Agent:", req.headers["user-agent"]);
    console.log("Raw Cookie Header:", req.headers.cookie);
    console.log("Parsed Cookies:", req.cookies);
    
    const token = req.cookies.token;

    if (!token) {
      console.log("❌ No authentication cookie received");
      return res.json({ success: false, message: "Not authenticated" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded:", decoded);
    console.log("=================================");

    const user = await pool.query(
      "SELECT id, email, username, role FROM users WHERE id = $1",
      [decoded.userId]
    );

    if (user.rows.length === 0) {
      return res.json({ success: false, message: "User not found" });
    }

    res.json({
      success: true,
      user: user.rows[0],
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
const crypto = require("crypto");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

exports.forgotPassword = async (req, res) => {

  try {

    const { email } = req.body;

    const user = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    // Never reveal if email exists
    if (user.rows.length === 0) {

      return res.json({
        success: true,
        message:
          "If an account exists, a reset link has been sent."
      });

    }

    const token =
      crypto.randomBytes(32).toString("hex");

    const expires =
      new Date(Date.now() + 1000 * 60 * 30); // 30 minutes

    await pool.query(
      `
      INSERT INTO password_reset_tokens
      (user_id, token, expires_at)
      VALUES ($1,$2,$3)
      `,
      [
        user.rows[0].id,
        token,
        expires
      ]
    );

    const link =
      `https://prediction-frontend-phi.vercel.app/reset-password?token=${token}`;

    await resend.emails.send({
      from: "Probability Support <support@theprobability.site>",
      to: email,
      subject: "Reset your password",

      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:30px">

          <h2>Password Reset</h2>

            <p>You requested a password reset for your Probability account.</p>
            <p>
              Click the button below to choose a new password.
            </p>

            <p style="margin:30px 0;">
              <a
                href="${link}"
                style="
                  background:#2563eb;
                  color:#fff;
                  padding:12px 24px;
                  border-radius:8px;
                  text-decoration:none;
                  display:inline-block;
                  font-weight:bold;
                "
              >
                Reset Password
              </a>
            </p>

            <p>
              Or copy this link into your browser:
            </p>

            <p>
              ${link}
            </p>

            <hr>

            <p style="color:#666;font-size:14px">
              This link expires in 30 minutes.
            </p>

            <p style="color:#666;font-size:14px">
              If you didn't request this, you can safely ignore this email.
            </p>

          </div>
        `,
        text: `
      Reset your password

      Open the following link:

      ${link}

      This link expires in 30 minutes.

      If you didn't request this reset, simply ignore this email.
        `,

        replyTo: "support@theprobability.site"
    });

    res.json({

      success:true,

      message:
      "If an account exists, a reset link has been sent."

    });

  }

  catch(err){

    console.error(err);

    res.status(500).json({
      success:false
    });

  }

};
exports.resetPassword = async (req,res)=>{

  try{

    const {
      token,
      password
    } = req.body;

    const result =
      await pool.query(
        `
        SELECT *
        FROM password_reset_tokens
        WHERE token=$1
        `,
        [token]
      );

    if(result.rows.length===0){

      return res.json({

        success:false,

        message:"Invalid token"

      });

    }

    const reset =
      result.rows[0];

    if(
      new Date(reset.expires_at)
      <
      new Date()
    ){

      return res.json({

        success:false,

        message:"Token expired"

      });

    }

    const hash =
      await bcrypt.hash(
        password,
        10
      );

    await pool.query(

      `
      UPDATE users
      SET password=$1
      WHERE id=$2
      `,

      [
        hash,
        reset.user_id
      ]

    );

    await pool.query(

      `
      DELETE
      FROM password_reset_tokens
      WHERE token=$1
      `,

      [token]

    );

    res.json({

      success:true,

      message:
      "Password updated."

    });

  }

  catch(err){

    console.error(err);

    res.status(500).json({

      success:false

    });

  }

}
