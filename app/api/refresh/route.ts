import { handle, json, userId, sameOrigin, rateLimit } from '@/lib/api';
import { db, state, refreshWatch } from '@/db/store';
export async function POST(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const owner = await userId();
    await rateLimit('refresh:' + owner, 6);
    const watches = await db()
      .prepare('SELECT id FROM watches WHERE owner_id=?')
      .bind(owner)
      .all<{ id: string }>();
    for (let i = 0; i < watches.results.length; i += 3)
      await Promise.all(
        watches.results.slice(i, i + 3).map((w) => refreshWatch(owner, w.id)),
      );
    return json(await state(owner));
  });
}
