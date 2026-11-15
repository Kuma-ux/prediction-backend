// prediction-backend/routes/sportmonks.js  (new file)
const express = require("express");
const router = express.Router();
const { sportmonks } = require("../services/sportmonks");

router.get("/fixtures", async (req, res) => {
  try {
    const day = (offset) =>
      new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

    const data = await sportmonks(
      `/fixtures/between/${day(0)}/${day(7)}`,
      { include: "participants;scores;state;league" }
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
