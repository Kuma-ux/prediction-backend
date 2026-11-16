// prediction-backend/services/marketTemplates.js  (new file)

// ---------- CONFIG: edit these ----------
// Competitions to automate. detailed:true means events/statistics have been
// verified for that competition, which unlocks the Tier 2 markets.
const LEAGUES = {
  "lg_2093b2358c6dd532": { name: "CONCACAF Nations League", detailed: true },
  "lg_83d5ddf4dfef1a5b": { name: "Friendlies", detailed: false },
};
const CATEGORY = "sports";    // use the category text your site uses for sports
const LIQUIDITY_B = 50;       // same default as your admin form
const MIN_MINUTES_AFTER_KICKOFF = 135;  // never resolve earlier than this
const POSTPONED_REFUND_AFTER_DAYS = 3;  // refund if still postponed after this
const STALE_REVIEW_AFTER_DAYS = 3;      // anything unfinished after this goes to manual review
const OU_LINES = [1.5, 2.5, 3.5];
const CORNERS_LINE = 9.5;

const COMMON_RULES =
  "Only the regular 90 minutes plus stoppage time count. Extra time and penalty shootouts are ignored. " +
  "If the match is postponed for more than " + POSTPONED_REFUND_AFTER_DAYS + " days, cancelled or abandoned, " +
  "the market is shut down and all stakes are refunded.";

function teamNames(f) {
  let home = f.home.name, away = f.away.name;
  if (home === away) { home += " (Home)"; away += " (Away)"; } // options must be unique
  return { home, away };
}
const vs = (f) => `${f.home.name} vs ${f.away.name}`;

// Each template: key, tier, title(f), options(f) -> { KEY: "Option text" },
// rules(f), outcome(settlement) -> KEY or null (null = needs manual review)
const TEMPLATES = [
  {
    key: "match_result", tier: 1,
    title: (f) => `${vs(f)}: Who wins?`,
    options: (f) => { const t = teamNames(f); return { HOME: t.home, DRAW: "Draw", AWAY: t.away }; },
    rules: () => `Resolves to the team ahead at full time, or Draw. ${COMMON_RULES}`,
    outcome: (s) => s.markets.matchWinner,
  },
  {
    key: "btts", tier: 1,
    title: (f) => `${vs(f)}: Will both teams score?`,
    options: () => ({ YES: "Yes", NO: "No" }),
    rules: () => `Resolves Yes if both teams score at least one goal (own goals count for the team they benefit). ${COMMON_RULES}`,
    outcome: (s) => (s.markets.bothTeamsToScore ? "YES" : "NO"),
  },
  ...OU_LINES.map((line) => ({
    key: `over_${line}`, tier: 1,
    title: (f) => `${vs(f)}: Over or under ${line} total goals?`,
    options: () => ({ OVER: "Over", UNDER: "Under" }),
    rules: () => `Resolves Over if the total goals scored by both teams is more than ${line}, otherwise Under. ${COMMON_RULES}`,
    outcome: (s) => (s.markets.totalGoals > line ? "OVER" : "UNDER"),
  })),
  {
    key: "first_team_to_score", tier: 2,
    title: (f) => `${vs(f)}: Which team scores first?`,
    options: (f) => { const t = teamNames(f); return { HOME: t.home, AWAY: t.away, NONE: "No goal" }; },
    rules: () => `Resolves to the team that scores the first goal. An own goal counts for the team it benefits. Resolves No goal if the match ends 0-0. ${COMMON_RULES}`,
    outcome: (s) => s.markets.firstTeamToScore ?? null,
  },
  {
    key: `corners_${CORNERS_LINE}`, tier: 2,
    title: (f) => `${vs(f)}: Over or under ${CORNERS_LINE} total corners?`,
    options: () => ({ OVER: "Over", UNDER: "Under" }),
    rules: () => `Resolves Over if the total corners for both teams is more than ${CORNERS_LINE}, otherwise Under. ${COMMON_RULES}`,
    outcome: (s) => (s.markets.cornersTotal == null ? null : s.markets.cornersTotal > CORNERS_LINE ? "OVER" : "UNDER"),
  },
  {
    key: "red_card", tier: 2,
    title: (f) => `${vs(f)}: Will there be a red card?`,
    options: () => ({ YES: "Yes", NO: "No" }),
    rules: () => `Resolves Yes if at least one red card (including a second yellow) is shown. ${COMMON_RULES}`,
    outcome: (s) => (s.markets.redCardsTotal == null ? null : s.markets.redCardsTotal > 0 ? "YES" : "NO"),
  },
];

