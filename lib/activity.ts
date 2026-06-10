import {
  decodeEventLog,
  formatUnits,
  pad,
  parseAbi,
  toEventSelector,
  toHex,
} from 'viem';
import { MARKET } from './market';
import { dataAbi, normalizeAddress, readContext } from './tydro';
import type { ActivityPage, ProtocolEvent } from './types';

export const activityAbi = parseAbi([
  'event Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 indexed referralCode)',
  'event Withdraw(address indexed reserve,address indexed user,address indexed to,uint256 amount)',
  'event Borrow(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint8 interestRateMode,uint256 borrowRate,uint16 indexed referralCode)',
  'event Repay(address indexed reserve,address indexed user,address indexed repayer,uint256 amount,bool useATokens)',
  'event ReserveUsedAsCollateralEnabled(address indexed reserve,address indexed user)',
  'event ReserveUsedAsCollateralDisabled(address indexed reserve,address indexed user)',
  'event LiquidationCall(address indexed collateralAsset,address indexed debtAsset,address indexed user,uint256 debtToCover,uint256 liquidatedCollateralAmount,address liquidator,bool receiveAToken)',
  'event UserEModeSet(address indexed user,uint8 categoryId)',
]);
const names: Record<string, ProtocolEvent['kind']> = {
  Supply: 'Supply',
  Withdraw: 'Withdraw',
  Borrow: 'Borrow',
  Repay: 'Repay',
  ReserveUsedAsCollateralEnabled: 'Collateral enabled',
  ReserveUsedAsCollateralDisabled: 'Collateral disabled',
  LiquidationCall: 'Liquidation',
  UserEModeSet: 'Efficiency mode',
};
const decimalsAbi = parseAbi(['function decimals() view returns (uint8)']);
async function readFrom(
  url: string,
  address: `0x${string}`,
  before?: string,
): Promise<ActivityPage> {
  const { client, block, blockNumber, pool, dataProvider } =
    await readContext(url);
  const to = before ? BigInt(before) - 1n : blockNumber;
  if (to < 0n || to > blockNumber)
    throw new Error('Activity cursor is outside the chain range.');
  const from = to > 1999n ? to - 1999n : 0n;
  const topic = pad(address);
  const groups = [
    [activityAbi.slice(0, 6).map((e) => toEventSelector(e)), null, topic],
    [[toEventSelector(activityAbi[6])], null, null, topic],
    [[toEventSelector(activityAbi[7])], topic],
  ];
  const all = [];
  // Small block slices keep calls within public RPC range limits.
  for (let start = from; start <= to; start += 500n) {
    const end = start + 499n < to ? start + 499n : to;
    const chunks = await Promise.all(
      groups.map((topics) =>
        client.request({
          method: 'eth_getLogs',
          params: [
            {
              address: pool,
              fromBlock: toHex(start),
              toBlock: toHex(end),
              topics,
            },
          ],
        }),
      ),
    );
    all.push(...chunks.flat());
  }
  const logs = all
    .filter(
      (l) =>
        !l.removed && l.blockNumber && l.transactionHash && l.logIndex !== null,
    )
    .sort(
      (a, b) =>
        Number(BigInt(b.blockNumber!) - BigInt(a.blockNumber!)) ||
        Number(BigInt(b.logIndex!) - BigInt(a.logIndex!)),
    );
  // If a busy account exceeds the page limit, finish at a block boundary so
  // pagination can never skip the remaining logs in the same block.
  const cutoff = logs.length > 100 ? BigInt(logs[99].blockNumber!) : from;
  const retained = logs.filter((l) => BigInt(l.blockNumber!) >= cutoff);
  const pageFrom = cutoff > from ? cutoff : from;
  const [reserves, startBlock, endBlock] = await Promise.all([
    client.readContract({
      address: dataProvider,
      abi: dataAbi,
      functionName: 'getAllReservesTokens',
      blockNumber,
    }),
    client.getBlock({ blockNumber: pageFrom }),
    to === blockNumber
      ? Promise.resolve(block)
      : client.getBlock({ blockNumber: to }),
  ]);
  const timestamps = new Map<string, number>();
  timestamps.set(String(pageFrom), Number(startBlock.timestamp) * 1000);
  timestamps.set(String(to), Number(endBlock.timestamp) * 1000);
  await Promise.all(
    Array.from(
      new Set(retained.map((l) => String(BigInt(l.blockNumber!)))),
    ).map(async (bn) => {
      if (!timestamps.has(bn))
        timestamps.set(
          bn,
          Number(
            (await client.getBlock({ blockNumber: BigInt(bn) })).timestamp,
          ) * 1000,
        );
    }),
  );
  const decimals = new Map<string, number>();
  const events: ProtocolEvent[] = [];
  for (const log of retained) {
    const decoded = decodeEventLog({
      abi: activityAbi,
      data: log.data,
      topics: log.topics,
    });
    const args = decoded.args as Record<string, unknown>;
    const asset = (args.reserve ?? args.debtAsset ?? null) as
      | `0x${string}`
      | null;
    const reserve = reserves.find(
      (r) => r.tokenAddress.toLowerCase() === asset?.toLowerCase(),
    );
    if (asset && !decimals.has(asset)) {
      const n = await client.readContract({
        address: asset,
        abi: decimalsAbi,
        functionName: 'decimals',
        blockNumber,
      });
      if (n > 36) throw new Error('Invalid token scale in activity.');
      decimals.set(asset, n);
    }
    const amount = (args.amount ?? args.debtToCover) as bigint | undefined;
    let detail = '';
    if (decoded.eventName === 'Repay')
      detail = args.useATokens
        ? 'Repaid using supplied aTokens'
        : 'Debt repayment';
    if (decoded.eventName === 'LiquidationCall')
      detail = 'Debt covered by a liquidation; collateral was seized.';
    if (decoded.eventName === 'UserEModeSet')
      detail = 'Changed to category ' + String(args.categoryId);
    if (decoded.eventName === 'Supply' || decoded.eventName === 'Borrow')
      detail =
        String(args.user).toLowerCase() === address.toLowerCase()
          ? 'Initiated by this address'
          : 'Executed on behalf of this address';
    events.push({
      id: log.transactionHash! + ':' + String(BigInt(log.logIndex!)),
      kind: names[decoded.eventName],
      asset,
      symbol:
        reserve?.symbol.slice(0, 24) ?? (asset ? asset.slice(0, 6) + '…' : '—'),
      amount:
        amount !== undefined && asset
          ? formatUnits(amount, decimals.get(asset)!)
          : null,
      detail,
      transactionHash: log.transactionHash!,
      blockNumber: String(BigInt(log.blockNumber!)),
      timestamp: timestamps.get(String(BigInt(log.blockNumber!)))!,
    });
  }
  return {
    address,
    events,
    fromBlock: String(pageFrom),
    toBlock: String(to),
    fromTimestamp: Number(startBlock.timestamp) * 1000,
    toTimestamp: Number(endBlock.timestamp) * 1000,
    nextBefore: pageFrom > 0n ? String(pageFrom) : null,
  };
}
export async function readActivity(input: unknown, before?: string) {
  const address = normalizeAddress(input);
  if (before !== undefined && !/^[1-9]\d{0,14}$/.test(before))
    throw new Error('Invalid activity cursor.');
  for (const url of MARKET.rpc) {
    try {
      return await readFrom(url, address, before);
    } catch (e) {
      if (e instanceof Error && e.message.includes('cursor')) throw e;
    }
  }
  throw new Error(
    'Recent protocol activity could not be read. Try again shortly.',
  );
}
