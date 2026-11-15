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

module.exports = { kickoff };
