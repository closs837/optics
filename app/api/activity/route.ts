import { handle, json, rateLimit, requesterKey } from '@/lib/api';
import { readActivity } from '@/lib/activity';
import { normalizeAddress } from '@/lib/tydro';
export async function GET(req: Request) {
  return handle(async () => {
    const params = new URL(req.url).searchParams;
    const address = normalizeAddress(params.get('address'));
    await rateLimit('activity:' + (await requesterKey(req)), 8);
    return json(await readActivity(address, params.get('before') ?? undefined));
  });
}
