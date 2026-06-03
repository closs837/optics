import type { Change, Metric, Rule, Snapshot } from './types';
export const metricLabels: Record<Metric, string> = {
  healthFactor: 'Health factor',
  collateralUsd: 'Collateral value',
  debtUsd: 'Debt value',
};
// Compare fixed decimals as integers; displayed floating-point values never decide alerts.
export function fixed(value: string, decimals = 18): bigint {
  if (!/^\d+(\.\d+)?$/.test(value))
    throw new Error('Enter a positive decimal number.');
  const [whole, fraction = ''] = value.split('.');
  if (whole.length > 30 || fraction.length > decimals)
    throw new Error(`Use at most ${decimals} decimal places.`);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, '0'))
  );
}
export function matches(
  rule: Pick<Rule, 'metric' | 'comparison' | 'threshold'>,
  snapshot: Snapshot,
): boolean {
  const raw = snapshot[rule.metric];
  if (raw === null) return false; // no debt: no finite health factor to cross a threshold
  const v = fixed(raw),
    target = fixed(rule.threshold);
  return rule.comparison === 'below' ? v < target : v > target;
}
export function shouldTrigger(rule: Rule, snapshot: Snapshot) {
  return rule.enabled && matches(rule, snapshot) && !rule.wasMatching;
}
export function validateRule(input: unknown) {
  if (!input || typeof input !== 'object')
    throw new Error('Invalid alert rule.');
  const r = input as Record<string, unknown>;
  if (!['healthFactor', 'collateralUsd', 'debtUsd'].includes(String(r.metric)))
    throw new Error('Choose a supported metric.');
  if (!['below', 'above'].includes(String(r.comparison)))
    throw new Error('Choose above or below.');
  if (typeof r.threshold !== 'string')
    throw new Error('Enter a decimal threshold.');
  const threshold = r.threshold.trim();
  if (fixed(threshold) <= 0n)
    throw new Error('The threshold must be greater than zero.');
  return {
    metric: r.metric as Metric,
    comparison: r.comparison as Rule['comparison'],
    threshold,
  };
}
export function money(value: string | number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value));
}
export function metricValue(metric: Metric, value: string | null) {
  return value === null
    ? 'No debt'
    : metric === 'healthFactor'
      ? Number(value).toFixed(3)
      : money(value);
}
export function explainChanges(
  before: Snapshot | null,
  after: Snapshot,
): Change[] {
  if (!before)
    return [
      {
        title: 'First observation',
        detail:
          'History begins with this read. Earlier account activity is not reconstructed.',
        kind: 'neutral',
      },
    ];
  const result: Change[] = [];
  for (const metric of ['collateralUsd', 'debtUsd'] as const) {
    const prev = Number(before[metric]),
      next = Number(after[metric]),
      delta = next - prev;
    if (Math.abs(delta) >= 0.01)
      result.push({
        title: `${metricLabels[metric]} ${delta > 0 ? 'increased' : 'decreased'} by ${money(Math.abs(delta))}`,
        detail: `${money(prev)} → ${money(next)}${prev > 0 ? ` (${delta > 0 ? '+' : ''}${((100 * delta) / prev).toFixed(2)}%)` : ''}`,
        kind: delta > 0 ? 'up' : 'down',
      });
  }
  if (before.healthFactor !== after.healthFactor)
    result.push({
      title: 'Health factor changed',
      detail: `${metricValue('healthFactor', before.healthFactor)} → ${metricValue('healthFactor', after.healthFactor)}`,
      kind: 'neutral',
    });
  for (const asset of after.assets) {
    const old = before.assets.find(
      (a) => a.address.toLowerCase() === asset.address.toLowerCase(),
    );
    if (!old) {
      result.push({
        title: `${asset.symbol} position appeared`,
        detail: 'This asset was not present in the previous observation.',
        kind: 'neutral',
      });
      continue;
    }
    const priceDelta = Number(asset.priceUsd) - Number(old.priceUsd);
    if (Math.abs(priceDelta) > 0.001)
      result.push({
        title: `${asset.symbol} oracle price moved`,
        detail: `${money(old.priceUsd)} → ${money(asset.priceUsd)}. This is the protocol valuation price.`,
        kind: priceDelta > 0 ? 'up' : 'down',
      });
    if (asset.supplied !== old.supplied || asset.borrowed !== old.borrowed)
      result.push({
        title: `${asset.symbol} balance changed`,
        detail: `Supplied ${old.supplied} → ${asset.supplied}; borrowed ${old.borrowed} → ${asset.borrowed}. Balances include interest accrual; these reads alone do not identify transactions.`,
        kind: 'neutral',
      });
    if (asset.collateral !== old.collateral)
      result.push({
        title: `${asset.symbol} collateral setting changed`,
        detail: asset.collateral
          ? 'Now enabled as collateral.'
          : 'No longer enabled as collateral.',
        kind: 'neutral',
      });
  }
  for (const old of before.assets)
    if (
      !after.assets.some(
        (a) => a.address.toLowerCase() === old.address.toLowerCase(),
      )
    )
      result.push({
        title: `${old.symbol} position closed`,
        detail:
          'No supplied or borrowed balance was returned in the current observation.',
        kind: 'neutral',
      });
  if (before.liquidationThresholdBps !== after.liquidationThresholdBps)
    result.push({
      title: 'Weighted liquidation threshold changed',
      detail: `${before.liquidationThresholdBps / 100}% → ${after.liquidationThresholdBps / 100}%. This may reflect asset composition, collateral settings, or protocol parameters.`,
      kind: 'neutral',
    });
  if (before.eMode !== after.eMode)
    result.push({
      title: 'Efficiency mode changed',
      detail: `Category ${before.eMode} → ${after.eMode}.`,
      kind: 'neutral',
    });
  return result.length
    ? result
    : [
        {
          title: 'No material change',
          detail:
            'Collateral and debt values moved less than one cent, and no other tracked change was observed.',
          kind: 'neutral',
        },
      ];
}