// Event payload, shaped like your /admin/create-event body
function buildEventPayload(f) {
  const start = new Date(f.startsAt);
  const end = new Date(start.getTime() + 150 * 60000); // kickoff + 2h30
  return {
    title: vs(f),
    category: CATEGORY,
    description: `${f.leagueName}${f.season ? " " + f.season : ""} | Kickoff ${start.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    start_date: start.toISOString(),
    end_date: end.toISOString(),
    image: f.home.logo || "",
    featured: false,
    stream_url: "",
  };
}

// Market payloads, shaped like your /admin/create-market body
function buildMarketPayloads(f, eventId = null) {
  const detailed = !!LEAGUES[f.leagueId]?.detailed;
  return TEMPLATES
    .filter((t) => t.tier === 1 || detailed)
    .map((t) => {
      const optionMap = t.options(f);
      return {
        templateKey: t.key,
        optionMap, // store this with the market: KEY -> exact option text
        payload: {
          title: t.title(f),
          description: `${f.leagueName}: ${vs(f)}`,
          rules: t.rules(f),
          category: CATEGORY,
          b: LIQUIDITY_B,
          market_type: "standard",
          bundle_predictions: [],
          options: Object.values(optionMap),
          end_date: new Date(f.startsAt).toISOString(), // betting closes at kickoff (see question 1 below)
          event_id: eventId,
          featured: false,
          is_live: false,
          stream_url: "",
          live_duration_minutes: 5,
        },
      };
    });
}

// Decide what to do with ONE market once we have a settlement object
// (from settleFromScore for Tier 1, from fetchSettlement for Tier 2)
function decideResolution(templateKey, optionMap, s, now = Date.now()) {
  const tpl = TEMPLATES.find((t) => t.key === templateKey);
  if (!tpl) return { action: "MANUAL", reason: "UNKNOWN_TEMPLATE" };

  const ageMin = (now - new Date(s.startsAt).getTime()) / 60000;
  const ageDays = ageMin / 1440;

  if (s.action === "VOID") {
    if (s.status === "PST" && ageDays < POSTPONED_REFUND_AFTER_DAYS) return { action: "WAIT", reason: "POSTPONED" };
    return { action: "SHUTDOWN", reason: `STATUS_${s.status}` };
  }
  if (s.action === "MANUAL_REVIEW") return { action: "MANUAL", reason: `STATUS_${s.status}` };

  if (!s.settleable) {
    if (ageDays > STALE_REVIEW_AFTER_DAYS) return { action: "MANUAL", reason: `STALE_STATUS_${s.status}` };
    return { action: "WAIT", reason: `STATUS_${s.status}` };
  }
  if (ageMin < MIN_MINUTES_AFTER_KICKOFF) return { action: "WAIT", reason: "TOO_EARLY" };

  const key = tpl.outcome(s);
  if (key == null || !optionMap[key]) return { action: "MANUAL", reason: "NO_RELIABLE_DATA" };
  return { action: "RESOLVE", outcomes: [optionMap[key]], key };
}

module.exports = { LEAGUES, TEMPLATES, MIN_MINUTES_AFTER_KICKOFF, buildEventPayload, buildMarketPayloads, decideResolution };
