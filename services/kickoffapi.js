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
module.exports = { kickoff, normalizeFixture, settleFromScore };
