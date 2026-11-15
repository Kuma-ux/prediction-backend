// prediction-backend/services/sportmonks.js  (new file)
const BASE = "https://api.sportmonks.com/v3/football";
const cache = new Map(); // in-memory; resets on restart, fine for now

async function sportmonks(path, params = {}, ttlSeconds = 300) {
  const token = process.env.SPORTMONKS_TOKEN;
  if (!token) throw new Error("SPORTMONKS_TOKEN is not set");

  const qs = new URLSearchParams({ api_token: token, ...params }).toString();
  const url = `${BASE}${path}?${qs}`;

  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data;

  const res = await fetch(url); // needs Node 18+
  if (res.status === 403) throw new Error("Not available on your plan");
  if (res.status === 429) throw new Error("Sportmonks rate limit hit");
  if (!res.ok) throw new Error(`Sportmonks error ${res.status}`);

  const data = await res.json();
  console.log("Sportmonks calls remaining:", data.rate_limit?.remaining);
  cache.set(url, { data, expires: Date.now() + ttlSeconds * 1000 });
  return data;
}
function normalizeFixture(f) {
  const home = f.participants.find((p) => p.meta?.location === "home");
  const away = f.participants.find((p) => p.meta?.location === "away");

  return {
    externalId: f.id,                       // store this to find the fixture again
    leagueId: f.league_id,
    leagueName: f.league?.name,
    title: `${home.name} vs ${away.name}`,
    startsAt: new Date(f.starting_at.replace(" ", "T") + "Z").toISOString(),
    status: f.state?.developer_name,        // "NS" = not started, "FT" = full time
    home: { id: home.id, name: home.name, logo: home.image_path },
    away: { id: away.id, name: away.name, logo: away.image_path },
  };
}
const SETTLEMENT_INCLUDES = "participants;scores;state;league;events.type;statistics.type";
const FINISHED = ["FT", "AET", "FT_PEN"];
const VOIDED = ["POSTPONED", "CANCELLED", "ABANDONED"];

const evType = (e) => e.type?.developer_name || "";

function getScore(scores = [], description) {
  const home = scores.find((s) => s.description === description && s.score?.participant === "home");
  const away = scores.find((s) => s.description === description && s.score?.participant === "away");
  return home && away ? { home: home.score.goals, away: away.score.goals } : null;
}

// "1-0" after the first goal means home scored it; "0-1" means away.
// This stays correct for own goals, where the team on the event can be ambiguous.
function sideFromResult(result) {
  const m = /^(\d+)-(\d+)$/.exec((result || "").trim());
  if (!m) return null;
  return Number(m[1]) > 0 ? "home" : "away";
}

function buildSettlement(f) {
  const home = f.participants.find((p) => p.meta?.location === "home");
  const away = f.participants.find((p) => p.meta?.location === "away");
  const state = f.state?.developer_name;
  const events = f.events || [];

  const final = getScore(f.scores, "CURRENT");
  const halfTime = getScore(f.scores, "1ST_HALF");

  const goals = events
    .filter((e) => ["GOAL", "PENALTY", "OWNGOAL"].includes(evType(e)))
    .sort((a, b) =>
      (a.minute - b.minute) ||
      ((a.extra_minute || 0) - (b.extra_minute || 0)) ||
      ((a.sort_order || 0) - (b.sort_order || 0)))
    .map((e) => ({
      minute: e.minute,
      extraMinute: e.extra_minute,
      player: e.player_name,
      playerId: e.player_id,
      teamId: e.participant_id,
      type: evType(e),            // GOAL, PENALTY, OWNGOAL
      runningScore: e.result,
    }));

  const cards = (name, teamId) =>
    events.filter((e) => evType(e) === name && e.participant_id === teamId).length;

  const stat = (name, location) =>
    (f.statistics || []).find((s) => s.type?.developer_name === name && s.location === location)
      ?.data?.value ?? null;

  const base = {
    externalId: f.id,
    title: `${home.name} vs ${away.name}`,
    startsAt: new Date(f.starting_at.replace(" ", "T") + "Z").toISOString(),
    state,
    finished: FINISHED.includes(state),
    voided: VOIDED.includes(state),
    home: { id: home.id, name: home.name },
    away: { id: away.id, name: away.name },
  };

  // Not ready to settle: return early so you never settle on partial data
  if (!base.finished || !final) return { ...base, settleable: false };

  const h = final.home, a = final.away, total = h + a;
  const first = goals[0] || null;
  const firstSide = first ? sideFromResult(first.runningScore) : null;

  return {
    ...base,
    settleable: true,
    score: { final, halfTime },
    // Sanity check: score from scores include vs goal events
    scoreMatchesEvents: goals.length === total,
    goals,
    markets: {
      matchWinner: h > a ? "HOME" : h < a ? "AWAY" : "DRAW",
      doubleChance: { homeOrDraw: h >= a, awayOrDraw: a >= h, homeOrAway: h !== a },
      drawNoBet: h === a ? "VOID" : h > a ? "HOME" : "AWAY",
      bothTeamsToScore: h > 0 && a > 0,
      totalGoals: total,
      over: { "0.5": total > 0, "1.5": total > 1, "2.5": total > 2, "3.5": total > 3, "4.5": total > 4 },
      correctScore: `${h}-${a}`,
      winningMargin: Math.abs(h - a),
      cleanSheet: { home: a === 0, away: h === 0 },
      halfTimeResult: halfTime
        ? (halfTime.home > halfTime.away ? "HOME" : halfTime.home < halfTime.away ? "AWAY" : "DRAW")
        : null,
      firstTeamToScore: first ? firstSide?.toUpperCase() : "NONE",
      firstScorer: first && first.type !== "OWNGOAL" ? { player: first.player, playerId: first.playerId } : null,
      firstGoalWasOwnGoal: first ? first.type === "OWNGOAL" : false,
      anytimeScorers: [...new Set(goals.filter((g) => g.type !== "OWNGOAL").map((g) => g.player))],
      penaltyAwarded: events.some((e) => ["PENALTY", "MISSED_PENALTY"].includes(evType(e))),
      ownGoalScored: goals.some((g) => g.type === "OWNGOAL"),
      cards: {
        yellow: { home: cards("YELLOWCARD", home.id), away: cards("YELLOWCARD", away.id) },
        red: {
          home: cards("REDCARD", home.id) + cards("YELLOWREDCARD", home.id),
          away: cards("REDCARD", away.id) + cards("YELLOWREDCARD", away.id),
        },
      },
      corners: { home: stat("CORNERS", "home"), away: stat("CORNERS", "away") },
    },
  };
}
module.exports = { sportmonks, normalizeFixture, buildSettlement, SETTLEMENT_INCLUDES };
