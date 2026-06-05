import type { ScenarioInput, Snapshot, Watch } from './types';

export const defaultScenario: ScenarioInput = {
  collateralShock: 0,
  debtShock: 0,
  repayUsd: 0,
  targetHealthFactor: 1.5,
};

export function validateScenario(
  input: Record<string, unknown>,
): ScenarioInput {
  const ranges = {
    collateralShock: [-95, 100],
    debtShock: [-95, 100],
    repayUsd: [0, 1e15],
    targetHealthFactor: [1, 10],
  } as const;
  for (const key of Object.keys(ranges) as (keyof ScenarioInput)[]) {
    const value = input[key];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < ranges[key][0] ||
      value > ranges[key][1]
    )
      throw new Error('Scenario values are outside the supported range.');
  }
  return {
    collateralShock: input.collateralShock as number,
    debtShock: input.debtShock as number,
    repayUsd: input.repayUsd as number,
    targetHealthFactor: input.targetHealthFactor as number,
  };
}

// A uniform basket sensitivity model. Anchor to the on-chain HF to avoid
// reconstructing eMode from rounded weighted liquidation thresholds.
export function simulate(snapshot: Snapshot, input: ScenarioInput) {
  validateScenario({ ...input });
  const originalDebt = Number(snapshot.debtUsd);
  const originalCollateral = Number(snapshot.collateralUsd);
  const collateral = originalCollateral * (1 + input.collateralShock / 100);
  const revaluedDebt = originalDebt * (1 + input.debtShock / 100);
  const repaid = Math.min(input.repayUsd, revaluedDebt);
  const debt = Math.max(0, revaluedDebt - repaid);
  const baselineCapacity =
    originalDebt > 0 && snapshot.healthFactor !== null
      ? Number(snapshot.healthFactor) * originalDebt
      : (originalCollateral * snapshot.liquidationThresholdBps) / 10_000;
  const capacity = baselineCapacity * (1 + input.collateralShock / 100);
  const healthFactor = debt > 0 ? capacity / debt : null;
  return {
    collateral,
    debt,
    repaid,
    healthFactor,
    capacity,
    headroom: capacity - debt,
    collateralDropToLiquidation:
      healthFactor === null ? null : Math.max(0, (1 - 1 / healthFactor) * 100),
    repaymentToTarget: Math.max(0, debt - capacity / input.targetHealthFactor),
    additionalCollateralToTarget:
      capacity > 0
        ? Math.max(
            0,
            ((debt * input.targetHealthFactor - capacity) * collateral) /
              capacity,
          )
        : null,
  };
}

export function portfolio(watches: Watch[], now: number) {
  const assets = new Map<
    string,
    {
      address: string;
      symbol: string;
      supplied: number;
      borrowed: number;
      collateral: number;
    }
  >();
  let supplied = 0,
    debt = 0,
    collateral = 0,
    stale = 0,
    observed = 0;
  const healthFactors: number[] = [];
  for (const w of watches) {
    const s = w.latest;
    if (!s) continue;
    observed++;
    if (w.lastError || now - s.observedAt > 180_000) stale++;
    debt += Number(s.debtUsd);
    collateral += Number(s.collateralUsd);
    if (s.healthFactor !== null) healthFactors.push(Number(s.healthFactor));
    for (const a of s.assets) {
      const key = a.address.toLowerCase();
      const row = assets.get(key) ?? {
        address: a.address,
        symbol: a.symbol,
        supplied: 0,
        borrowed: 0,
        collateral: 0,
      };
      row.supplied += Number(a.suppliedUsd);
      row.borrowed += Number(a.borrowedUsd);
      row.collateral += a.collateral ? Number(a.suppliedUsd) : 0;
      supplied += Number(a.suppliedUsd);
      assets.set(key, row);
    }
  }
  return {
    supplied,
    debt,
    collateral,
    net: supplied - debt,
    stale,
    observed,
    missing: watches.length - observed,
    lowestHealthFactor: healthFactors.length
      ? Math.min(...healthFactors)
      : null,
    assets: [...assets.values()].sort((a, b) => b.supplied - a.supplied),
  };
}

export function csv(rows: (string | number | null)[][]) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let cell = value === null ? '' : String(value);
          // Wallet labels and token symbols are untrusted spreadsheet input.
          if (typeof value === 'string' && /^[\s]*[=+@-]/.test(cell))
            cell = "'" + cell;
          return '"' + cell.replaceAll('"', '""') + '"';
        })
        .join(','),
    )
    .join('\r\n');
}
