import {
  handle,
  json,
  userId,
  sameOrigin,
  body,
  ApiError,
  rateLimit,
} from '@/lib/api';
import { db, state, ownedWatch } from '@/db/store';
import { validateRule } from '@/lib/engine';
export async function POST(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const owner = await userId();
    await rateLimit('write:' + owner);
    const data = await body(req),
      watch = await ownedWatch(owner, String(data.watchId)),
      rule = validateRule(data);
    const count = await db()
      .prepare('SELECT COUNT(*) AS n FROM rules WHERE watch_id=?')
      .bind(watch.id)
      .first<{ n: number }>();
    if (count && count.n >= 10)
      throw new ApiError('Use up to 10 rules per watch.');
    await db()
      .prepare(
        'INSERT INTO rules(id,watch_id,metric,comparison,threshold) VALUES(?,?,?,?,?)',
      )
      .bind(
        crypto.randomUUID(),
        watch.id,
        rule.metric,
        rule.comparison,
        rule.threshold,
      )
      .run();
    return json(await state(owner), 201);
  });
}
export async function PATCH(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const owner = await userId(),
      data = await body(req);
    if (typeof data.enabled !== 'boolean')
      throw new ApiError('Expected an enabled setting.');
    await db()
      .prepare(
        'UPDATE rules SET enabled=?,was_matching=0 WHERE id=? AND watch_id IN (SELECT id FROM watches WHERE owner_id=?)',
      )
      .bind(data.enabled ? 1 : 0, data.id, owner)
      .run();
    return json(await state(owner));
  });
}
export async function DELETE(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const owner = await userId(),
      data = await body(req);
    await db()
      .prepare(
        'DELETE FROM rules WHERE id=? AND watch_id IN (SELECT id FROM watches WHERE owner_id=?)',
      )
      .bind(data.id, owner)
      .run();
    return json(await state(owner));
  });
}
