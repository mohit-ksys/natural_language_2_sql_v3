const MODEL_PRICING = {
  'gemini-3.1-pro-preview': {
    input:  { base: 2.00,  high: 4.00,  threshold: 200000 },
    output: { base: 12.00, high: 18.00, threshold: 200000 },
  },
  'gemini-3.1-flash-lite-preview': {
    input:  { base: 0.25 },
    output: { base: 1.50 },
  },
  'gemini-3-flash-preview': {
    input:  { base: 0.50 },
    output: { base: 3.00 },
  },
};

export function calcCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model];
  if (!pricing || !inputTokens) return null;

  const inp = inputTokens || 0;
  const out = outputTokens || 0;

  const inputRate  = pricing.input.threshold  && inp > pricing.input.threshold  ? pricing.input.high  : pricing.input.base;
  const outputRate = pricing.output.threshold && out > pricing.output.threshold ? pricing.output.high : pricing.output.base;

  const inputCost  = (inp / 1_000_000) * inputRate;
  const outputCost = (out / 1_000_000) * outputRate;
  const totalCost  = inputCost + outputCost;

  return { inputCost, outputCost, totalCost, inputRate, outputRate };
}

export function formatCost(usd) {
  if (usd === null || usd === undefined) return '';
  if (usd === 0) return '$0.00';
  if (usd < 0.00001) return '<$0.00001';
  if (usd < 0.001)   return `$${usd.toFixed(5)}`;
  if (usd < 0.01)    return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatUsd(usd) {
  if (usd === null || usd === undefined) return '';
  if (usd === 0) return '$0.00';
  if (usd < 0.00001) return '<$0.00001';
  if (usd < 0.001)   return `$${usd.toFixed(5)}`;
  if (usd < 0.01)    return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatTokens(n) {
  if (!n && n !== 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000)      return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
