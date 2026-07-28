import { body, handle, json, rateLimit, sameOrigin, userId } from '@/lib/api';
import { db } from '@/db/store';
import {
  clearVerification,
  readVerification,
  updateVerification,
} from '@/db/verification';
import { capturedEvidence } from '@/lib/verification/evidence';
import { liveEvidence } from '@/lib/verification/rpc';

export async function GET() {
  return handle(async () => json(await readVerification(db(), await userId())));
}
export async function POST(req: Request) {
  return handle(async () => {
    const owner = await userId();
    sameOrigin(req);
    const input = await body(req);
    await rateLimit('verification:' + owner, 8);
    if (input.action === 'retry')
      return json(await updateVerification(db(), owner));
    if (input.action === 'capture')
      return json(await updateVerification(db(), owner, capturedEvidence()));
    if (input.action !== 'live' || typeof input.blockNumber !== 'string')
      throw new Error('Choose a live block, the Ink capture, or retry.');
    const previous = await readVerification(db(), owner);
    const evidence = await liveEvidence(input.blockNumber, previous.ledger);
    return json(await updateVerification(db(), owner, evidence));
  });
}
export async function DELETE(req: Request) {
  return handle(async () => {
    const owner = await userId();
    sameOrigin(req);
    return json(await clearVerification(db(), owner));
  });
}
