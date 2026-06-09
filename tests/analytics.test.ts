import test from 'node:test';
import assert from 'node:assert/strict';
import {
  csv,
  defaultScenario,
  portfolio,
  simulate,
  validateScenario,
} from '../lib/analytics.ts';
import type { Snapshot, Watch } from '../lib/types.ts';
const snapshot: Snapshot = {
  address: '0x0000000000000000000000000000000000000001',
  market: 'tydro-v3',
  blockNumber: '100',
  blockTimestamp: 1000,
  observedAt: 1000,
  collateralUsd: '10000',
  debtUsd: '4000',
  availableBorrowsUsd: '3000',
  healthFactor: '2.00123',
  liquidationThresholdBps: 8000,
  ltvBps: 7000,
  eMode: 1,
  rpc: 'https://rpc-gel.inkonchain.com',
  assets: [
    {
      address: '0xaaa',
      symbol: 'AAA',
      decimals: 18,
      supplied: '10',
      borrowed: '4',
      collateral: true,
      priceUsd: '1000',
      suppliedUsd: '10000',
      borrowedUsd: '4000',
    },
    {
      address: '0xbbb',
      symbol: 'BBB',
      decimals: 6,
      supplied: '100',
      borrowed: '0',
      collateral: false,
      priceUsd: '1',
      suppliedUsd: '100',
      borrowedUsd: '0',
    },
  ],
};
void test('risk baseline uses reported HF without rounded-LT drift, including eMode', () => {
  assert.equal(simulate(snapshot, defaultScenario).healthFactor, 2.00123);
  const result = simulate(snapshot, {
    ...defaultScenario,
    collateralShock: -20,
  });
  assert.equal(result.collateral, 8000);
  assert.equal(result.healthFactor, 2.00123 * 0.8);
});
void test('equal basket shocks preserve HF; independently stressed debt changes it', () => {
  const equal = simulate(snapshot, {
    ...defaultScenario,
    collateralShock: -40,
    debtShock: -40,
  });
  assert(Math.abs(equal.healthFactor! - Number(snapshot.healthFactor)) < 1e-12);
  const debt = simulate(snapshot, { ...defaultScenario, debtShock: 50 });
  assert.equal(debt.debt, 6000);
  assert(Math.abs(debt.healthFactor! - 2.00123 / 1.5) < 1e-12);
});
void test('external repayment is capped after price shock and cannot create negative debt', () => {
  const result = simulate(snapshot, {
    ...defaultScenario,
    debtShock: -50,
    repayUsd: 5000,
  });
  assert.equal(result.repaid, 2000);
  assert.equal(result.debt, 0);
  assert.equal(result.healthFactor, null);
  assert.equal(result.collateral, 10000);
  assert.equal(result.repaymentToTarget, 0);
});
void test('target repayment and same-mix collateral both reach the chosen HF', () => {
  const s = { ...snapshot, healthFactor: '0.8' };
  const r = simulate(s, defaultScenario);
  assert.equal(r.collateralDropToLiquidation, 0);
  const repaid = simulate(s, {
    ...defaultScenario,
    repayUsd: r.repaymentToTarget,
  });
  assert(Math.abs(repaid.healthFactor! - 1.5) < 1e-12);
  assert(
    Math.abs(((10000 + r.additionalCollateralToTarget!) * 0.32) / 4000 - 1.5) <
      1e-12,
  );
});
void test('no-debt and zero-capacity accounts have explicit finite outputs', () => {
  const noDebt = simulate(
    { ...snapshot, debtUsd: '0', healthFactor: null },
    defaultScenario,
  );
  assert.equal(noDebt.healthFactor, null);
  assert.equal(noDebt.collateralDropToLiquidation, null);
  const zero = simulate(
    {
      ...snapshot,
      healthFactor: '0',
      collateralUsd: '0',
      liquidationThresholdBps: 0,
    },
    defaultScenario,
  );
  assert.equal(zero.healthFactor, 0);
  assert.equal(zero.additionalCollateralToTarget, null);
  assert.equal(zero.repaymentToTarget, 4000);
});
void test('scenario validation rejects out-of-range, missing and non-numeric parameters', () => {
  for (const value of [NaN, Infinity, -96, 101, '-20', undefined])
    assert.throws(() =>
      validateScenario({ ...defaultScenario, collateralShock: value }),
    );
  for (const value of [-1, Infinity, '1'])
    assert.throws(() =>
      validateScenario({ ...defaultScenario, repayUsd: value }),
    );
  assert.throws(() =>
    validateScenario({ ...defaultScenario, targetHealthFactor: 0.9 }),
  );
  assert.deepEqual(validateScenario({ ...defaultScenario }), defaultScenario);
});
void test('portfolio combines assets by contract, keeps non-collateral supply, and never nets cross-wallet risk', () => {
  const base: Watch = {
    id: 'w',
    address: snapshot.address,
    label: 'Position',
    createdAt: 0,
    lastPolledAt: 1000,
    lastError: null,
    latest: snapshot,
  };
  const second = {
    ...base,
    id: 'other',
    latest: {
      ...snapshot,
      healthFactor: '1.1',
      assets: snapshot.assets.map((a) => ({
        ...a,
        address: a.address.toUpperCase(),
      })),
    },
  };
  const p = portfolio(
    [base, second, { ...base, id: 'missing', latest: null }],
    182000,
  );
  assert.equal(p.supplied, 20200);
  assert.equal(p.collateral, 20000);
  assert.equal(p.debt, 8000);
  assert.equal(p.net, 12200);
  assert.equal(p.assets.length, 2);
  assert.equal(p.lowestHealthFactor, 1.1);
  assert.equal(p.stale, 2);
  assert.equal(p.missing, 1);
  assert.equal(portfolio([], 0).lowestHealthFactor, null);
});
void test('CSV escapes quoted cells and neutralizes spreadsheet formulas in user text', () => {
  const exported = csv([
    ['=1+2', ' +cmd', '@SUM(A1)', '-danger', 'ordinary, "label"', -4, null],
  ]);
  assert.equal(
    exported,
    '"\'=1+2","\' +cmd","\'@SUM(A1)","\'-danger","ordinary, ""label""","-4",""',
  );
});
