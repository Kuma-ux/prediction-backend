// services/marketEngine.js

function safeNumber(x, fallback = 0) {
  const n = Number(x);
  return isNaN(n) ? fallback : n;
}

// Log-Sum-Exp implementation preventing Infinity overflow
function costFunction(outcomes, b = 50) {
  const pools = outcomes.map(o => safeNumber(o.pool) / b);
  const max = Math.max(...pools);

  return (
    b *
    (max +
      Math.log(
        pools.reduce((sum, p) => sum + Math.exp(p - max), 0)
      ))
  );
}

function getOdds(market) {
  const b = Number(market.b || 50);
  const pools = market.outcomes.map(o => safeNumber(o.pool) / b);
  const max = Math.max(...pools);

  const exps = market.outcomes.map((o, i) => ({
    outcome: o.outcome,
    value: Math.exp(pools[i] - max),
  }));

  const total = exps.reduce((sum, o) => sum + o.value, 0);
  const odds = {};

  for (const e of exps) {
    odds[e.outcome] = total <= 0 ? 0 : Number((e.value / total).toFixed(4));
  }

  return odds;
}

function buyOutcome(market, selectedOutcome, amount) {
  amount = safeNumber(amount);
  const b = Number(market.b || 50);

  if (amount <= 0) {
    throw new Error("Invalid amount");
  }

  const normalized = market.outcomes.map(o => ({
    outcome: o.outcome,
    pool: Math.max(0, safeNumber(o.pool)),
  }));

  const exists = normalized.some(o => o.outcome === selectedOutcome);
  if (!exists) {
    throw new Error("Outcome not found");
  }

  // Calculate Cost BEFORE trade
  const before = costFunction(normalized, b);

  // Create an entirely new state for AFTER trade without mutating old records
  const updatedOutcomes = normalized.map(o => ({
    ...o,
    pool: o.outcome === selectedOutcome ? o.pool + amount : o.pool
  }));

  // Calculate Cost AFTER trade
  const after = costFunction(updatedOutcomes, b);
  const cost = Math.max(0, after - before);

  const updatedMarket = {
    ...market,
    outcomes: updatedOutcomes,
  };

  return {
    market: updatedMarket,
    cost: Number(cost.toFixed(6)),
    odds: getOdds(updatedMarket),
  };
}
function sellOutcome(market, selectedOutcome, amount) {
  amount = safeNumber(amount);

  const b = Number(market.b || 50);

  if (amount <= 0) {
    throw new Error("Invalid amount");
  }

  const normalized = market.outcomes.map(o => ({
    outcome: o.outcome,
    pool: Math.max(0, safeNumber(o.pool)),
  }));

  const selected = normalized.find(
    o => o.outcome === selectedOutcome
  );

  if (!selected) {
    throw new Error("Outcome not found");
  }

  if (selected.pool < amount) {
    throw new Error("Insufficient liquidity");
  }

  const before = costFunction(
    normalized,
    b
  );

  const updatedOutcomes = normalized.map(o => ({
    ...o,
    pool:
      o.outcome === selectedOutcome
        ? o.pool - amount
        : o.pool
  }));

  const after = costFunction(
    updatedOutcomes,
    b
  );

  const payout = Math.max(
    0,
    before - after
  );

  const updatedMarket = {
    ...market,
    outcomes: updatedOutcomes,
  };

  return {
    market: updatedMarket,
    payout: Number(
      payout.toFixed(6)
    ),
    odds: getOdds(updatedMarket),
  };
}

module.exports = {
  getOdds,
  buyOutcome,
  sellOutcome,
};