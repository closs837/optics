import { getChatGPTUser } from '@/app/chatgpt-auth';
import { db } from '@/db/store';
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function userId() {
  const user = await getChatGPTUser();
  if (!user) throw new ApiError('Sign in to save watches and alerts.', 401);
  return user.userId;
}
export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin)
    throw new ApiError('This action must come from Optics.', 403);
}
export async function body(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    throw new ApiError('Expected JSON.');
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError('Expected a JSON body.');
  let text = '',
    size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new ApiError('Request is too large.', 413);
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0;
    return v;
  } catch {
    throw new ApiError('Invalid JSON.');
  }
}
export async function rateLimit(key: string, max = 30) {
  const bucket = Math.floor(Date.now() / 60_000);
  const r = await db()
    .prepare(
      'INSERT INTO rate_limits(key,bucket,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN bucket=excluded.bucket THEN count+1 ELSE 1 END,bucket=excluded.bucket RETURNING count',
    )
    .bind(key, bucket)
    .first<{ count: number }>();
  if (r && r.count > max)
    throw new ApiError('Too many checks. Try again in a minute.', 429);
  // Bound rate-limit keys without retaining raw IP addresses.
  await db()
    .prepare('DELETE FROM rate_limits WHERE bucket<?')
    .bind(bucket - 5)
    .run();
}
export async function requesterKey(req: Request) {
  const raw = req.headers.get('cf-connecting-ip') ?? 'local';
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(raw + Math.floor(Date.now() / 86400_000)),
  );
  return Array.from(new Uint8Array(bytes))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    const message = e instanceof Error ? e.message : 'Something went wrong.';
    if (message === 'Watch not found.') return json({ error: message }, 404);
    if (/SQLITE|D1_|binding|database/i.test(message)) {
      console.error('Database request failed');
      return json(
        { error: 'Saved data is temporarily unavailable. Please try again.' },
        503,
      );
    }
    return json({ error: message }, 400);
  }
}
