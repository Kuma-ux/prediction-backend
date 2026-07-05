const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");

// Example protected route
router.get("/me", auth, (req, res) => {
  res.json({
    success: true,
    message: "You are authenticated",
    user: req.user,
  });
});

module.exports = router;