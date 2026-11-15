// prediction-backend/routes/sportmonks.js  (new file)
const express = require("express");
const router = express.Router();
const { sportmonks, normalizeFixture, buildSettlement, SETTLEMENT_INCLUDES } = require("../services/sportmonks");

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
router.get("/fixtures/clean", async (req, res) => {
  try {
    const day = (offset) =>
      new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
    const data = await sportmonks(
      `/fixtures/between/${day(0)}/${day(7)}`,
      { include: "participants;scores;state;league" }
    );
    res.json(data.data.map(normalizeFixture));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Raw data for one match, to check what your plan returns
router.get("/fixtures/:id/raw", async (req, res) => {
  try {
    const data = await sportmonks(`/fixtures/${req.params.id}`, { include: SETTLEMENT_INCLUDES }, 60);
    res.json(data.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settlement results for matches in the last 3 days (one API call for all)
router.get("/results", async (req, res) => {
  try {
    const day = (offset) =>
      new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
    const data = await sportmonks(
      `/fixtures/between/${day(-3)}/${day(0)}`,
      { include: SETTLEMENT_INCLUDES },
      60
    );
    res.json(data.data.map(buildSettlement));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;
