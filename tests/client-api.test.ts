import assert from 'node:assert/strict';
import test from 'node:test';
import { api, SessionExpiredError } from '../lib/client-api.ts';

await test('expired sessions start no background sign-in and produce an actionable error', async (t) => {
  for (const response of [
    new Response('Unauthorized', { status: 401 }),
    Response.json({ error: 'Sign-in required.' }, { status: 401 }),
    new Response(null, {
      status: 302,
      headers: { Location: '/auth' },
    }),
    { type: 'opaqueredirect', status: 0 } as Response,
  ]) {
    const fetch = t.mock.method(
      globalThis,
      'fetch',
      async (_path: RequestInfo | URL, options?: RequestInit) => {
        assert.equal(options?.redirect, 'manual');
        assert.equal(options?.credentials, 'same-origin');
        return response;
      },
    );
    await assert.rejects(api('/api/state'), SessionExpiredError);
    fetch.mock.restore();
  }
});

await test('gateway HTML cannot leak a JSON parser error into the workspace', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('<html>Bad gateway</html>', { status: 502 }),
  );
  await assert.rejects(api('/api/state'), /server could not complete/);
});

await test('JSON errors retain their useful API message and successful reads return real data', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      { error: 'Too many requests. Try again in a minute.' },
      { status: 429 },
    ),
  );
  await assert.rejects(api('/api/state'), /Too many requests/);
  fetch.mock.restore();
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ watches: [] }),
  );
  assert.deepEqual(await api('/api/state'), { watches: [] });
});
