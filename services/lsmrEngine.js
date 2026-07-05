function logSumExp(arr, b) {
  const max = Math.max(...arr.map(x => x / b));
  return max + Math.log(
    arr.reduce((sum, x) => sum + Math.exp(x / b - max), 0)
  );
}

// cost before purchase
function cost(q, b) {
  return b * logSumExp(q, b);
}

// compute new cost after purchase
function buy(q, index, amount, b) {
  const newQ = [...q];
  newQ[index] += amount;

  const before = cost(q, b);
  const after = cost(newQ, b);

  return {
    newQ,
    cost: after - before
  };
}

// probabilities
function getProbs(q, b) {
  const expVals = q.map(x => Math.exp(x / b));
  const sum = expVals.reduce((a, b) => a + b, 0);

  return expVals.map(v => v / sum);
}

module.exports = {
  buy,
  getProbs
};