const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },

  max: 3,                 // keep LOW for Neon
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 5000,

  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// 🔥 CRITICAL: prevent crash
pool.on("error", (err) => {
  console.error("🔥 Unexpected PG Pool Error:", err);
});

module.exports = pool;