import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { configuration } from '../deploy/lightsail/render-config.mjs';
import { openDatabase } from '../deploy/node/sqlite.mjs';
import { authBinaries } from './auth-binaries.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, '.lightsail-build/app');
const { caddy } = await authBinaries(root);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'optics-registration-'));
const children = new Set();
let logs = '';
let checks = 0;
function checked(label) {
  checks++;
  console.log('PASS ' + label);
}
async function freePort() {
  const server = createServer();
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
  child.stdout.on('data', (data) => {
    logs += data;
  });
  child.stderr.on('data', (data) => {
    logs += data;
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
async function ready(check) {
  for (let i = 0; i < 100; i++) {
    try {
      if (await check()) return;
    } catch {
      /* starting */
    }
    await delay(100);
  }
  throw new Error('Auth stack failed readiness checks: ' + logs);
}
try {
  const tlsPort = await freePort(),
    nodePort = await freePort();
  const origin = 'https://localhost:' + tlsPort;
  const certificate = path.join(temporary, 'localhost.pem'),
    privateKey = path.join(temporary, 'localhost.key');
  const opensslConfig = path.join(temporary, 'openssl.cnf');
  await writeFile(
    opensslConfig,
    '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Optics local test\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n',
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
      privateKey,
      '-out',
      certificate,
    ],
    { stdio: 'ignore' },
  );
  const ca = await readFile(certificate);
  const rendered = configuration(
    { origin, auto_approve_email_domain: 'inkfnd.com' },
    randomBytes(48).toString('base64url'),
  );
  const configPath = path.join(temporary, 'runtime.json');
  await writeFile(configPath, rendered.runtime, { mode: 0o600 });
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(nodePort),
    DATABASE_PATH: path.join(temporary, 'app.sqlite'),
    POSITION_LENS_CONFIG: configPath,
  };
  execFileSync(process.execPath, ['deploy/node/migrate.mjs'], {
    cwd: app,
    env,
    stdio: 'pipe',
  });
  let node = start(process.execPath, ['deploy/node/server.mjs'], {
    cwd: app,
    env,
  });
  await ready(
    async () =>
      (await fetch('http://127.0.0.1:' + nodePort + '/_health')).status === 200,
  );
  const caddyConfig = path.join(temporary, 'Caddyfile');
  await writeFile(
    caddyConfig,
    rendered.caddy
      .replace('admin off', 'admin off\n  auto_https off')
      .replace('/srv/position-lens-data/caddy', temporary + '/caddy')
      .replace('127.0.0.1:3000', '127.0.0.1:' + nodePort)
      .replace(
        origin.slice(8) + ' {',
        origin + ' {\n  tls ' + certificate + ' ' + privateKey,
      ),
  );
  start(caddy, ['run', '--config', caddyConfig, '--adapter', 'caddyfile'], {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: path.join(temporary, 'config'),
      XDG_DATA_HOME: path.join(temporary, 'data'),
    },
  });
  async function request(
    route,
    {
      data,
      cookie,
      headers = {},
      method = data === undefined ? 'GET' : 'POST',
    } = {},
  ) {
    return new Promise((resolve, reject) => {
      const body = data === undefined ? undefined : JSON.stringify(data);
      const req = httpsRequest(
        origin + route,
        {
          method,
          ca,
          hostname: '127.0.0.1',
          servername: 'localhost',
          headers: {
            Host: new URL(origin).host,
            ...(body
              ? {
                  Origin: origin,
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(body),
                }
              : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...headers,
          },
        },
        (response) => {
          let text = '';
          response.on('data', (chunk) => {
            text += chunk;
          });
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              text,
              data: response.headers['content-type']?.includes(
                'application/json',
              )
                ? JSON.parse(text)
                : null,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }
  const cookieOf = (result) =>
    result.headers['set-cookie']
      .find((cookie) => cookie.startsWith('__Secure-optics.session_token='))
      .split(';')[0];
  const password = 'test-only-unique-password-42';
  const signup = (email, extra = {}) =>
    request('/api/auth/sign-up/email', {
      data: { name: 'Local test', email, password, ...extra },
    });
  await ready(async () => (await request('/auth')).status === 200);
  assert((await request('/auth')).text.includes('Create an account'));
  assert.equal((await request('/_health')).status, 404);
  assert.equal(
    (
      await request('/api/state', {
        headers: {
          'Oai-Authenticated-User-Id': 'forged',
          'Oai-Authenticated-User-Email': 'user@inkfnd.com',
          'X-Forwarded-User': 'forged',
          'X-Forwarded-Email': 'user@inkfnd.com',
        },
      })
    ).status,
    401,
  );
  checked(
    'real Caddy HTTPS, public registration and forged identities rejected',
  );
  const approved = await signup('Trial@INKFND.COM', {
    approval: 'blocked',
    emailVerified: true,
  });
  assert.equal(approved.status, 200, approved.text);
  assert.equal(approved.data.user.approval, 'approved');
  assert.equal(approved.data.user.emailVerified, false);
  const approvedCookie = cookieOf(approved);
  const setCookie = approved.headers['set-cookie'].join(';');
  for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/'])
    assert(setCookie.toLowerCase().includes(flag.toLowerCase()));
  assert.equal(
    (await request('/api/state', { cookie: approvedCookie })).status,
    200,
  );
  checked(
    'case-normalized exact domain gets immediate approval and secure cookies',
  );
  const pending = await signup('waiting@example.com', {
    approval: 'approved',
    emailVerified: true,
  });
  assert.equal(pending.status, 200, pending.text);
  assert.equal(pending.data.user.approval, 'pending');
  const pendingCookie = cookieOf(pending);
  for (const route of [
    '/api/state',
    '/api/watches',
    '/api/markets',
    '/api/verification',
  ]) {
    const denied = await request(route, { cookie: pendingCookie });
    assert.equal(denied.status, 403, route);
    assert.equal(denied.data.code, 'APPROVAL_PENDING');
  }
  assert.equal(
    (await request('/', { cookie: pendingCookie })).headers.location,
    '/auth?mode=pending',
  );
  assert.equal(
    (
      await request('/api/auth/update-user', {
        cookie: pendingCookie,
        data: { approval: 'approved' },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request('/api/auth/change-email', {
        cookie: pendingCookie,
        data: { newEmail: 'fake@inkfnd.com' },
      })
    ).status,
    404,
  );
  checked(
    'pending users cannot access workspace APIs or assign themselves approval',
  );
  for (const email of [
    'suffix@inkfnd.com.evil.example',
    'sub@team.inkfnd.com',
  ]) {
    const other = await signup(email);
    assert.equal(other.status, 200, other.text);
    assert.equal(other.data.user.approval, 'pending');
  }
  checked('lookalike suffixes and subdomains remain pending');
  assert.equal(
    (
      await request('/api/auth/sign-in/email', {
        data: { email: 'trial@inkfnd.com', password },
        headers: { Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request('/api/auth/sign-out', { cookie: approvedCookie })).status,
    405,
  );
  assert.equal(
    (
      await request('/api/auth/sign-out', {
        cookie: approvedCookie,
        data: {},
        headers: { Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/api/auth/sign-up/email', {
        data: { name: 'x'.repeat(17_000) },
      })
    ).status,
    413,
  );
  checked('login/logout CSRF, GET logout and oversized auth requests rejected');
  const operator = (command, email) =>
    execFileSync(
      process.execPath,
      ['deploy/node/accounts.mjs', command, email],
      { cwd: app, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  operator('approve', 'waiting@example.com');
  assert.equal(
    (await request('/api/state', { cookie: pendingCookie })).status,
    200,
  );
  await stop(node);
  node = start(process.execPath, ['deploy/node/server.mjs'], { cwd: app, env });
  await ready(
    async () =>
      (await request('/api/state', { cookie: pendingCookie })).status === 200,
  );
  checked(
    'operator approval and existing sessions survive an application restart',
  );
  const db = openDatabase(env.DATABASE_PATH);
  const stored = db.raw
    .prepare('SELECT password FROM auth_account WHERE userId = ?')
    .get(approved.data.user.id);
  assert(stored.password && !stored.password.includes(password));
  assert.equal(
    db.raw.prepare('SELECT COUNT(*) AS n FROM auth_approval_log').get().n,
    1,
  );
  db.close();
  checked('passwords are hashed and manual approval is audited');
  operator('block', 'waiting@example.com');
  assert.equal(
    (await request('/api/state', { cookie: pendingCookie })).status,
    401,
  );
  const blockedLogin = await request('/api/auth/sign-in/email', {
    data: { email: 'waiting@example.com', password },
  });
  assert.equal(
    (await request('/api/state', { cookie: cookieOf(blockedLogin) })).data.code,
    'ACCOUNT_BLOCKED',
  );
  checked('blocking revokes sessions and prevents access after another login');
  const recovery = operator('reset-link', 'trial@inkfnd.com').trim();
  const token = decodeURIComponent(new URL(recovery).hash.slice(1));
  const nextPassword = 'another-test-only-password-42';
  assert.equal(
    (
      await request('/api/auth/reset-password', {
        data: { token, newPassword: nextPassword },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request('/api/state', { cookie: approvedCookie })).status,
    401,
  );
  assert.notEqual(
    (
      await request('/api/auth/reset-password', {
        data: { token, newPassword: password },
      })
    ).status,
    200,
  );
  const signedIn = await request('/api/auth/sign-in/email', {
    data: { email: 'trial@inkfnd.com', password: nextPassword },
  });
  assert.equal(signedIn.status, 200, signedIn.text);
  let currentCookie = cookieOf(signedIn);
  checked(
    'operator-issued recovery is single-use and revokes existing sessions',
  );
  assert.equal(
    (
      await request('/api/auth/change-password', {
        cookie: currentCookie,
        data: { currentPassword: 'wrong-password', newPassword: password },
      })
    ).status,
    400,
  );
  const changed = await request('/api/auth/change-password', {
    cookie: currentCookie,
    data: {
      currentPassword: nextPassword,
      newPassword: password,
      revokeOtherSessions: true,
    },
  });
  assert.equal(changed.status, 200, changed.text);
  currentCookie = cookieOf(changed);
  assert.equal(
    (await request('/api/auth/sign-out', { cookie: currentCookie, data: {} }))
      .status,
    200,
  );
  assert.equal(
    (await request('/api/state', { cookie: currentCookie })).status,
    401,
  );
  checked(
    'password changes require the current password and logout invalidates the session',
  );
  const login = await request('/api/auth/sign-in/email', {
    data: { email: 'trial@inkfnd.com', password },
  });
  const expiredCookie = cookieOf(login);
  const expiryDb = openDatabase(env.DATABASE_PATH);
  expiryDb.raw
    .prepare('UPDATE auth_session SET expiresAt = 0 WHERE userId = ?')
    .run(approved.data.user.id);
  expiryDb.close();
  assert.equal(
    (await request('/api/state', { cookie: expiredCookie })).status,
    401,
  );
  checked('expired sessions fail closed');
  let limited = false;
  for (let i = 0; i < 12; i++) {
    const response = await request('/api/auth/sign-in/email', {
      data: { email: 'trial@inkfnd.com', password: 'wrong-password' },
    });
    if (response.status === 429) {
      limited = true;
      assert(response.headers['x-retry-after']);
      break;
    }
  }
  assert(limited);
  await stop(node);
  node = start(process.execPath, ['deploy/node/server.mjs'], { cwd: app, env });
  await ready(async () => (await request('/auth')).status === 200);
  assert.equal(
    (
      await request('/api/auth/sign-in/email', {
        data: { email: 'trial@inkfnd.com', password },
      })
    ).status,
    429,
  );
  checked('login throttling persists across server restarts');
  console.log(
    JSON.stringify({
      result: 'passed',
      checks,
      stack: 'Caddy HTTPS → Node → Better Auth → SQLite',
    }),
  );
} finally {
  for (const child of children) await stop(child);
  await rm(temporary, { recursive: true, force: true });
}
