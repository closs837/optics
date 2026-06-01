export type Metric = 'healthFactor' | 'collateralUsd' | 'debtUsd';
export type Comparison = 'below' | 'above';
export interface AssetPosition {
  address: string;
  symbol: string;
  decimals: number;
  supplied: string;
  borrowed: string;
  collateral: boolean;
  priceUsd: string;
  suppliedUsd: string;
  borrowedUsd: string;
}
export interface Snapshot {
  address: string;
  market: 'tydro-v3';
  blockNumber: string;
  blockTimestamp: number;
  observedAt: number;
  collateralUsd: string;
  debtUsd: string;
  availableBorrowsUsd: string;
  healthFactor: string | null;
  liquidationThresholdBps: number;
  ltvBps: number;
  eMode: number;
  assets: AssetPosition[];
  rpc: string;
}
export interface Watch {
  id: string;
  address: string;
  label: string;
  createdAt: number;
  lastPolledAt: number | null;
  lastError: string | null;
  latest: Snapshot | null;
}
export interface Rule {
  id: string;
  watchId: string;
  metric: Metric;
  comparison: Comparison;
  threshold: string;
  enabled: boolean;
  wasMatching: boolean;
  lastTriggeredAt: number | null;
}
export interface AlertEvent {
  id: string;
  watchId: string;
  ruleId: string | null;
  title: string;
  detail: string;
  createdAt: number;
  blockNumber: string;
  read: boolean;
}
export interface AppState {
  watches: Watch[];
  rules: Rule[];
  alerts: AlertEvent[];
  scenarios: SavedScenario[];
}
export interface ScenarioInput {
  collateralShock: number;
  debtShock: number;
  repayUsd: number;
  targetHealthFactor: number;
}
export interface SavedScenario extends ScenarioInput {
  id: string;
  watchId: string;
  name: string;
  createdAt: number;
}
export interface ReserveMarket {
  address: string;
  symbol: string;
  decimals: number;
  priceUsd: string;
  supplyUsd: string;
  debtUsd: string;
  liquidityUsd: string;
  supplyApr: number;
  borrowApr: number;
  utilization: number;
  ltvBps: number;
  liquidationThresholdBps: number;
  liquidationBonusBps: number;
  reserveFactorBps: number;
  supplyCap: string;
  borrowCap: string;
  supplied: string;
  borrowed: string;
  active: boolean;
  frozen: boolean;
  paused: boolean;
  borrowingEnabled: boolean;
  collateralEnabled: boolean;
}
export interface MarketSnapshot {
  blockNumber: string;
  blockTimestamp: number;
  observedAt: number;
  reserves: ReserveMarket[];
  rpc: string;
}
export interface ProtocolEvent {
  id: string;
  kind:
    | 'Supply'
    | 'Withdraw'
    | 'Borrow'
    | 'Repay'
    | 'Liquidation'
    | 'Collateral enabled'
    | 'Collateral disabled'
    | 'Efficiency mode';
  asset: string | null;
  symbol: string;
  amount: string | null;
  detail: string;
  transactionHash: string;
  blockNumber: string;
  timestamp: number;
}
export interface ActivityPage {
  address: string;
  events: ProtocolEvent[];
  fromBlock: string;
  toBlock: string;
  fromTimestamp: number;
  toTimestamp: number;
  nextBefore: string | null;
}
export interface Observation {
  id: string;
  snapshot: Snapshot;
}
export interface Change {
  title: string;
  detail: string;
  kind: 'up' | 'down' | 'neutral';
}
