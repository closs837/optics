import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authenticateAccess, safeReturnPath } from '../deploy/access.ts';

const config = {
  ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com',
  ACCESS_AUD: 'test-audience',
  APP_ORIGIN: 'https://positions.example.com',
};
const issuer = 'https://' + config.ACCESS_TEAM_DOMAIN;
const { privateKey, publicKey } = await generateKeyPair('RS256');
const key = {
  ...(await exportJWK(publicKey)),
  kid: 'test-key',
  alg: 'RS256',
  use: 'sig',
};
const keys = createLocalJWKSet({ keys: [key] });
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    sub: 'user-1',
    email: 'first@example.com',
    iss: issuer,
    aud: config.ACCESS_AUD,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: key.kid })
    .sign(privateKey);
}
function request(assertion?: string, url = config.APP_ORIGIN + '/api/state') {
  return new Request(url, {
    headers: {
      ...(assertion ? { 'cf-access-jwt-assertion': assertion } : {}),
      'oai-authenticated-user-id': 'another-owner',
      'oai-authenticated-user-email': 'forged@example.com',
      'oai-authenticated-user-full-name': 'Forged name',
      'oai-unrecognized-header': 'untrusted',
    },
  });
}

await test('only a verified Access identity can become the app owner', async () => {
  const original = new Request(request(await token()), {
    method: 'POST',
    body: '{"test":true}',
  });
  const result = await authenticateAccess(original, config, keys);
  assert(result instanceof Request);
  assert.equal(
    result.headers.get('oai-authenticated-user-id'),
    'cf-access:user-1',
  );
  assert.equal(
    result.headers.get('oai-authenticated-user-email'),
    'first@example.com',
  );
  assert.equal(result.headers.get('oai-authenticated-user-full-name'), null);
  assert.equal(result.headers.get('oai-unrecognized-header'), null);
  assert.equal(await result.text(), '{"test":true}');
});

await test('missing, forged, expired and wrong-application assertions fail closed', async () => {
  const signed = await token();
  const [header, , signature] = signed.split('.');
  const tampered = [
    header,
    Buffer.from(
      JSON.stringify({ sub: 'attacker', email: 'attacker@example.com' }),
    ).toString('base64url'),
    signature,
  ].join('.');
  for (const assertion of [
    undefined,
    'not-a-jwt',
    tampered,
    await token({ exp: 1 }),
    await token({ aud: 'different-application' }),
    await token({ iss: 'https://other.cloudflareaccess.com' }),
    await token({ email: undefined }),
    await token({ sub: '' }),
    await token({ nbf: Math.floor(Date.now() / 1000) + 120 }),
  ]) {
    const result = await authenticateAccess(request(assertion), config, keys);
    assert(result instanceof Response);
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
  }
});

await test('incorrect hostname or incomplete configuration never reaches the app', async () => {
  const signed = await token();
  for (const [runtime, url, status] of [
    [config, 'https://alternate.workers.dev/api/state', 403],
    [{ ...config, ACCESS_AUD: '' }, config.APP_ORIGIN, 503],
    [
      { ...config, ACCESS_TEAM_DOMAIN: 'untrusted.example' },
      config.APP_ORIGIN,
      503,
    ],
    [
      { ...config, APP_ORIGIN: 'http://positions.example.com' },
      config.APP_ORIGIN,
      503,
    ],
  ] as const) {
    const result = await authenticateAccess(
      request(signed, url),
      runtime,
      keys,
    );
    assert(result instanceof Response);
    assert.equal(result.status, status);
  }
});

await test('sign-in returns only to a same-origin non-auth path', () => {
  for (const value of [
    null,
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/signin-with-chatgpt?return_to=/',
    '/signout-with-chatgpt',
    '/callback',
  ])
    assert.equal(safeReturnPath(value, config.APP_ORIGIN), '/');
  assert.equal(
    safeReturnPath('/about?from=login#details', config.APP_ORIGIN),
    '/about?from=login#details',
  );
});
