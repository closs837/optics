import { formatUnits, parseAbi, zeroAddress } from 'viem';
import { MARKET } from './market';
import { dataAbi, oracleAbi, readContext } from './tydro';
import type { MarketSnapshot } from './types';

const reserveAbi = parseAbi([
  'function getReserveConfigurationData(address asset) view returns (uint256 decimals,uint256 ltv,uint256 liquidationThreshold,uint256 liquidationBonus,uint256 reserveFactor,bool usageAsCollateralEnabled,bool borrowingEnabled,bool stableBorrowRateEnabled,bool isActive,bool isFrozen)',
  'function getReserveData(address asset) view returns (uint256 unbacked,uint256 accruedToTreasuryScaled,uint256 totalAToken,uint256 totalStableDebt,uint256 totalVariableDebt,uint256 liquidityRate,uint256 variableBorrowRate,uint256 stableBorrowRate,uint256 averageStableBorrowRate,uint256 liquidityIndex,uint256 variableBorrowIndex,uint40 lastUpdateTimestamp)',
  'function getReserveCaps(address asset) view returns (uint256 borrowCap,uint256 supplyCap)',
  'function getPaused(address asset) view returns (bool)',
  'function getVirtualUnderlyingBalance(address asset) view returns (uint256)',
]);
async function readFrom(url: string): Promise<MarketSnapshot> {
  const { client, block, blockNumber, dataProvider, oracle } =
    await readContext(url);
  const [reserves, currency, unit] = await Promise.all([
    client.readContract({
      address: dataProvider,
      abi: dataAbi,
      functionName: 'getAllReservesTokens',
      blockNumber,
    }),
    client.readContract({
      address: oracle,
      abi: oracleAbi,
      functionName: 'BASE_CURRENCY',
      blockNumber,
    }),
    client.readContract({
      address: oracle,
      abi: oracleAbi,
      functionName: 'BASE_CURRENCY_UNIT',
      blockNumber,
    }),
  ]);
  if (currency !== zeroAddress || unit !== 100_000_000n || reserves.length > 64)
    throw new Error('Market currency or coverage changed.');
  const prices = await client.readContract({
    address: oracle,
    abi: oracleAbi,
    functionName: 'getAssetsPrices',
    args: [reserves.map((r) => r.tokenAddress)],
    blockNumber,
  });
  const rows = await Promise.all(
    reserves.map(async (r, i) => {
      const params = {
        address: dataProvider,
        abi: reserveAbi,
        args: [r.tokenAddress],
        blockNumber,
      } as const;
      const [config, data, caps, paused, liquidity] = await Promise.all([
        client.readContract({
          ...params,
          functionName: 'getReserveConfigurationData',
        }),
        client.readContract({ ...params, functionName: 'getReserveData' }),
        client.readContract({ ...params, functionName: 'getReserveCaps' }),
        client.readContract({ ...params, functionName: 'getPaused' }),
        client.readContract({
          ...params,
          functionName: 'getVirtualUnderlyingBalance',
        }),
      ]);
      const decimals = Number(config[0]);
      if (decimals > 36 || (config[8] && prices[i] === 0n))
        throw new Error('Invalid reserve denomination.');
      const debt = data[3] + data[4];
      const usd = (n: bigint) =>
        formatUnits((n * prices[i]) / 10n ** BigInt(decimals), 8);
      return {
        address: r.tokenAddress,
        symbol: r.symbol.slice(0, 24),
        decimals,
        priceUsd: formatUnits(prices[i], 8),
        supplyUsd: usd(data[2]),
        debtUsd: usd(debt),
        liquidityUsd: usd(liquidity),
        supplied: formatUnits(data[2], decimals),
        borrowed: formatUnits(debt, decimals),
        supplyApr: Number(formatUnits(data[5], 27)) * 100,
        borrowApr: Number(formatUnits(data[6], 27)) * 100,
        utilization:
          debt + liquidity > 0n
            ? Number((debt * 1_000_000n) / (debt + liquidity)) / 10_000
            : 0,
        ltvBps: Number(config[1]),
        liquidationThresholdBps: Number(config[2]),
        liquidationBonusBps: Number(config[3]),
        reserveFactorBps: Number(config[4]),
        supplyCap: String(caps[1]),
        borrowCap: String(caps[0]),
        collateralEnabled: config[5],
        borrowingEnabled: config[6],
        active: config[8],
        frozen: config[9],
        paused,
      };
    }),
  );
  return {
    blockNumber: String(blockNumber),
    blockTimestamp: Number(block.timestamp) * 1000,
    observedAt: Date.now(),
    reserves: rows.sort((a, b) => Number(b.supplyUsd) - Number(a.supplyUsd)),
    rpc: url,
  };
}
let cached: MarketSnapshot | null = null;
let inFlight: Promise<MarketSnapshot> | null = null;
export async function readMarkets(): Promise<MarketSnapshot> {
  if (cached && Date.now() - cached.observedAt < 30_000) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    for (const url of MARKET.rpc) {
      try {
        const result = await readFrom(url);
        cached = result;
        return result;
      } catch {
        /* Retry the other official endpoint; do not serve stale data as live. */
      }
    }
    throw new Error(
      'Live market data is unavailable from both Ink sources. Try again shortly.',
    );
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
