import {
  createPublicClient,
  http,
  parseAbi,
  formatUnits,
  getAddress,
  isAddress,
  zeroAddress,
} from 'viem';
import { MARKET } from './market';
import type { Snapshot } from './types';
export function normalizeAddress(input: unknown): `0x${string}` {
  if (typeof input !== 'string' || !isAddress(input.trim()))
    throw new Error('Enter a valid 42-character EVM address.');
  const address = getAddress(input.trim());
  if (address === zeroAddress)
    throw new Error('The zero address cannot have a user position.');
  return address;
}
export const providerAbi = parseAbi([
  'function getPool() view returns (address)',
  'function getPriceOracle() view returns (address)',
  'function getPoolDataProvider() view returns (address)',
]);
const poolAbi = parseAbi([
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)',
  'function getUserEMode(address user) view returns (uint256)',
]);
export const dataAbi = parseAbi([
  'function getAllReservesTokens() view returns ((string symbol,address tokenAddress)[])',
  'function getUserReserveData(address asset,address user) view returns (uint256 currentATokenBalance,uint256 currentStableDebt,uint256 currentVariableDebt,uint256 principalStableDebt,uint256 scaledVariableDebt,uint256 stableBorrowRate,uint256 liquidityRate,uint40 stableRateLastUpdated,bool usageAsCollateralEnabled)',
]);
export const oracleAbi = parseAbi([
  'function BASE_CURRENCY() view returns (address)',
  'function BASE_CURRENCY_UNIT() view returns (uint256)',
  'function getAssetsPrices(address[] assets) view returns (uint256[])',
]);
const tokenAbi = parseAbi(['function decimals() view returns (uint8)']);
const maxUint = 2n ** 256n - 1n;
export async function readContext(url: string) {
  const client = createPublicClient({
    transport: http(url, {
      timeout: 12_000,
      retryCount: 1,
      batch: { wait: 15, batchSize: 50 },
    }),
  });
  if ((await client.getChainId()) !== MARKET.chainId)
    throw new Error('RPC returned the wrong network.');
  const block = await client.getBlock({ blockTag: 'latest' });
  if (block.number === null)
    throw new Error('No confirmed block is available.');
  if (Date.now() - Number(block.timestamp) * 1000 > 180_000)
    throw new Error('RPC block is more than three minutes old.');
  const blockNumber = block.number;
  const [pool, oracle, dataProvider] = await Promise.all(
    providerAbi.map((f) =>
      client.readContract({
        address: MARKET.provider,
        abi: providerAbi,
        functionName: f.name,
        blockNumber,
      }),
    ),
  );
  if (
    pool.toLowerCase() !== MARKET.pool.toLowerCase() ||
    oracle.toLowerCase() !== MARKET.oracle.toLowerCase() ||
    dataProvider.toLowerCase() !== MARKET.dataProvider.toLowerCase()
  )
    throw new Error(
      'The market contracts changed. Coverage must be reverified.',
    );
  return { client, block, blockNumber, pool, oracle, dataProvider };
}
async function readFrom(
  url: string,
  address: `0x${string}`,
): Promise<Snapshot> {
  const { client, block, blockNumber, pool, oracle, dataProvider } =
    await readContext(url);
  const [account, eMode, reserves, baseCurrency, baseUnit] = await Promise.all([
    client.readContract({
      address: pool,
      abi: poolAbi,
      functionName: 'getUserAccountData',
      args: [address],
      blockNumber,
    }),
    client.readContract({
      address: pool,
      abi: poolAbi,
      functionName: 'getUserEMode',
      args: [address],
      blockNumber,
    }),
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
  if (baseCurrency !== zeroAddress || baseUnit !== 100_000_000n)
    throw new Error('Unsupported oracle currency denomination.');
  if (reserves.length > 64)
    throw new Error('Unexpected market size; data must be reverified.');
  const prices = await client.readContract({
    address: oracle,
    abi: oracleAbi,
    functionName: 'getAssetsPrices',
    args: [reserves.map((r) => r.tokenAddress)],
    blockNumber,
  });
  const assets = await Promise.all(
    reserves.map(async (asset, i) => {
      const [data, decimals] = await Promise.all([
        client.readContract({
          address: dataProvider,
          abi: dataAbi,
          functionName: 'getUserReserveData',
          args: [asset.tokenAddress, address],
          blockNumber,
        }),
        client.readContract({
          address: asset.tokenAddress,
          abi: tokenAbi,
          functionName: 'decimals',
          blockNumber,
        }),
      ]);
      const borrowed = data[1] + data[2];
      if (!data[0] && !borrowed) return null;
      if (decimals > 36 || prices[i] === 0n)
        throw new Error(
          'An active asset has an invalid price or decimal scale.',
        );
      return {
        address: asset.tokenAddress,
        symbol: asset.symbol.slice(0, 24),
        decimals,
        supplied: formatUnits(data[0], decimals),
        borrowed: formatUnits(borrowed, decimals),
        collateral: data[8],
        priceUsd: formatUnits(prices[i], 8),
        suppliedUsd: formatUnits(
          (data[0] * prices[i]) / 10n ** BigInt(decimals),
          8,
        ),
        borrowedUsd: formatUnits(
          (borrowed * prices[i]) / 10n ** BigInt(decimals),
          8,
        ),
      };
    }),
  );
  return {
    address,
    market: 'tydro-v3',
    blockNumber: String(blockNumber),
    blockTimestamp: Number(block.timestamp) * 1000,
    observedAt: Date.now(),
    collateralUsd: formatUnits(account[0], 8),
    debtUsd: formatUnits(account[1], 8),
    availableBorrowsUsd: formatUnits(account[2], 8),
    liquidationThresholdBps: Number(account[3]),
    ltvBps: Number(account[4]),
    healthFactor:
      account[1] === 0n || account[5] === maxUint
        ? null
        : formatUnits(account[5], 18),
    eMode: Number(eMode),
    assets: assets.filter((a): a is NonNullable<typeof a> => a !== null),
    rpc: url,
  };
}
export async function readPosition(input: unknown): Promise<Snapshot> {
  const address = normalizeAddress(input);
  let last: unknown;
  for (const url of MARKET.rpc) {
    try {
      return await readFrom(url, address);
    } catch (e) {
      last = e;
    }
  }
  // Contract coverage errors are useful; raw RPC internals and full URLs are not.
  const message = last instanceof Error ? last.message : '';
  if (
    /market contracts changed|Unsupported oracle|wrong network|more than three minutes|invalid price/.test(
      message,
    )
  )
    throw new Error(message);
  throw new Error(
    'Both Ink data sources are unavailable. Your last saved observation is unchanged. Try again shortly.',
  );
}
