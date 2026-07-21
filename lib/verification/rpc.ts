import { MARKET } from '../market.ts';
import type {
  Hex,
  Receipt,
  ReceiptEvidence,
  ReceiptHeader,
  VerificationLedger,
} from './types.ts';

const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const bytesPattern = /^0x(?:[0-9a-fA-F]{2})*$/;
const quantityPattern = /^0x[0-9a-fA-F]+$/;
let nextId = 0;
async function rpc<T>(
  url: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const id = ++nextId;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error('Ink RPC returned HTTP ' + response.status + '.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Ink RPC returned no body.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 900_000) {
        await reader.cancel();
        throw new Error('This block exceeds the receipt evidence size limit.');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (result.id !== id || result.error || result.result == null)
    throw new Error(
      'Ink RPC could not supply ' + method + ' evidence. Try again later.',
    );
  return result.result as T;
}

function header(value: ReceiptHeader): ReceiptHeader {
  if (
    !value ||
    !hashPattern.test(value.hash) ||
    !hashPattern.test(value.parentHash) ||
    !hashPattern.test(value.receiptsRoot) ||
    !quantityPattern.test(value.number) ||
    !quantityPattern.test(value.timestamp) ||
    !Array.isArray(value.transactions) ||
    value.transactions.some(
      (hash) => typeof hash !== 'string' || !hashPattern.test(hash),
    )
  )
    throw new Error('Unsupported block header.');
  return {
    number: value.number,
    hash: value.hash,
    parentHash: value.parentHash,
    receiptsRoot: value.receiptsRoot,
    timestamp: value.timestamp,
    transactions: value.transactions,
  };
}

function receipts(values: Receipt[]): Receipt[] {
  if (!Array.isArray(values) || values.length > 256)
    throw new Error('Invalid receipt response.');
  let logCount = 0;
  return values.map((receipt) => {
    if (
      !receipt ||
      !quantityPattern.test(receipt.type) ||
      BigInt(receipt.type) > 127n ||
      !['0x0', '0x1'].includes(receipt.status) ||
      !quantityPattern.test(receipt.cumulativeGasUsed) ||
      !quantityPattern.test(receipt.transactionIndex) ||
      !quantityPattern.test(receipt.blockNumber) ||
      !hashPattern.test(receipt.transactionHash) ||
      !hashPattern.test(receipt.blockHash) ||
      !/^0x[0-9a-fA-F]{512}$/.test(receipt.logsBloom) ||
      !Array.isArray(receipt.logs)
    )
      throw new Error('Malformed Ink receipt.');
    for (const key of ['depositNonce', 'depositReceiptVersion'] as const)
      if (receipt[key] !== undefined && !quantityPattern.test(receipt[key]))
        throw new Error('Malformed deposit receipt.');
    logCount += receipt.logs.length;
    if (logCount > 1024) throw new Error('This block exceeds the log limit.');
    const logs = receipt.logs.map((log) => {
      if (
        !log ||
        !/^0x[0-9a-fA-F]{40}$/.test(log.address) ||
        !bytesPattern.test(log.data) ||
        !Array.isArray(log.topics) ||
        log.topics.length > 4 ||
        log.topics.some((topic) => !hashPattern.test(topic)) ||
        !hashPattern.test(log.transactionHash) ||
        !hashPattern.test(log.blockHash) ||
        !quantityPattern.test(log.logIndex)
      )
        throw new Error('Malformed receipt log.');
      return {
        address: log.address,
        topics: log.topics,
        data: log.data,
        transactionHash: log.transactionHash,
        blockHash: log.blockHash,
        logIndex: log.logIndex,
      };
    });
    return {
      type: receipt.type,
      status: receipt.status,
      cumulativeGasUsed: receipt.cumulativeGasUsed,
      logsBloom: receipt.logsBloom,
      logs,
      transactionIndex: receipt.transactionIndex,
      transactionHash: receipt.transactionHash,
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber,
      ...(receipt.depositNonce === undefined
        ? {}
        : { depositNonce: receipt.depositNonce }),
      ...(receipt.depositReceiptVersion === undefined
        ? {}
        : { depositReceiptVersion: receipt.depositReceiptVersion }),
    };
  });
}

export async function liveEvidence(
  block: string,
  previous: VerificationLedger,
): Promise<ReceiptEvidence> {
  if (
    block !== 'finalized' &&
    (!/^[0-9]{1,12}$/.test(block) || BigInt(block) <= 0n)
  )
    throw new Error('Enter a positive block number or finalized.');
  const selector =
    block === 'finalized' ? block : '0x' + BigInt(block).toString(16);
  const [chainA, chainB, raw, safeRaw, finalizedRaw] = await Promise.all([
    rpc<Hex>(MARKET.rpc[0], 'eth_chainId', []),
    rpc<Hex>(MARKET.rpc[1], 'eth_chainId', []),
    rpc<ReceiptHeader>(MARKET.rpc[0], 'eth_getBlockByNumber', [
      selector,
      false,
    ]),
    rpc<ReceiptHeader>(MARKET.rpc[1], 'eth_getBlockByNumber', ['safe', false]),
    rpc<ReceiptHeader>(MARKET.rpc[1], 'eth_getBlockByNumber', [
      'finalized',
      false,
    ]),
  ]);
  if (BigInt(chainA) !== 57073n || BigInt(chainB) !== 57073n)
    throw new Error('RPC chain mismatch.');
  const blockHeader = header(raw),
    safe = header(safeRaw),
    finalized = header(finalizedRaw);
  if (blockHeader.transactions.length > 256)
    throw new Error('Choose a block with at most 256 transactions.');
  const heights = [
    ...new Set([
      ...previous.inputs.map((input) => input.header.number),
      blockHeader.number,
    ]),
  ];
  const [rawReceipts, canonicalHeaders] = await Promise.all([
    rpc<Receipt[]>(MARKET.rpc[0], 'eth_getBlockReceipts', [blockHeader.hash]),
    Promise.all(
      heights.map((height) =>
        rpc<ReceiptHeader>(MARKET.rpc[1], 'eth_getBlockByNumber', [
          height,
          false,
        ]).then(header),
      ),
    ),
  ]);
  const evidence: ReceiptEvidence = {
    chainId: 57073,
    source: 'live',
    sourceLabel: 'Ink RPC · Gelato receipts / QuickNode canonical view',
    capturedAt: new Date().toISOString(),
    header: blockHeader,
    receipts: receipts(rawReceipts),
    view: {
      id: crypto.randomUUID(),
      safe: { number: safe.number, hash: safe.hash },
      finalized: { number: finalized.number, hash: finalized.hash },
      canonical: Object.fromEntries(
        canonicalHeaders.map((entry) => [
          BigInt(entry.number).toString(),
          entry.hash,
        ]),
      ),
    },
  };
  if (new TextEncoder().encode(JSON.stringify(evidence)).length > 500_000)
    throw new Error('This block exceeds the evidence size limit.');
  return evidence;
}
