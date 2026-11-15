// prediction-backend/services/kickoffapi.js  (new file)
const BASE = "https://api.kickoffapi.com/api/v2";
const cache = new Map(); // in-memory; resets on restart

async function kickoff(path, params = {}, ttlSeconds = 300) {
  const key = process.env.KICKOFFAPI_API_KEY;
  if (!key) throw new Error("KICKOFFAPI_API_KEY is not set");

  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}${qs ? "?" + qs : ""}`;

  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data;

  // Key goes in a header, never in the URL
  const res = await fetch(url, { headers: { "x-api-key": key } });

  // Log your remaining quota to Render's logs
  const limits = {};
  res.headers.forEach((v, k) => { if (k.startsWith("x-ratelimit")) limits[k] = v; });
  console.log("KickoffAPI", res.status, path, limits);

  if (res.status === 429) throw new Error(`Rate limit hit, retry after ${res.headers.get("retry-after")}s`);
  if (res.status === 401 || res.status === 403) throw new Error(`KickoffAPI auth or plan error (${res.status})`);
  if (!res.ok) throw new Error(`KickoffAPI error ${res.status}`);

  const data = await res.json();
  cache.set(url, { data, expires: Date.now() + ttlSeconds * 1000 });
  return data;
}
function normalizeFixture(f) {
  return {
    externalId: f.id,
    provider: "kickoffapi",
    leagueId: f.league.id,
    leagueName: f.league.name,
    season: f.league.season,
    title: `${f.home.name} vs ${f.away.name}`,
    startsAt: f.date,                       // already ISO, UTC
    status: f.status.short,
    home: { id: f.home.id, name: f.home.name, logo: f.home.logo },
    away: { id: f.away.id, name: f.away.name, logo: f.away.logo },
  };
}

function settleFromScore(f) {
  const base = normalizeFixture(f);
  const s = f.status.short;

  if (["PST", "CANC", "ABD"].includes(s)) return { ...base, settleable: false, action: "VOID" };
  if (["AWD", "WO", "AET", "PEN"].includes(s)) return { ...base, settleable: false, action: "MANUAL_REVIEW" };
  if (s !== "FT" || f.score?.home == null || f.score?.away == null)
    return { ...base, settleable: false, action: "WAIT" };

  const h = f.score.home, a = f.score.away, total = h + a;
  const ht = f.score.halftime;
  const hasHT = ht && ht.home != null && ht.away != null;

  return {
    ...base,
    settleable: true,
    score: { final: { home: h, away: a }, halftime: hasHT ? ht : null },
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
      halfTimeResult: hasHT ? (ht.home > ht.away ? "HOME" : ht.home < ht.away ? "AWAY" : "DRAW") : null,
      // Only certain when one side (or neither) scored; otherwise needs events
      firstTeamToScore: total === 0 ? "NONE" : a === 0 ? "HOME" : h === 0 ? "AWAY" : null,
    },
  };
}
const OWN_GOAL_RULE = "SKIP_OWN_GOALS";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const num = (v) => {
  const n = parseFloat(String(v ?? "").replace("%", ""));
  return Number.isNaN(n) ? null : n;
};

// Events/stats/lineups use numeric team ids; map them to home/away by team name
function teamSideMap(f, stats, lineups) {
  const names = {};
  for (const s of stats) if (s.teamId != null && s.team?.name) names[s.teamId] = s.team.name;
  for (const l of lineups) if (l.teamId != null && l.team?.name) names[l.teamId] = l.team.name;
  const map = {};
  for (const [id, name] of Object.entries(names)) {
    if (norm(name) === norm(f.home.name)) map[id] = "home";
    else if (norm(name) === norm(f.away.name)) map[id] = "away";
  }
  return map;
}

function parseGoals(events) {
  return events
    .filter((e) => norm(e.type) === "goal" && !/missed|cancel|disallow/i.test(e.detail || ""))
    .sort((a, b) => (a.time - b.time) || (a.id - b.id))
    .map((e) => ({
      minute: e.time,
      teamId: e.teamId,
      playerId: e.playerId,
      player: e.playerName,
      assist: e.assistName,
      isOwn: /own/i.test(e.detail || ""),
      isPenalty: /pen/i.test(e.detail || ""),
    }));
}

// Decide which side each goal counts for, and verify against the final score
function assignSides(goals, map, final) {
  for (const interp of ["beneficiary", "scorerTeam"]) {
    const sides = goals.map((g) => {
      const s = map[g.teamId];
      if (!s) return null;
      return g.isOwn && interp === "scorerTeam" ? (s === "home" ? "away" : "home") : s;
    });
    if (sides.includes(null)) return { ok: false, reason: "TEAM_NOT_MATCHED_BY_NAME" };
    const h = sides.filter((x) => x === "home").length;
    if (h === final.home && sides.length - h === final.away) return { ok: true, sides, interp };
  }
  return { ok: false, reason: "GOALS_DONT_MATCH_SCORE" };
}

const STAT_KEYS = {
  corners: "cornerkicks", yellowCards: "yellowcards", redCards: "redcards",
  possession: "ballpossession", shots: "totalshots", shotsOnTarget: "shotsongoal", xg: "expectedgoals",
};
function teamStats(stats, teamId) {
  const out = {};
  for (const [k, typeName] of Object.entries(STAT_KEYS)) {
    const row = teamId == null ? null
      : stats.find((s) => String(s.teamId) === String(teamId) && norm(s.type) === typeName);
    out[k] = row ? num(row.value) : null;
  }
  return out;
}

function settleFromDetails(f, ev, st, lu) {
  const base = settleFromScore(f);
  if (!base.settleable) return base;

  const events = ev?.data || [], stats = st?.data || [], lineups = lu?.data || [];
  const reasons = [];
  if (ev?.error) reasons.push("EVENTS_UNAVAILABLE");
  if (st?.error) reasons.push("STATISTICS_UNAVAILABLE");
  if (lu?.error) reasons.push("LINEUPS_UNAVAILABLE");

  const map = teamSideMap(f, stats, lineups);
  const goals = parseGoals(events);
  const assigned = assignSides(goals, map, base.score.final);
  if (!assigned.ok) reasons.push(assigned.reason);

  const timeline = assigned.ok ? goals.map((g, i) => ({ ...g, side: assigned.sides[i] })) : null;
  const first = timeline?.[0] || null;
  const last = timeline?.length ? timeline[timeline.length - 1] : null;
  const nonOwn = (timeline || []).filter((g) => !g.isOwn);
  const pick = (g) => g && ({ player: g.player, playerId: g.playerId, minute: g.minute,
    side: g.side, penalty: g.isPenalty, ownGoal: g.isOwn });

  let firstScorer = null;
  if (first) firstScorer = !first.isOwn ? pick(first)
    : OWN_GOAL_RULE === "SKIP_OWN_GOALS" ? pick(nonOwn[0]) : null;

  const byPlayer = {};
  for (const g of nonOwn) {
    const k = g.playerId ?? g.player;
    byPlayer[k] = { player: g.player, playerId: g.playerId, goals: (byPlayer[k]?.goals || 0) + 1 };
  }
  const scorers = Object.values(byPlayer);

  // Who actually played: starters plus players who came on (assistId on subst events)
  const played = new Set();
  for (const l of lineups) for (const p of l.startXI || []) if (p.player?.id != null) played.add(p.player.id);
  for (const e of events) if (norm(e.type) === "subst" && e.assistId != null) played.add(e.assistId);

  const homeId = Object.keys(map).find((k) => map[k] === "home");
  const awayId = Object.keys(map).find((k) => map[k] === "away");
  const hs = teamStats(stats, homeId), as = teamStats(stats, awayId);
  const sum = (a, b) => (a == null || b == null ? null : a + b);

  const ht = base.score.halftime;
  const fh = ht ? ht.home + ht.away : null;
  const sh = ht ? base.markets.totalGoals - fh : null;

  return {
    ...base,
    dataQuality: {
      hasEvents: events.length > 0,
      hasStats: stats.length > 0 && !!homeId && !!awayId,
      hasLineups: lineups.length > 0,
      goalsMatchScore: assigned.ok,
      ownGoalCreditedTo: assigned.interp ?? null,
      reasons,
      needsReviewForGoalMarkets: !assigned.ok,
    },
    goals: timeline,
    playersWhoPlayed: [...played],
    markets: {
      ...base.markets,
      halfTimeFullTime: ht ? `${base.markets.halfTimeResult}/${base.markets.matchWinner}` : null,
      firstHalfGoals: fh,
      secondHalfGoals: sh,
      highestScoringHalf: ht ? (fh > sh ? "FIRST" : fh < sh ? "SECOND" : "EQUAL") : null,
      ...(assigned.ok ? {
        firstTeamToScore: first ? first.side.toUpperCase() : "NONE",
        firstGoal: pick(first),
        firstGoalWasOwnGoal: first ? first.isOwn : false,
        firstScorer,
        lastTeamToScore: last ? last.side.toUpperCase() : "NONE",
        lastGoal: pick(last),
        anytimeScorers: scorers,
        braceScorers: scorers.filter((s) => s.goals >= 2),
        hatTrickScorers: scorers.filter((s) => s.goals >= 3),
        penaltiesScored: timeline.filter((g) => g.isPenalty && !g.isOwn).length,
        ownGoals: timeline.filter((g) => g.isOwn).length,
        missedPenalties: events.filter((e) => norm(e.type) === "goal" && /missed/i.test(e.detail || "")).length,
      } : {}),
      teamStats: { home: hs, away: as },
      cornersTotal: sum(hs.corners, as.corners),
      yellowCardsTotal: sum(hs.yellowCards, as.yellowCards),
      redCardsTotal: sum(hs.redCards, as.redCards),
    },
  };
}

// 3 requests per match (4 if you don't pass the fixture you already have)
async function fetchSettlement(id, listFixture) {
  const soft = (p) => p.catch((e) => ({ data: [], error: e.message }));
  const f = listFixture || (await kickoff(`/fixtures/${id}`, {}, 300)).data;
  const [ev, st, lu] = await Promise.all([
    soft(kickoff(`/fixtures/${id}/events`, {}, 300)),
    soft(kickoff(`/fixtures/${id}/statistics`, {}, 300)),
    soft(kickoff(`/fixtures/${id}/lineups`, {}, 300)),
  ]);
  return settleFromDetails(f, ev, st, lu);
}
module.exports = { kickoff, normalizeFixture, settleFromScore, settleFromDetails, fetchSettlement };
