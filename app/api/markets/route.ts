import { handle, json, rateLimit, requesterKey } from '@/lib/api';
import { readMarkets } from '@/lib/markets';
export async function GET(req: Request) {
  return handle(async () => {
    await rateLimit('markets:' + (await requesterKey(req)), 20);
    return json({ market: await readMarkets() });
  });
}
