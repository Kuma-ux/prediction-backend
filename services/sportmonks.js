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
module.exports = { sportmonks, normalizeFixture };
