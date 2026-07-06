const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const protectedRoutes = require("./routes/protected");
const rateLimit = require("express-rate-limit");
const paystackRoutes = require("./routes/paystack");
const walletRoutes = require("./routes/wallet");
const marketRoutes = require("./routes/markets");
const tradeRoutes = require("./routes/trades");
const adminMarkets = require("./routes/adminMarkets");
const adminRoutes = require("./routes/admin");
const historyRoutes = require("./routes/history");
const listingRoutes = require("./routes/listings");
const portfolioRoutes = require("./routes/portfolio");
const profileRoutes = require("./routes/profile");
const userRoutes = require("./routes/users");
const creatorRoutes = require("./routes/creator");
const supportRoutes = require("./routes/support");
const multer = require("multer");

require("dotenv").config();

const authRoutes = require("./routes/auth");

const app = express();
app.set("trust proxy", 1);

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
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

//
// 🔐 SECURITY: CORS
//
const allowedOrigins = [
  "http://localhost:3000",
  "https://prediction-frontend.vercel.app",
  "https://prediction-frontend-phi.vercel.app",
];
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log("Blocked origin:", origin);

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

//
// 🔐 PARSERS MUST COME BEFORE ROUTES
//
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(cookieParser());

//
// 🧱 RATE LIMIT
//
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
});

app.use(limiter);

process.on("uncaughtException", (err) => {
  console.error("🔥 Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("🔥 Unhandled Rejection:", err);
});

//
// ROUTES
//
const path = require("path");

app.use(
  "/uploads",
  express.static(
    path.join(__dirname, "uploads")
  )
);
app.use("/paystack", paystackRoutes);
app.use("/auth", authRoutes);
app.use("/api", protectedRoutes);
app.use("/wallet", walletRoutes);
app.use("/markets", marketRoutes);
app.use("/trades", tradeRoutes);
app.use("/admin/markets", adminMarkets);
app.use("/admin", adminRoutes);
app.use("/listings", listingRoutes);
app.use("/history", historyRoutes);
app.use("/portfolio", portfolioRoutes);
app.use("/profile", profileRoutes);
app.use("/users", userRoutes);
app.use("/creator", creatorRoutes);
app.use("/support", supportRoutes);

app.get("/", (req, res) => {
  res.send("Probability Backend Running 🚀");
});

const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "https://prediction-frontend-phi.vercel.app",
    ],
    credentials: true,
  },
});

app.set("io", io);

io.on("connection", (socket) => {

  console.log("User connected:", socket.id);

  socket.on("join_market", (marketId) => {

    socket.join(`market_${marketId}`);

    console.log(
      `${socket.id} joined market_${marketId}`
    );
  });

  socket.on("leave_market", (marketId) => {

    socket.leave(`market_${marketId}`);
  });

  socket.on("disconnect", () => {

    console.log(
      "Disconnected:",
      socket.id
    );
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});
