import { concatHex, keccak256, toHex, toRlp } from 'viem';
import type { Hex, Receipt } from './types.ts';

type RlpValue = Hex | RlpValue[];
export function scalar(value: string | number | bigint): Hex {
  const n = BigInt(value);
  if (n < 0n) throw new Error('Negative RLP integer.');
  if (n === 0n) return '0x';
  const hex = n.toString(16);
  return ('0x' + hex.padStart(hex.length + (hex.length % 2), '0')) as Hex;
}
export function encodeReceipt(receipt: Receipt): Hex {
  const body: RlpValue[] = [
    scalar(receipt.status),
    scalar(receipt.cumulativeGasUsed),
    receipt.logsBloom,
    receipt.logs.map((log) => [log.address, log.topics, log.data]),
  ];
  const payload = toRlp(body);
  return BigInt(receipt.type) === 0n
    ? payload
    : concatHex([toHex(BigInt(receipt.type), { size: 1 }), payload]);
}

function nibbles(value: Hex) {
  return Array.from(value.slice(2), (character) =>
    Number.parseInt(character, 16),
  );
}
function compact(path: number[], leaf: boolean): Hex {
  const odd = path.length % 2;
  const values = odd
    ? [2 * Number(leaf) + 1, ...path]
    : [2 * Number(leaf), 0, ...path];
  return ('0x' + values.map((n) => n.toString(16)).join('')) as Hex;
}
type Entry = { path: number[]; value: Hex };
function child(node: RlpValue[]): RlpValue {
  const encoded = toRlp(node);
  return (encoded.length - 2) / 2 < 32 ? node : keccak256(encoded);
}
function node(entries: Entry[], depth: number): RlpValue[] {
  if (entries.length === 1)
    return [compact(entries[0].path.slice(depth), true), entries[0].value];
  let shared = depth;
  while (
    entries[0].path.length > shared &&
    entries.every((entry) => entry.path[shared] === entries[0].path[shared])
  )
    shared++;
  if (shared > depth)
    return [
      compact(entries[0].path.slice(depth, shared), false),
      child(node(entries, shared)),
    ];
  const branch: RlpValue[] = Array.from({ length: 17 }, () => '0x');
  for (let i = 0; i < 16; i++) {
    const subset = entries.filter((entry) => entry.path[depth] === i);
    if (subset.length) branch[i] = child(node(subset, depth + 1));
  }
  branch[16] =
    entries.find((entry) => entry.path.length === depth)?.value ?? '0x';
  return branch;
}
export function receiptRoot(receipts: Receipt[]): Hex {
  if (!receipts.length) return keccak256(toRlp('0x'));
  const entries = receipts.map((receipt, index) => ({
    path: nibbles(index === 0 ? '0x80' : scalar(index)),
    value: encodeReceipt(receipt),
  }));
  return keccak256(toRlp(node(entries, 0)));
}
