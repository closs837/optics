import {
  handle,
  json,
  userId,
  sameOrigin,
  body,
  ApiError,
  rateLimit,
} from '@/lib/api';
import { validateScenario } from '@/lib/analytics';
import { db, state, ownedWatch } from '@/db/store';
export async function POST(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const owner = await userId(),
      data = await body(req);
    await rateLimit('write:' + owner);
    const w = await ownedWatch(owner, String(data.watchId));
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name || name.length > 48)
      throw new ApiError('Use a scenario name between 1 and 48 characters.');
    const parameters = validateScenario(data);
    const saved = await db()
      .prepare(
        'INSERT INTO scenarios(id,watch_id,name,parameters,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM scenarios WHERE watch_id=?)<8 RETURNING id',
      )
      .bind(
        crypto.randomUUID(),
        w.id,
        name,
        JSON.stringify(parameters),
        Date.now(),
        w.id,
      )
      .first();
    if (!saved) throw new ApiError('You can save up to 8 scenarios per watch.');
    return json(await state(owner), 201);
  });
}
export async function DELETE(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const owner = await userId(),
      data = await body(req);
    await rateLimit('write:' + owner);
    const saved = await db()
      .prepare(
        'SELECT s.id FROM scenarios s JOIN watches w ON w.id=s.watch_id WHERE s.id=? AND w.owner_id=?',
      )
      .bind(String(data.id), owner)
      .first();
    if (!saved) throw new ApiError('Scenario not found.', 404);
    await db()
      .prepare('DELETE FROM scenarios WHERE id=?')
      .bind(String(data.id))
      .run();
    return json(await state(owner));
  });
}
