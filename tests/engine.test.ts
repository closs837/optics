import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fixed,
  matches,
  shouldTrigger,
  validateRule,
  explainChanges,
} from '../lib/engine.ts';
import type { Rule, Snapshot } from '../lib/types.ts';
const snapshot: Snapshot = {
  address: '0x0000000000000000000000000000000000000001',
  market: 'tydro-v3',
  blockNumber: '100',
  blockTimestamp: 1000,
  observedAt: 1000,
  collateralUsd: '10000',
  debtUsd: '4000',
  availableBorrowsUsd: '4000',
  healthFactor: '2',
  liquidationThresholdBps: 8000,
  ltvBps: 8000,
  eMode: 0,
  assets: [],
  rpc: 'https://rpc-gel.inkonchain.com',
};
const rule: Rule = {
  id: 'r',
  watchId: 'w',
  metric: 'healthFactor',
  comparison: 'below',
  threshold: '1.5',
  enabled: true,
  wasMatching: false,
  lastTriggeredAt: null,
};
void test('fixed decimal comparison preserves sub-floating-point differences', () => {
  assert.equal(fixed('1.000000000000000001') - fixed('1'), 1n);
  assert.equal(
    matches(
      { ...rule, threshold: '1.000000000000000002' },
      { ...snapshot, healthFactor: '1.000000000000000001' },
    ),
    true,
  );
});
void test('a crossing triggers once, re-arms after recovery, and can trigger again', () => {
  const r = { ...rule };
  const low = { ...snapshot, healthFactor: '1.4' };
  assert(shouldTrigger(r, low));
  r.wasMatching = matches(r, low);
  assert(!shouldTrigger(r, low));
  r.wasMatching = matches(r, snapshot);
  assert(shouldTrigger(r, low));
});
void test('strict threshold equality does not trigger', () => {
  assert(!matches({ ...rule, threshold: '2' }, snapshot));
  assert(!matches({ ...rule, threshold: '2', comparison: 'above' }, snapshot));
});
void test('a no-debt account never matches health-factor thresholds', () => {
  assert(!matches(rule, { ...snapshot, healthFactor: null, debtUsd: '0' }));
  assert(
    !matches(
      { ...rule, comparison: 'above' },
      { ...snapshot, healthFactor: null },
    ),
  );
});
void test('disabled rules do not trigger', () =>
  assert(
    !shouldTrigger(
      { ...rule, enabled: false },
      { ...snapshot, healthFactor: '1' },
    ),
  ));
void test('dollar thresholds use the same exact comparison', () => {
  assert(
    matches(
      {
        ...rule,
        metric: 'debtUsd',
        comparison: 'above',
        threshold: '3999.99999999',
      },
      snapshot,
    ),
  );
  assert(
    !matches(
      {
        ...rule,
        metric: 'collateralUsd',
        comparison: 'below',
        threshold: '10000',
      },
      snapshot,
    ),
  );
});
void test('invalid thresholds, signs, exponents, and precision are rejected', () => {
  for (const threshold of [
    '0',
    '-1',
    'NaN',
    'Infinity',
    '1e8',
    '1.0000000000000000001',
    '',
    '1'.repeat(31),
  ])
    assert.throws(() => validateRule({ ...rule, threshold }));
  assert.throws(() => validateRule({ ...rule, metric: 'walletBalance' }));
  assert.throws(() => validateRule({ ...rule, comparison: 'equals' }));
});
void test('first observation never fabricates earlier changes', () => {
  const changes = explainChanges(null, snapshot);
  assert.equal(changes.length, 1);
  assert.match(changes[0].detail, /not reconstructed/);
});
void test('dollar deltas and threshold changes are explained separately', () => {
  const changes = explainChanges(snapshot, {
    ...snapshot,
    collateralUsd: '9000',
    liquidationThresholdBps: 7900,
  });
  assert.match(changes[0].title, /decreased by \$1,000/);
  assert(
    changes.some((c) => c.title === 'Weighted liquidation threshold changed'),
  );
});
void test('interest-like balance changes do not claim a user transaction', () => {
  const asset = {
    address: '0x1',
    symbol: 'TEST',
    decimals: 18,
    supplied: '1',
    borrowed: '0',
    collateral: true,
    priceUsd: '100',
    suppliedUsd: '100',
    borrowedUsd: '0',
  };
  const changes = explainChanges(
    { ...snapshot, assets: [asset] },
    { ...snapshot, assets: [{ ...asset, supplied: '1.00001' }] },
  );
  assert(
    changes.some((c) => c.detail.includes('do not identify transactions')),
  );
});
void test('closed positions are included in change history', () => {
  const asset = {
    address: '0x1',
    symbol: 'TEST',
    decimals: 18,
    supplied: '1',
    borrowed: '0',
    collateral: true,
    priceUsd: '100',
    suppliedUsd: '100',
    borrowedUsd: '0',
  };
  assert(
    explainChanges({ ...snapshot, assets: [asset] }, snapshot).some(
      (c) => c.title === 'TEST position closed',
    ),
  );
});
