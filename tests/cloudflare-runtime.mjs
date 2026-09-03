import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, createFetchMock } from 'miniflare';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

// Runs the actual compiled standalone Worker in workerd with an isolated D1.
// Only the Access signing keys are local fixtures. Chain reads use live RPCs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, '.cloudflare-build');
const manifest = JSON.parse(
  await readFile(path.join(build, 'manifest.json'), 'utf8'),
);
assert.equal(manifest.target, 'cloudflare-access');
const origin = 'https://positions.example.com';
const issuer = 'https://test-team.cloudflareaccess.com';
const audience = 'runtime-test-audience';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = {
  ...(await exportJWK(publicKey)),
  kid: 'runtime-test',
  alg: 'RS256',
  use: 'sig',
};
const outbound = createFetchMock();
outbound
  .get(issuer)
  .intercept({ path: '/cdn-cgi/access/certs' })
  .reply(200, { keys: [jwk] })
  .persist();
const runtime = new Miniflare({
  compatibilityDate: manifest.compatibility_date,
  compatibilityFlags: manifest.compatibility_flags,
  modulesRoot: path.join(build, 'server'),
  modules: [
    manifest.main_module,
    ...manifest.server_modules.filter((name) => name !== manifest.main_module),
  ].map((name) => ({
    type: name.endsWith('.wasm') ? 'CompiledWasm' : 'ESModule',
    path: path.join(build, 'server', name),
  })),
  bindings: {
    APP_ORIGIN: origin,
    ACCESS_TEAM_DOMAIN: new URL(issuer).hostname,
    ACCESS_AUD: audience,
  },
  d1Databases: { DB: 'standalone-runtime-test' },
  assets: {
    directory: path.join(build, 'client'),
    binding: 'ASSETS',
    routerConfig: {
      has_user_worker: true,
      invoke_user_worker_ahead_of_assets: true,
    },
    assetConfig: { html_handling: 'none', not_found_handling: 'none' },
  },
  fetchMock: outbound,
});
async function sign(sub, email) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setSubject(sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}
const first = await sign('first-user', 'first@example.com');
const second = await sign('second-user', 'second@example.com');
async function request(
  route,
  {
    token = first,
    method = 'GET',
    data,
    requestOrigin = origin,
    extraHeaders = {},
  } = {},
) {
  return runtime.dispatchFetch(origin + route, {
    method,
    redirect: 'manual',
    headers: {
      ...(token ? { 'cf-access-jwt-assertion': token } : {}),
      ...(method !== 'GET'
        ? { Origin: requestOrigin, 'Content-Type': 'application/json' }
        : {}),
      ...extraHeaders,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
async function json(route, options) {
  const response = await request(route, options);
  const text = await response.text();
  assert(
    response.headers.get('content-type')?.includes('application/json'),
    `${route}: ${response.status} ${text.slice(0, 300)}`,
  );
  return { status: response.status, data: JSON.parse(text) };
}

try {
  const db = await runtime.getD1Database('DB');
  for (const name of (await readdir(path.join(root, 'drizzle')))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = await readFile(path.join(root, 'drizzle', name), 'utf8');
    for (const statement of sql
      .split('--> statement-breakpoint')
      .filter((text) => text.trim()))
      await db.prepare(statement).run();
  }
  assert.equal(
    (
      await request('/api/state', {
        token: null,
        extraHeaders: {
          'oai-authenticated-user-id': 'cf-access:first-user',
          'oai-authenticated-user-email': 'first@example.com',
        },
      })
    ).status,
    401,
  );
  assert.equal((await request('/api/state', { token: 'forged' })).status, 401);
  const style = manifest.client_files.find((name) => name.endsWith('.css'));
  assert(style, 'Build must include its real styles.');
  assert.equal((await request('/' + style, { token: null })).status, 401);
  assert.equal((await request('/' + style)).status, 200);
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Optics/);
  assert.equal((await json('/api/state')).status, 200);
  assert.equal(
    (
      await json('/api/watches', {
        method: 'POST',
        data: {},
        requestOrigin: 'https://unrelated.example',
      })
    ).status,
    403,
  );
  const address = '0x9138E2cAdFEB23AFFdc0419F2912CaB8F135dba9';
  const created = await json('/api/watches', {
    method: 'POST',
    data: { address, label: 'Runtime test' },
    extraHeaders: {
      'oai-authenticated-user-id': 'cf-access:second-user',
      'oai-authenticated-user-email': 'second@example.com',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.watchId;
  const watch = created.data.watches.find((entry) => entry.id === id);
  assert(watch.latest, watch.lastError ?? 'Expected a live on-chain snapshot.');
  assert(BigInt(watch.latest.blockNumber) > 0n);
  assert.equal(
    (
      await db
        .prepare('SELECT owner_id FROM watches WHERE id=?')
        .bind(id)
        .first()
    ).owner_id,
    'cf-access:first-user',
  );
  assert.equal(
    (await json('/api/state', { token: second })).data.watches.length,
    0,
  );
  assert.equal(
    (
      await json('/api/watches', {
        token: second,
        method: 'DELETE',
        data: { id },
      })
    ).status,
    404,
  );
  assert.equal(
    (await json('/api/state?watchId=' + id, { token: second })).status,
    404,
  );
  const scenario = await json('/api/scenarios', {
    method: 'POST',
    data: {
      watchId: id,
      name: 'Test',
      collateralShock: -20,
      debtShock: 10,
      repayUsd: 100,
      targetHealthFactor: 1.5,
    },
  });
  assert.equal(scenario.status, 201, JSON.stringify(scenario.data));
  assert.equal((await json('/api/state')).data.scenarios.length, 1);
  const markets = await json('/api/markets');
  assert.equal(markets.status, 200, JSON.stringify(markets.data));
  assert(markets.data.market.reserves.length > 0);
  const logout = await request('/signout-with-chatgpt');
  assert.equal(logout.status, 302);
  assert.equal(logout.headers.get('location'), '/cdn-cgi/access/logout');
  assert.equal(
    (
      await request('/signin-with-chatgpt?return_to=https://unrelated.example')
    ).headers.get('location'),
    '/',
  );
  assert.equal(
    (await json('/api/watches', { method: 'DELETE', data: { id } })).status,
    200,
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM snapshots').first()).n,
    0,
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM scenarios').first()).n,
    0,
  );
  console.log(
    JSON.stringify({
      result: 'passed',
      runtime: 'compiled Cloudflare Worker',
      liveBlock: watch.latest.blockNumber,
      reserves: markets.data.market.reserves.length,
      checks: [
        'signed Access JWT',
        'forged identity rejection',
        'private static assets',
        'SSR',
        'D1 migrations and persistence',
        'owner isolation',
        'CSRF rejection',
        'live Ink RPC',
        'scenario persistence',
        'cascading deletion',
        'logout and safe redirect',
      ],
    }),
  );
} finally {
  await runtime.dispose();
  await outbound.close();
}
