import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as candidate from '../../db/verification.ts';
import { capturedEvidence } from '../../lib/verification/evidence.ts';
import { openDatabase } from '../../deploy/node/sqlite.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
export function observable(ledger) {
  return {
    runs: ledger.runs
      .map(
        ({
          id,
          blockNumber,
          expectedRoot,
          observedRoot,
          status,
          finality,
          receipts,
          logs,
        }) => ({
          id,
          blockNumber,
          expectedRoot,
          observedRoot,
          status,
          finality,
          receipts,
          logs,
        }),
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
    events: [...ledger.events].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
function shuffled(values, seed) {
  const result = structuredClone(values);
  let x = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export async function runSuite({
  seeds = [731, 2027, 81031],
  smoke = false,
  store = candidate,
  output,
} = {}) {
  const suite = JSON.parse(
    await readFile(
      path.join(root, 'tests/replay/fixtures.json'),
      'utf8',
    ),
  );
  const directory =
    output ??
    path.join(
      root,
      'outputs/verification-replay',
      new Date().toISOString().replaceAll(':', '-') +
        '-' +
        crypto.randomUUID().slice(0, 8),
    );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const schema = await readFile(
    path.join(root, 'drizzle/0002_verified_activity.sql'),
    'utf8',
  );
  const outcomes = [];
  for (const seed of seeds)
    for (const item of suite.cases.filter((test) => !smoke || test.smoke)) {
      const label = item.id + '-' + seed;
      const filename = path.join(directory, label + '.sqlite');
      let db = openDatabase(filename);
      db.raw.exec(schema);
      const owner = 'audit-operator';
      if (item.initial)
        await db
          .prepare(
            'INSERT INTO verification_sessions(owner_id,version,data,updated_at) VALUES(?,0,?,0)',
          )
          .bind(owner, JSON.stringify(item.initial))
          .run();
      const failures = [];
      const trace = [];
      try {
        for (const [index, step] of item.steps.entries()) {
          if (step.action === 'restart') {
            db.close();
            db = openDatabase(filename);
            trace.push({ step: index, action: 'database-reopened' });
            continue;
          }
          let input;
          if (step.action === 'verify') {
            input =
              step.evidence === 'c'
                ? capturedEvidence()
                : structuredClone(suite.envelopes[step.evidence]);
            if (step.shuffle) input.receipts = shuffled(input.receipts, seed);
          }
          const result = await store.updateVerification(db, owner, input);
          const actual = observable(result.ledger);
          trace.push({
            step: index,
            action: step.action,
            version: result.version,
            state: actual,
          });
          try {
            assert.deepEqual(actual, step.expected);
            if (step.cacheHit)
              assert.equal(
                result.ledger.runs.at(-1)?.cacheHit,
                true,
                'An identical witness must reuse the computation.',
              );
          } catch (error) {
            failures.push({ step: index, message: error.message });
          }
          // Evidence and projection must survive a fresh read through the application store.
          assert.deepEqual(await store.readVerification(db, owner), result);
          assert.equal(
            (await store.readVerification(db, 'another-owner')).ledger.inputs
              .length,
            0,
          );
        }
      } catch (error) {
        failures.push({ message: error.stack });
      } finally {
        db.close();
      }
      const result = {
        case: item.id,
        seed,
        passed: failures.length === 0,
        failures,
      };
      outcomes.push(result);
      await writeFile(
        path.join(directory, label + '.json'),
        JSON.stringify(
          { receiptAudit: true, ...result, trace },
          null,
          2,
        ) + '\n',
      );
    }
  const summary = {
    receiptAudit: true,
    cases: outcomes.length,
    passed: outcomes.filter((item) => item.passed).length,
    failed: outcomes.filter((item) => !item.passed).length,
    directory,
    outcomes: outcomes.map(({ failures: _failures, ...item }) => item),
  };
  await writeFile(
    path.join(directory, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  return summary;
}
