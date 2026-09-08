import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:https';
import { createServer as tcpServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { configuration } from '../deploy/lightsail/render-config.mjs';
import { authBinaries } from './auth-binaries.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, '.lightsail-build/app');
await readFile(path.join(app, 'dist/server/index.js'));
const binaries = await authBinaries(root);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'optics-oidc-'));
const children = new Set();
let provider;
let logs = '';
let assertions = 0;
function checked(label) {
  assertions++;
  console.log('PASS ' + label);
}
async function freePort() {
  const server = tcpServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function start(binary, args, options = {}) {
  const child = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  children.add(child);
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  return child;
}
async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit');
    child.kill('SIGTERM');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await ended;
    clearTimeout(deadline);
  }
  children.delete(child);
}
async function ready(check, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if (await check()) return;
    } catch {
      /* still starting */
    }
    if (child.exitCode !== null) break;
    await delay(100);
  }
  throw new Error('Auth stack failed readiness checks.');
}

try {
  const certificate = path.join(temporary, 'localhost.pem');
  const privateKeyFile = path.join(temporary, 'localhost.key');
  const opensslConfig = path.join(temporary, 'openssl.cnf');
  await writeFile(
    opensslConfig,
    '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Optics local auth test\n[ext]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n',
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-config',
      opensslConfig,
      '-keyout',
      privateKeyFile,
      '-out',
      certificate,
    ],
    { stdio: 'ignore' },
  );
  const cert = await readFile(certificate);
  const key = await readFile(privateKeyFile);
  const appPort = await freePort(),
    proxyPort = await freePort(),
    httpsPort = await freePort();
  const origin = `https://127.0.0.1:${httpsPort}`;
  const clientId = 'optics-local-test',
    clientSecret = randomBytes(32).toString('hex');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: 'local-signing-key',
    alg: 'RS256',
    use: 'sig',
  };
  const codes = new Map(),
    tokens = new Map();
  let identity = { sub: 'first-subject', email: 'first@example.com' };
  let redemptions = 0;
  // This local issuer is a test fixture. Caddy, OAuth2 Proxy, cookies, PKCE,
  // signature verification, the compiled application and SQLite are all real.
  provider = createServer({ key, cert }, async (req, res) => {
    const json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, issuer);
      if (url.pathname === '/.well-known/openid-configuration')
        return json({
          issuer,
          authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token',
          jwks_uri: issuer + '/jwks',
          userinfo_endpoint: issuer + '/userinfo',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: [
            'client_secret_basic',
            'client_secret_post',
          ],
          code_challenge_methods_supported: ['S256'],
          scopes_supported: ['openid', 'email', 'profile'],
        });
      if (url.pathname === '/jwks') return json({ keys: [jwk] });
      if (url.pathname === '/authorize') {
        const params = Object.fromEntries(url.searchParams);
        assert.equal(params.client_id, clientId);
        assert.equal(params.redirect_uri, origin + '/oauth2/callback');
        assert.equal(params.response_type, 'code');
        assert.equal(params.code_challenge_method, 'S256');
        assert(params.state && params.nonce && params.code_challenge);
        const code = randomBytes(24).toString('hex');
        codes.set(code, { ...params, identity: { ...identity } });
        const callback = new URL(params.redirect_uri);
        callback.searchParams.set('code', code);
        callback.searchParams.set('state', params.state);
        res.writeHead(302, { Location: callback.href });
        return res.end();
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const params = new URLSearchParams(body);
        const authorization = Buffer.from(
          (req.headers.authorization ?? '').replace(/^Basic /, ''),
          'base64',
        ).toString();
        assert(
          authorization === clientId + ':' + clientSecret ||
            (params.get('client_id') === clientId &&
              params.get('client_secret') === clientSecret),
        );
        assert.equal(params.get('grant_type'), 'authorization_code');
        const code = codes.get(params.get('code'));
        assert(code, 'Code must exist and be single use.');
        codes.delete(params.get('code'));
        assert.equal(params.get('redirect_uri'), code.redirect_uri);
        assert.equal(
          createHash('sha256')
            .update(params.get('code_verifier'))
            .digest('base64url'),
          code.code_challenge,
        );
        redemptions++;
        const user = code.identity;
        const idToken = await new SignJWT({
          sub: user.sub,
          email: user.email,
          email_verified: user.verified ?? true,
          nonce: user.badNonce ? 'wrong-nonce' : code.nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
          .setIssuer(user.badIssuer ? issuer + '/wrong' : issuer)
          .setAudience(user.badAudience ? 'wrong-client' : clientId)
          .setIssuedAt()
          .setExpirationTime(user.expired ? 1 : '1h')
          .sign(user.badSignature ? otherKey : privateKey);
        const accessToken = randomBytes(24).toString('hex');
        tokens.set(accessToken, user);
        return json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken,
        });
      }
      if (url.pathname === '/userinfo') {
        const user = tokens.get(
          (req.headers.authorization ?? '').replace(/^Bearer /, ''),
        );
        if (!user) return json({ error: 'unauthorized' }, 401);
        return json({
          sub: user.sub,
          email: user.email,
          email_verified: user.verified ?? true,
        });
      }
      json({ error: 'not_found' }, 404);
    } catch (error) {
      logs += '\nTest issuer: ' + error.message;
      json({ error: 'invalid_request' }, 400);
    }
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const issuer = `https://127.0.0.1:${provider.address().port}`;
  const config = configuration(
    {
      origin,
      acme_email: 'ops@example.com',
      oidc_issuer_url: issuer,
      oidc_client_id: clientId,
      oidc_client_secret: clientSecret,
      allowed_emails: ['first@example.com', 'second@example.com'],
    },
    randomBytes(32).toString('base64url'),
  );
  await writeFile(path.join(temporary, 'runtime.json'), config.runtime);
  await writeFile(path.join(temporary, 'allowed-emails'), config.emails);
  const proxyConfig =
    config.proxy
      .replace('127.0.0.1:4180', `127.0.0.1:${proxyPort}`)
      .replace('127.0.0.1:3000', `127.0.0.1:${appPort}`)
      .replace(
        '/etc/position-lens/allowed-emails',
        path.join(temporary, 'allowed-emails'),
      ) + `provider_ca_files = [${JSON.stringify(certificate)}]\n`;
  const proxyFile = path.join(temporary, 'oauth2-proxy.cfg');
  await writeFile(proxyFile, proxyConfig);
  const caddyFile = path.join(temporary, 'Caddyfile');
  await writeFile(
    caddyFile,
    config.caddy
      .replace('admin off', 'admin off\n  auto_https disable_redirects')
      .replace('/srv/position-lens-data/caddy', path.join(temporary, 'caddy'))
      .replace(
        'encode zstd gzip',
        `bind 127.0.0.1\n  tls ${certificate} ${privateKeyFile}\n  encode zstd gzip`,
      )
      .replace('127.0.0.1:4180', `127.0.0.1:${proxyPort}`),
  );
  const appEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(appPort),
    POSITION_LENS_CONFIG: path.join(temporary, 'runtime.json'),
    DATABASE_PATH: path.join(temporary, 'app.sqlite'),
  };
  execFileSync(process.execPath, ['deploy/node/migrate.mjs'], {
    cwd: app,
    env: appEnv,
    stdio: 'pipe',
  });
  const startApp = () =>
    start(process.execPath, ['deploy/node/server.mjs'], {
      cwd: app,
      env: appEnv,
    });
  let appChild = startApp();
  await ready(
    async () => (await fetch(`http://127.0.0.1:${appPort}/_health`)).ok,
    appChild,
  );
  const proxy = start(binaries.oauth2Proxy, ['--config', proxyFile]);
  await ready(
    async () => (await fetch(`http://127.0.0.1:${proxyPort}/ready`)).ok,
    proxy,
  );
  const caddy = start(
    binaries.caddy,
    ['run', '--config', caddyFile, '--adapter', 'caddyfile'],
    {
      env: {
        ...process.env,
        XDG_DATA_HOME: temporary,
        XDG_CONFIG_HOME: temporary,
      },
    },
  );

  async function send(
    route,
    {
      jar = new Map(),
      method = 'GET',
      data,
      headers = {},
      originHeader = origin,
    } = {},
  ) {
    const url = new URL(route, origin);
    assert(
      [origin, issuer].includes(url.origin),
      'Test must stay on its local HTTPS services.',
    );
    const body = data === undefined ? undefined : JSON.stringify(data);
    const response = await new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          ca: cert,
          method,
          headers: {
            ...(url.origin === origin && jar.size
              ? { Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; ') }
              : {}),
            ...(body
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(body),
                  Origin: originHeader,
                }
              : {}),
            ...headers,
          },
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, text }),
          );
        },
      );
      req.setTimeout(60_000, () =>
        req.destroy(new Error('HTTP request timed out.')),
      );
      req.on('error', reject);
      req.end(body);
    });
    if (url.origin === origin)
      for (const cookie of response.headers['set-cookie'] ?? []) {
        assert.match(cookie, /; secure/i);
        assert.match(cookie, /; httponly/i);
        assert.match(cookie, /; samesite=lax/i);
        assert.match(cookie, /; path=\//i);
        assert.doesNotMatch(cookie, /; domain=/i);
        const first = cookie.split(';')[0],
          split = first.indexOf('=');
        const name = first.slice(0, split),
          value = first.slice(split + 1);
        if (!value || /max-age=-?0|expires=Thu, 01 Jan 1970/i.test(cookie))
          jar.delete(name);
        else jar.set(name, value);
      }
    if (response.headers['content-type']?.includes('application/json'))
      response.data = JSON.parse(response.text);
    return response;
  }
  await ready(
    async () => (await send('/oauth2/sign_in')).status === 200,
    caddy,
  );
  async function callbackFor(user, jar) {
    identity = user;
    const started = await send('/oauth2/start?rd=%2F', { jar });
    assert.equal(started.status, 302);
    const authorized = await send(started.headers.location);
    assert.equal(authorized.status, 302);
    return authorized.headers.location;
  }
  async function login(user) {
    const jar = new Map();
    const callback = await callbackFor(user, jar);
    const result = await send(callback, { jar });
    assert.equal(
      result.status,
      302,
      'Valid callback must establish a session.',
    );
    assert(jar.has('__Host-position_lens'));
    return jar;
  }
  const firstIdentity = { sub: 'first-subject', email: 'first@example.com' };
  const secondIdentity = { sub: 'second-subject', email: 'second@example.com' };
  const spoof = {
    'X-Forwarded-User': firstIdentity.sub,
    'X-Forwarded-Email': firstIdentity.email,
    'oai-authenticated-user-id': 'forged-owner',
    'oai-authenticated-user-email': firstIdentity.email,
  };
  assert.equal((await send('/api/state', { headers: spoof })).status, 401);
  assert.equal((await send('/_health')).status, 404);
  checked('anonymous APIs and forged identity headers cannot enter the app');
  const first = await login(firstIdentity);
  assert.equal((await send('/', { jar: first })).status, 200);
  assert.deepEqual((await send('/api/state', { jar: first })).data.watches, []);
  assert(redemptions > 0);
  checked(
    'authorization code + PKCE + signed OIDC token creates a secure session',
  );
  const created = await send('/api/watches', {
    jar: first,
    method: 'POST',
    data: {
      address: '0x9138E2cAdFEB23AFFdc0419F2912CaB8F135dba9',
      label: 'OIDC persistent watch',
    },
  });
  assert.equal(created.status, 201, created.text);
  const watchId = created.data.watchId;
  const second = await login(secondIdentity);
  assert.equal(
    (await send('/api/state', { jar: second, headers: spoof })).data.watches
      .length,
    0,
  );
  assert.equal(
    (
      await send('/api/watches', {
        jar: second,
        method: 'DELETE',
        data: { id: watchId },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await send('/api/watches', {
        jar: first,
        method: 'PATCH',
        data: { id: watchId, label: 'Cross origin' },
        originHeader: 'https://evil.example',
      })
    ).status,
    403,
  );
  const reusedEmail = await login({
    ...firstIdentity,
    sub: 'different-person-same-email',
  });
  assert.equal(
    (await send('/api/state', { jar: reusedEmail })).data.watches.length,
    0,
  );
  checked(
    'two real sessions isolate saved records; email reuse and header spoofing cannot change ownership',
  );
  await stop(appChild);
  appChild = startApp();
  await ready(
    async () => (await fetch(`http://127.0.0.1:${appPort}/_health`)).ok,
    appChild,
  );
  assert.equal(
    (await send('/api/state', { jar: first })).data.watches[0].id,
    watchId,
  );
  checked('saved data and the existing session survive an application restart');
  for (const { label, overrides } of [
    {
      label: 'email outside allowlist',
      overrides: { email: 'outsider@example.com' },
    },
    { label: 'unverified email', overrides: { verified: false } },
    { label: 'invalid token signature', overrides: { badSignature: true } },
    { label: 'wrong nonce', overrides: { badNonce: true } },
    { label: 'wrong audience', overrides: { badAudience: true } },
    { label: 'wrong issuer', overrides: { badIssuer: true } },
    { label: 'expired token', overrides: { expired: true } },
  ]) {
    const jar = new Map();
    const callback = await callbackFor({ ...firstIdentity, ...overrides }, jar);
    const result = await send(callback, { jar });
    assert(result.status >= 400, label);
    assert.equal((await send('/api/state', { jar })).status, 401, label);
    checked(label + ' is rejected');
  }
  const stateJar = new Map();
  const altered = new URL(await callbackFor(firstIdentity, stateJar));
  altered.searchParams.set('state', 'tampered-state:/');
  assert.equal((await send(altered.href, { jar: stateJar })).status, 403);
  assert.equal((await send('/api/state', { jar: stateJar })).status, 401);
  const replayJar = new Map();
  const callback = await callbackFor(firstIdentity, replayJar);
  assert.equal((await send(callback, { jar: replayJar })).status, 302);
  assert((await send(callback, { jar: replayJar })).status >= 400);
  checked('tampered state and replayed callbacks are rejected');
  const tampered = new Map(first);
  tampered.set(
    '__Host-position_lens',
    tampered.get('__Host-position_lens') + 'tampered',
  );
  assert.equal((await send('/api/state', { jar: tampered })).status, 401);
  // Shorten only the test proxy's cookie lifetime to exercise real expiration.
  await stop(proxy);
  await writeFile(
    proxyFile,
    proxyConfig
      .replace('cookie_expire = "12h"', 'cookie_expire = "1s"')
      .replace('cookie_refresh = "1h"', 'cookie_refresh = "0"'),
  );
  const shortProxy = start(binaries.oauth2Proxy, ['--config', proxyFile]);
  await ready(
    async () => (await fetch(`http://127.0.0.1:${proxyPort}/ready`)).ok,
    shortProxy,
  );
  const shortSession = await login(firstIdentity);
  assert.equal((await send('/api/state', { jar: shortSession })).status, 200);
  await delay(2100);
  const expired = await send('/api/state', { jar: shortSession });
  assert.equal(expired.status, 401);
  assert(
    !expired.headers.location,
    'Expired API session must not redirect fetch to an HTML login page.',
  );
  checked(
    'tampered and expired session cookies return 401 without an API redirect',
  );
  const logoutSession = await login(firstIdentity);
  const logout = await send('/signout-with-chatgpt?return_to=/', {
    jar: logoutSession,
  });
  assert.equal(logout.status, 302);
  const signedOut = await send(logout.headers.location, { jar: logoutSession });
  assert([200, 302].includes(signedOut.status));
  assert(!logoutSession.has('__Host-position_lens'));
  assert.equal((await send('/api/state', { jar: logoutSession })).status, 401);
  checked(
    'application sign-out clears the session and denies subsequent API access',
  );
  console.log(
    `Auth integration passed: ${assertions} checks through real Caddy + OAuth2 Proxy + Node + SQLite.`,
  );
} catch (error) {
  // Logs contain only this test's generated credentials/tokens. Keep them local
  // and ephemeral; do not print cookie or token values in CI output.
  await writeFile(path.join(root, 'work/auth-test-failure.log'), logs, {
    mode: 0o600,
  });
  throw error;
} finally {
  for (const child of [...children].reverse()) await stop(child);
  if (provider)
    await new Promise((resolve) => {
      provider.close(resolve);
      provider.closeAllConnections();
    });
  await rm(temporary, { recursive: true, force: true });
}
