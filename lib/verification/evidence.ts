import capture from './fixtures/recorded-finalized.json' with { type: 'json' };
import type { ReceiptEvidence, ReceiptHeader, Receipt } from './types.ts';

export function capturedEvidence(): ReceiptEvidence {
  const header = structuredClone(capture.block) as ReceiptHeader;
  return {
    chainId: 57073,
    source: 'capture',
    sourceLabel: 'Recorded Ink mainnet · finalized at capture',
    capturedAt: capture.capturedAt,
    header,
    receipts: structuredClone(capture.receipts) as Receipt[],
    view: {
      id: 'capture:' + header.hash,
      safe: { number: header.number, hash: header.hash },
      finalized: { number: header.number, hash: header.hash },
      canonical: { [BigInt(header.number).toString()]: header.hash },
    },
  };
}
