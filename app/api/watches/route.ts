import {
  handle,
  json,
  userId,
  sameOrigin,
  body,
  ApiError,
  rateLimit,
} from '@/lib/api';
import { db, state, refreshWatch, ownedWatch } from '@/db/store';
import { normalizeAddress } from '@/lib/tydro';
import { MAX_WATCHES } from '@/lib/market';
export async function POST(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const owner = await userId();
    await rateLimit('write:' + owner);
    const data = await body(req);
    const address = normalizeAddress(data.address).toLowerCase();
    const label =
      (typeof data.label === 'string' ? data.label : '').trim().slice(0, 48) ||
      `${address.slice(0, 6)}…${address.slice(-4)}`;
    const id = crypto.randomUUID();
    await db()
      .prepare(
        'INSERT OR IGNORE INTO watches(id,owner_id,address,label,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM watches WHERE owner_id=?)<?',
      )
      .bind(id, owner, address, label, Date.now(), owner, MAX_WATCHES)
      .run();
    const watch = await db()
      .prepare('SELECT id FROM watches WHERE owner_id=? AND address=?')
      .bind(owner, address)
      .first<{ id: string }>();
    if (!watch)
      throw new ApiError(
        `Your watchlist can hold up to ${MAX_WATCHES} addresses.`,
      );
    await refreshWatch(owner, watch.id);
    return json({ watchId: watch.id, ...(await state(owner)) }, 201);
  });
}
export async function PATCH(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const owner = await userId(),
      data = await body(req);
    await ownedWatch(owner, String(data.id));
    const label = (typeof data.label === 'string' ? data.label : '').trim();
    if (!label || label.length > 48)
      throw new ApiError('Use a label between 1 and 48 characters.');
    await db()
      .prepare('UPDATE watches SET label=? WHERE id=? AND owner_id=?')
      .bind(label, data.id, owner)
      .run();
    return json(await state(owner));
  });
}
export async function DELETE(req: Request) {
  return handle(async () => {
    sameOrigin(req);
    const owner = await userId(),
      data = await body(req);
    await ownedWatch(owner, String(data.id));
    await db()
      .prepare('DELETE FROM watches WHERE id=? AND owner_id=?')
      .bind(data.id, owner)
      .run();
    return json(await state(owner));
  });
}
