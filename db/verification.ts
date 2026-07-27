import {
  applyEvidence,
  emptyLedger,
  recoverLedger,
} from '../lib/verification/engine.ts';
import type {
  ReceiptEvidence,
  VerificationLedger,
  VerificationWorkspace,
} from '../lib/verification/types.ts';

type SessionRow = { version: number; data: string; updated_at: number };
export async function readVerification(
  database: D1Database,
  owner: string,
): Promise<VerificationWorkspace> {
  const row = await database
    .prepare(
      'SELECT version,data,updated_at FROM verification_sessions WHERE owner_id=?',
    )
    .bind(owner)
    .first<SessionRow>();
  return {
    receiptAudit: true,
    version: row?.version ?? 0,
    updatedAt: row?.updated_at ?? null,
    ledger: row ? (JSON.parse(row.data) as VerificationLedger) : emptyLedger(),
  };
}

export async function updateVerification(
  database: D1Database,
  owner: string,
  input?: ReceiptEvidence,
) {
  await database
    .prepare(
      'INSERT OR IGNORE INTO verification_sessions(owner_id,version,data,updated_at) VALUES(?,0,?,?)',
    )
    .bind(owner, JSON.stringify(emptyLedger()), Date.now())
    .run();
  for (let attempt = 0; attempt < 4; attempt++) {
    const previous = await readVerification(database, owner);
    if (
      input &&
      previous.ledger.inputs.length >= 8 &&
      !previous.ledger.inputs.some(
        (item) => item.header.hash === input.header.hash,
      )
    )
      throw new Error(
        'Eight evidence blocks are already saved. Export and clear this evidence workspace to start another.',
      );
    const ledger = input
      ? applyEvidence(previous.ledger, input)
      : recoverLedger(previous.ledger);
    const serialized = JSON.stringify(ledger);
    if (new TextEncoder().encode(serialized).length > 1_600_000)
      throw new Error(
        'Evidence storage limit reached. Export and clear this evidence workspace to start another.',
      );
    const updatedAt = Date.now();
    const changed = await database
      .prepare(
        'UPDATE verification_sessions SET version=version+1,data=?,updated_at=? WHERE owner_id=? AND version=? RETURNING version',
      )
      .bind(serialized, updatedAt, owner, previous.version)
      .first<{ version: number }>();
    if (changed)
      return {
        receiptAudit: true as const,
        version: changed.version,
        updatedAt,
        ledger,
      };
  }
  throw new Error('Verification changed concurrently. Retry this request.');
}

export async function clearVerification(database: D1Database, owner: string) {
  // Updating in place preserves the revision fence for concurrent requests.
  await database
    .prepare(
      'UPDATE verification_sessions SET version=version+1,data=?,updated_at=? WHERE owner_id=?',
    )
    .bind(JSON.stringify(emptyLedger()), Date.now(), owner)
    .run();
  return readVerification(database, owner);
}
