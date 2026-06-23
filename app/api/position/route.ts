import { handle, json, rateLimit, requesterKey } from '@/lib/api';
import { normalizeAddress, readPosition } from '@/lib/tydro';
export async function GET(req: Request) {
  return handle(async () => {
    const address = normalizeAddress(
      new URL(req.url).searchParams.get('address'),
    );
    await rateLimit('lookup:' + (await requesterKey(req)), 20);
    return json({ snapshot: await readPosition(address) });
  });
}
