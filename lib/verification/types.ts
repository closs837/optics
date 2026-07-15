export type Hex = `0x${string}`;
export interface ReceiptLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  logIndex: Hex;
  transactionHash: Hex;
  blockHash: Hex;
}
export interface Receipt {
  type: Hex;
  status: Hex;
  cumulativeGasUsed: Hex;
  logsBloom: Hex;
  logs: ReceiptLog[];
  transactionIndex: Hex;
  transactionHash: Hex;
  blockHash: Hex;
  blockNumber: Hex;
  depositNonce?: Hex;
  depositReceiptVersion?: Hex;
}
export interface ReceiptHeader {
  number: Hex;
  hash: Hex;
  parentHash: Hex;
  receiptsRoot: Hex;
  timestamp: Hex;
  transactions: Hex[];
}
export interface ChainView {
  id: string;
  safe: { number: Hex; hash: Hex };
  finalized: { number: Hex; hash: Hex };
  canonical: Record<string, Hex>;
}
export interface ReceiptEvidence {
  chainId: 57073;
  source: 'live' | 'capture' | 'replay';
  sourceLabel: string;
  capturedAt: string;
  header: ReceiptHeader;
  receipts: Receipt[];
  view: ChainView;
}
export interface VerifiedEvent {
  id: string;
  blockHash: Hex;
  blockNumber: string;
  transactionHash: Hex;
  logIndex: number;
  address: Hex;
  topics: Hex[];
  data: Hex;
  finality: 'pending' | 'safe' | 'finalized';
}
export interface VerificationRun {
  id: Hex;
  blockNumber: string;
  expectedRoot: Hex;
  observedRoot: Hex;
  source: ReceiptEvidence['source'];
  sourceLabel: string;
  capturedAt: string;
  receipts: number;
  logs: number;
  attempts: number;
  cacheHit: boolean;
  status: 'verified' | 'rejected';
  finality: VerifiedEvent['finality'] | 'orphaned';
  message: string;
}
export interface VerificationLedger {
  format: 1;
  sequence: number;
  view: ChainView | null;
  inputs: ReceiptEvidence[];
  cache: Record<string, { root: Hex; accepted: boolean }>;
  runs: VerificationRun[];
  events: VerifiedEvent[];
}
export interface VerificationWorkspace {
  receiptAudit: true;
  version: number;
  updatedAt: number | null;
  ledger: VerificationLedger;
}
