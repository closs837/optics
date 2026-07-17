// Verified activity receipt auditing shared by the website, API and persistence
// checks. The same module serves UI reads and the replay checks in tests/replay.

import { receiptRoot } from './encoding.ts';
import type {
  ReceiptEvidence,
  VerificationLedger,
  VerifiedEvent,
} from './types.ts';

export function emptyLedger(): VerificationLedger {
  return {
    format: 1,
    sequence: 0,
    view: null,
    inputs: [],
    cache: {},
    runs: [],
    events: [],
  };
}

function project(ledger: VerificationLedger) {
  if (!ledger.view) return;
  for (const run of ledger.runs) {
    const height = BigInt(run.blockNumber);
    run.finality =
      height <= BigInt(ledger.view.finalized.number)
        ? 'finalized'
        : height <= BigInt(ledger.view.safe.number)
          ? 'safe'
          : 'pending';
  }
  for (const event of ledger.events) {
    const run = ledger.runs.find((row) => row.id === event.blockHash);
    if (run && run.finality !== 'orphaned') event.finality = run.finality;
  }
}

export function applyEvidence(
  previous: VerificationLedger,
  input: ReceiptEvidence,
): VerificationLedger {
  if (input.chainId !== 57073)
    throw new Error('Expected Ink mainnet evidence.');
  if (input.receipts.length !== input.header.transactions.length)
    throw new Error('Incomplete block receipt set.');
  const indices = input.receipts.map((receipt) =>
    Number(BigInt(receipt.transactionIndex)),
  );
  if (
    new Set(indices).size !== indices.length ||
    indices.some((index) => index < 0 || index >= indices.length)
  )
    throw new Error('Invalid transaction index set.');
  const ledger = structuredClone(previous);
  const id = input.header.hash;
  const prior = ledger.runs.find((run) => run.id === id);
  ledger.sequence++;
  ledger.view = structuredClone(input.view);
  ledger.inputs = [
    ...ledger.inputs.filter((item) => item.header.hash !== id),
    structuredClone(input),
  ];
  const cacheKey = input.chainId + ':' + BigInt(input.header.number);
  const cached = ledger.cache[cacheKey];
  const root = cached?.root ?? receiptRoot(input.receipts);
  const accepted = cached?.accepted ?? root === input.header.receiptsRoot;
  ledger.cache[cacheKey] = { root, accepted };
  const events: VerifiedEvent[] = accepted
    ? input.receipts.flatMap((receipt) =>
        receipt.logs.map((log) => ({
          id:
            input.chainId +
            ':' +
            log.transactionHash +
            ':' +
            Number(BigInt(log.logIndex)),
          blockHash: id,
          blockNumber: BigInt(input.header.number).toString(),
          transactionHash: log.transactionHash,
          logIndex: Number(BigInt(log.logIndex)),
          address: log.address,
          topics: log.topics,
          data: log.data,
          finality: 'pending' as const,
        })),
      )
    : [];
  ledger.runs = [
    ...ledger.runs.filter((run) => run.id !== id),
    {
      id,
      blockNumber: BigInt(input.header.number).toString(),
      expectedRoot: input.header.receiptsRoot,
      observedRoot: root,
      source: input.source,
      sourceLabel: input.sourceLabel,
      capturedAt: input.capturedAt,
      receipts: input.receipts.length,
      logs: events.length,
      attempts: (prior?.attempts ?? 0) + 1,
      cacheHit: !!cached,
      status: accepted ? 'verified' : 'rejected',
      finality: 'pending',
      message: accepted
        ? 'Receipt witness accepted.'
        : 'Receipt root does not match the block header. Evidence retained for retry.',
    },
  ];
  ledger.events = [
    ...ledger.events.filter((event) => event.blockHash !== id),
    ...events,
  ];
  project(ledger);
  return ledger;
}

export function recoverLedger(
  previous: VerificationLedger,
): VerificationLedger {
  let ledger = structuredClone(previous);
  for (const input of previous.inputs) {
    if (
      ledger.runs.find((run) => run.id === input.header.hash)?.status ===
      'verified'
    )
      continue;
    ledger = applyEvidence(ledger, {
      ...input,
      view: previous.view ?? input.view,
    });
  }
  project(ledger);
  return ledger;
}
