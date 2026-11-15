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

module.exports = { sportmonks };
