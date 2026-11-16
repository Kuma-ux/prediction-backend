// prediction-backend/services/autoMarkets.js  (new file)
const pool = require("../db");
const { kickoff, normalizeFixture, settleFromScore, settleFromDetails } = require("./kickoffapi");
const {
  LEAGUES, TEMPLATES, MIN_MINUTES_AFTER_KICKOFF,
  buildEventPayload, buildMarketPayloads, decideResolution,
} = require("./marketTemplates");

// AUTO_MARKETS_MODE: off (default) | dry (log only, writes nothing) | live (creates events/markets)
const MODE = (process.env.AUTO_MARKETS_MODE || "off").toLowerCase();
const HORIZON_DAYS = 3;                  // create events up to 3 days ahead
const MIN_LEAD_MINUTES = 20;             // skip matches starting sooner than this
const MAX_NEW_FIXTURES_PER_RUN = 10;     // caps your exposure while you test
const MAX_FIXTURES_CHECKED_PER_RUN = 8;
const DAILY_REQUEST_BUDGET = 80;         // free plan is 100/day; leaves room for manual tests
const IMPORT_EVERY_MS = 6 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 10 * 60 * 1000;
const log = (...a) => console.log("[auto]", ...a);

// ---- request budget (resets at UTC midnight, or on restart) ----
let spent = 0, spentDay = new Date().toISOString().slice(0, 10);
async function api(path, params, ttl) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== spentDay) { spentDay = today; spent = 0; }
  if (spent >= DAILY_REQUEST_BUDGET) throw new Error("DAILY_BUDGET_REACHED");
  spent++;
  return kickoff(path, params, ttl);
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fixture_events (
      fixture_id TEXT PRIMARY KEY,
      event_id   INTEGER NOT NULL,
      league_id  TEXT NOT NULL,
      title      TEXT NOT NULL,
      kickoff    TIMESTAMPTZ NOT NULL,
      next_check TIMESTAMPTZ,
      attempts   INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fixture_markets (
      id                 SERIAL PRIMARY KEY,
      fixture_id         TEXT NOT NULL REFERENCES fixture_events(fixture_id),
      template_key       TEXT NOT NULL,
      market_id          INTEGER NOT NULL,
      option_map         JSONB NOT NULL,
      status             TEXT NOT NULL DEFAULT 'open',
      suggestion_action  TEXT,
      suggested_outcomes JSONB,
      suggestion_reason  TEXT,
      suggestion_data    JSONB,
      suggested_at       TIMESTAMPTZ,
      UNIQUE (fixture_id, template_key)
    )`);
}

// ================= CREATE EVENTS + MARKETS =================
async function ensureFixture(f) {
  const link = await pool.query("SELECT event_id FROM fixture_events WHERE fixture_id = $1", [f.externalId]);
  const known = link.rows.length > 0;
  const eventId = known ? link.rows[0].event_id : null;

  if (known) {
    const stillThere = await pool.query("SELECT 1 FROM events WHERE id = $1", [eventId]);
    if (!stillThere.rows.length) return 0; // you deleted this event on purpose; don't recreate it
  }
  const have = known
    ? (await pool.query("SELECT template_key FROM fixture_markets WHERE fixture_id = $1", [f.externalId]))
        .rows.map((r) => r.template_key)
    : [];
  const missing = buildMarketPayloads(f).filter((m) => !have.includes(m.templateKey));
  if (known && missing.length === 0) return 0;

  if (MODE === "dry") {
    log(`[dry] would ${known ? "add markets to" : "create"} event "${f.title}" (${f.leagueName}):`,
      missing.map((m) => m.templateKey).join(", "));
    return 1;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let evId = eventId;
    if (!known) {
      const e = buildEventPayload(f);
      const r = await client.query(
        `INSERT INTO events (title, category, description, start_date, end_date, image, stream_url, featured)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [e.title, e.category, e.description, e.start_date, e.end_date, e.image || null, e.stream_url || null, e.featured]
      );
      evId = r.rows[0].id;
      await client.query(
        `INSERT INTO fixture_events (fixture_id, event_id, league_id, title, kickoff) VALUES ($1,$2,$3,$4,$5)`,
        [f.externalId, evId, f.leagueId, e.title, f.startsAt]
      );
    }
    for (const m of missing) {
      const p = m.payload;
      const r = await client.query(
        `INSERT INTO markets
           (title, description, rules, category, b, end_date, resolved, market_type,
            bundle_predictions, featured, stream_url, is_live, live_duration_minutes, event_id)
         VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [p.title, p.description, p.rules, p.category, Number(p.b), p.end_date, p.market_type,
         JSON.stringify(p.bundle_predictions), p.featured, p.stream_url || null,
         p.is_live, p.live_duration_minutes, evId]
      );
      const marketId = r.rows[0].id;
      for (const option of p.options) {
        await client.query(
          `INSERT INTO market_outcomes (market_id, outcome, pool) VALUES ($1,$2,0)`,
          [marketId, option]
        );
      }
      await client.query(
        `INSERT INTO fixture_markets (fixture_id, template_key, market_id, option_map) VALUES ($1,$2,$3,$4)`,
        [f.externalId, m.templateKey, marketId, JSON.stringify(m.optionMap)]
      );
    }
    await client.query("COMMIT");
    log(`${known ? "added markets to" : "created"} event "${f.title}": ${missing.length} markets`);
    return 1;
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") log(`skipped "${f.title}" (already created)`);
    else console.error("[auto] create failed for", f.title, err.message);
    return 0;
  } finally {
    client.release();
  }
}

async function importUpcoming() {
  const now = Date.now();
  const horizon = now + HORIZON_DAYS * 864e5;
  let touched = 0;

  for (const leagueId of Object.keys(LEAGUES)) {
    let rows = [];
    try {
      const data = await api("/fixtures", { league: leagueId, limit: "100" }, 600);
      rows = data.data || [];
      if (rows.some((f) => f.league.id !== leagueId)) {
        console.warn("[auto] WARNING: API ignored the league filter for", leagueId);
      }
    } catch (e) {
      console.error("[auto] fixtures fetch failed for", leagueId, e.message);
      continue;
    }
    const upcoming = rows
      .filter((f) => f.league.id === leagueId && f.status.short === "NS")
      .map(normalizeFixture)
      .filter((f) => {
        const t = new Date(f.startsAt).getTime();
        return t > now + MIN_LEAD_MINUTES * 60000 && t < horizon;
      });
    for (const f of upcoming) {
      if (touched >= MAX_NEW_FIXTURES_PER_RUN) return;
      touched += await ensureFixture(f);
    }
  }
}

// ================= SUGGEST OUTCOMES FOR FINISHED MATCHES =================
function snapshot(s) {
  return {
    fetchedAt: new Date().toISOString(),
    status: s.status, action: s.action || null,
    score: s.score || null, markets: s.markets || null,
    goals: s.goals || null, dataQuality: s.dataQuality || null,
  };
}

async function checkFixture(fixtureId, attempts) {
  const open = (await pool.query(
    `SELECT id, template_key, option_map FROM fixture_markets WHERE fixture_id = $1 AND status = 'open'`,
    [fixtureId]
  )).rows;
  if (!open.length) return;

  const raw = (await api(`/fixtures/${fixtureId}`, {}, 60)).data;
  const s1 = settleFromScore(raw);

  const isTier2 = (key) => TEMPLATES.find((t) => t.key === key)?.tier === 2;
  let s2 = null;
  if (s1.settleable && open.some((m) => isTier2(m.template_key))) {
    const soft = (p) => p.catch((e) => ({ data: [], error: e.message }));
    const [ev, st] = await Promise.all([
      soft(api(`/fixtures/${fixtureId}/events`, {}, 60)),
      soft(api(`/fixtures/${fixtureId}/statistics`, {}, 60)),
    ]);
    if ([ev, st].some((x) => x.error === "DAILY_BUDGET_REACHED")) throw new Error("DAILY_BUDGET_REACHED");
    if ([ev, st].some((x) => x.error) && attempts < 2) { // retry transient failures before giving up
      await pool.query(
        `UPDATE fixture_events SET attempts = attempts + 1, next_check = NOW() + INTERVAL '30 minutes' WHERE fixture_id = $1`,
        [fixtureId]
      );
      return;
    }
    s2 = settleFromDetails(raw, ev, st, { data: [] });
  }

  let nextDelayMin = null;
  for (const m of open) {
    const s = isTier2(m.template_key) && s2 ? s2 : s1;
    const d = decideResolution(m.template_key, m.option_map, s);
    if (d.action === "WAIT") {
      nextDelayMin = Math.min(nextDelayMin ?? Infinity, d.reason === "POSTPONED" ? 360 : 15);
      continue;
    }
    await pool.query(
      `UPDATE fixture_markets
         SET status = 'suggested', suggestion_action = $2, suggested_outcomes = $3,
             suggestion_reason = $4, suggestion_data = $5, suggested_at = NOW()
       WHERE id = $1 AND status = 'open'`,
      [m.id, d.action, d.outcomes ? JSON.stringify(d.outcomes) : null,
       d.reason || d.key || null, JSON.stringify(snapshot(s))]
    );
    log(`suggestion for market ${m.id} (${m.template_key}): ${d.action}`, d.outcomes || d.reason || "");
  }
  if (nextDelayMin != null) {
    await pool.query(
      `UPDATE fixture_events SET next_check = NOW() + make_interval(mins => $2::int) WHERE fixture_id = $1`,
      [fixtureId, nextDelayMin]
    );
  }
}

async function checkFinished() {
  // Markets you resolved, shut down or deleted by hand: stop tracking them
  await pool.query(`
    UPDATE fixture_markets fm SET status = 'done'
    FROM markets m
    WHERE m.id = fm.market_id AND fm.status IN ('open','suggested')
      AND (m.resolved = true OR m.shutdown = true)`);
  await pool.query(`
    UPDATE fixture_markets fm SET status = 'removed'
    WHERE fm.status IN ('open','suggested')
      AND NOT EXISTS (SELECT 1 FROM markets m WHERE m.id = fm.market_id)`);

  const due = await pool.query(`
    SELECT fe.fixture_id, fe.attempts
    FROM fixture_events fe
    WHERE EXISTS (SELECT 1 FROM fixture_markets fm WHERE fm.fixture_id = fe.fixture_id AND fm.status = 'open')
      AND fe.kickoff <= NOW() - make_interval(mins => $1::int)
      AND (fe.next_check IS NULL OR fe.next_check <= NOW())
    ORDER BY fe.kickoff ASC LIMIT $2`,
    [MIN_MINUTES_AFTER_KICKOFF, MAX_FIXTURES_CHECKED_PER_RUN]
  );
  for (const row of due.rows) {
    try {
      await checkFixture(row.fixture_id, row.attempts);
    } catch (err) {
      if (err.message === "DAILY_BUDGET_REACHED") { log("daily request budget reached, pausing checks"); return; }
      console.error("[auto] check failed for", row.fixture_id, err.message);
      await pool.query(
        `UPDATE fixture_events SET next_check = NOW() + INTERVAL '30 minutes' WHERE fixture_id = $1`,
        [row.fixture_id]
      );
    }
  }
}

// ================= SCHEDULER =================
let importing = false, checking = false;
function start() {
  if (MODE === "off") { log("AUTO_MARKETS_MODE=off, automation disabled"); return; }
  log(`automation mode: ${MODE}`);

  const runImport = async () => {
    if (importing) return;
    importing = true;
    try { await ensureTables(); await importUpcoming(); }
    catch (e) { console.error("[auto] import run failed:", e.message); }
    finally { importing = false; }
  };
  const runCheck = async () => {
    if (checking || MODE !== "live") return;
    checking = true;
    try { await ensureTables(); await checkFinished(); }
    catch (e) { console.error("[auto] check run failed:", e.message); }
    finally { checking = false; }
  };
  // Timers restart with the process, and the logic is time-based, so a restart just catches up.
  setTimeout(runImport, 20 * 1000);
  setInterval(runImport, IMPORT_EVERY_MS);
  setTimeout(runCheck, 60 * 1000);
  setInterval(runCheck, CHECK_EVERY_MS);
}

const getStatus = () => ({ mode: MODE, requestsSpentToday: spent, dailyBudget: DAILY_REQUEST_BUDGET });
module.exports = { start, getStatus, ensureTables };
