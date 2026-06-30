import { handle, json, userId, sameOrigin, body } from '@/lib/api';
import { db, state } from '@/db/store';
export async function PATCH(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const owner = await userId(),
      data = await body(req);
    await db()
      .prepare(
        'UPDATE alerts SET read=1 WHERE (? IS NULL OR id=?) AND (? IS NULL OR watch_id=?) AND watch_id IN (SELECT id FROM watches WHERE owner_id=?)',
      )
      .bind(
        data.id ?? null,
        data.id ?? null,
        data.watchId ?? null,
        data.watchId ?? null,
        owner,
      )
      .run();
    return json(await state(owner));
  });
}
