// marketEngine.ts

export type Outcome = {
  outcome: string;
  pool: number;
};

export type Market = {
  id: number;
  outcomes: Outcome[];
  b: number; // liquidity parameter
};

function exp(x: number) {
  return Math.exp(x);
}

// ---------- LMSR COST ----------
function costFunction(outcomes: Outcome[], b: number) {
  const sum = outcomes.reduce(
    (s, o) => s + exp(o.pool / b),
    0
  );

  return b * Math.log(sum);
}

// ---------- ODDS ----------
export function getOdds(market: Market) {
  const exps = market.outcomes.map(o => ({
    outcome: o.outcome,
    value: exp(o.pool / market.b),
  }));

  const total = exps.reduce((s, o) => s + o.value, 0);

  const odds: Record<string, number> = {};

  for (const e of exps) {
    odds[e.outcome] = e.value / total;
  }

  return odds;
}

// ---------- BUY OUTCOME ----------
export function buyOutcome(
  market: Market,
  selectedOutcome: string,
  amount: number
) {

  if (amount <= 0) {
    throw new Error("Invalid amount");
  }

  const exists = market.outcomes.some(
    o => o.outcome === selectedOutcome
  );

  if (!exists) {
    throw new Error("Outcome not found");
  }

  const before = costFunction(
    market.outcomes,
    market.b
  );

  const updatedOutcomes = market.outcomes.map(o => {
    if (o.outcome === selectedOutcome) {
      return {
        ...o,
        pool: o.pool + amount,
      };
    }

    return o;
  });

  const after = costFunction(
    updatedOutcomes,
    market.b
  );

  const pricePaid = after - before;

  return {
    market: {
      ...market,
      outcomes: updatedOutcomes,
    },

    cost: Number(pricePaid.toFixed(6)),

    odds: getOdds({
      ...market,
      outcomes: updatedOutcomes,
    }),
  };
}