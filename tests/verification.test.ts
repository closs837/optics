import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../deploy/node/sqlite.mjs';
import {
  clearVerification,
  readVerification,
  updateVerification,
} from '../db/verification.ts';
import { applyEvidence, emptyLedger } from '../lib/verification/engine.ts';
import type { ReceiptEvidence } from '../lib/verification/types.ts';

const schema = await readFile(
  new URL('../drizzle/0002_verified_activity.sql', import.meta.url),
  'utf8',
);
const fixtures = JSON.parse(
  await readFile(
    new URL(
      '../tests/replay/fixtures.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const ordinary = fixtures.envelopes.a as ReceiptEvidence;

await test('verification persists with owner isolation and concurrent revision fencing', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'position-lens-verification-'),
  );
  const filename = path.join(directory, 'app.sqlite');
  let database = openDatabase(filename);
  const asD1 = () => database as unknown as D1Database;
  try {
    database.raw.exec(schema);
    const [first, second] = await Promise.all([
      updateVerification(asD1(), 'alice', ordinary),
      updateVerification(
        asD1(),
        'alice',
        fixtures.envelopes.q as ReceiptEvidence,
      ),
    ]);
    assert.notEqual(first.version, second.version);
    const saved = await readVerification(asD1(), 'alice');
    assert.equal(saved.ledger.inputs.length, 2);
    assert(saved.ledger.runs.every((run) => run.status === 'verified'));
    assert.equal(saved.receiptAudit, true);
    assert.equal(
      (await readVerification(asD1(), 'bob')).ledger.inputs.length,
      0,
    );
    await clearVerification(asD1(), 'bob');
    assert.deepEqual(await readVerification(asD1(), 'alice'), saved);
    database.close();
    database = openDatabase(filename);
    assert.deepEqual(await readVerification(asD1(), 'alice'), saved);
    const cleared = await clearVerification(asD1(), 'alice');
    assert.equal(cleared.ledger.inputs.length, 0);
    assert(cleared.version > saved.version);
    const after = await updateVerification(asD1(), 'alice', ordinary);
    assert(after.version > cleared.version);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

await test('verification rejects incomplete evidence and leaves input objects untouched', () => {
  const ledger = emptyLedger();
  const input = structuredClone(ordinary);
  const unchanged = structuredClone(input);
  const result = applyEvidence(ledger, input);
  assert.equal(result.runs[0].observedRoot, ordinary.header.receiptsRoot);
  assert.equal(ledger.inputs.length, 0);
  assert.deepEqual(input, unchanged);
  input.receipts.pop();
  assert.throws(() => applyEvidence(ledger, input), /Incomplete/);
  const duplicate = structuredClone(ordinary);
  duplicate.receipts[1].transactionIndex =
    duplicate.receipts[0].transactionIndex;
  assert.throws(() => applyEvidence(ledger, duplicate), /index/);
});
