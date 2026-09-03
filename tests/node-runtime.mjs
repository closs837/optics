import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { openDatabase } from '../deploy/node/sqlite.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, '.lightsail-build/app');
await readFile(path.join(app, 'dist/server/index.js'));
const temporary = await mkdtemp(
  path.join(os.tmpdir(), 'position-lens-node-test-'),
);
const config = {
  origin: 'https://positions.example.com',
  oidc_issuer_url: 'https://issuer.example.com',
  allowed_emails: ['first@example.com', 'second@example.com'],
};
await writeFile(path.join(temporary, 'runtime.json'), JSON.stringify(config));
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: '0',
  DATABASE_PATH: path.join(temporary, 'app.sqlite'),
  POSITION_LENS_CONFIG: path.join(temporary, 'runtime.json'),
};
let child;
let base;
let logs = '';
async function start() {
  child = spawn(process.execPath, ['deploy/node/server.mjs'], {
    cwd: app,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  logs = '';
  child.stdout.on('data', (data) => {
    logs += data;
  });
  child.stderr.on('data', (data) => {
    logs += data;
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const match = logs.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) {
      base = match[0];
      try {
        if ((await fetch(base + '/_health')).status === 200) return;
      } catch {
        /* still starting */
      }
    }
    if (child.exitCode !== null) break;
    await delay(100);
  }
  throw new Error('Node server failed to start: ' + logs);
}
async function stop() {
  if (child?.exitCode === null) {
    const ended = once(child, 'exit');
    child.kill('SIGTERM');
    await ended;
  }
}
async function request(
  route,
  {
    method = 'GET',
    data,
    user = 'first',
    auth = true,
    origin = config.origin,
    extra = {},
  } = {},
) {
  const options = {
    method,
    headers: {
      Host: 'positions.example.com',
      'X-Forwarded-Proto': 'https',
      ...(data === undefined
        ? {}
        : { 'Content-Length': Buffer.byteLength(JSON.stringify(data)) }),
      ...(auth
        ? {
            'X-Forwarded-User': user + '-subject',
            'X-Forwarded-Email': user + '@example.com',
          }
        : {}),
      ...(method !== 'GET'
        ? { Origin: origin, 'Content-Type': 'application/json' }
        : {}),
      ...extra,
    },
  };
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(base + route, options, (res) => {
      let text = '';
      res.on('data', (part) => {
        text += part;
      });
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: new Headers(res.headers),
          text,
        }),
      );
    });
    req.on('error', reject);
    req.end(data === undefined ? undefined : JSON.stringify(data));
  });
  const text = response.text;
  return {
    status: response.status,
    data: response.headers.get('content-type')?.includes('application/json')
      ? JSON.parse(text)
      : text,
    headers: response.headers,
  };
}
try {
  for (let i = 0; i < 2; i++) {
    const migration = spawnSync(process.execPath, ['deploy/node/migrate.mjs'], {
      cwd: app,
      env,
      encoding: 'utf8',
    });
    assert.equal(migration.status, 0, migration.stderr);
  }
  await start();
  assert.equal(
    (
      await request('/api/state', {
        auth: false,
        extra: {
          'oai-authenticated-user-id': 'forged',
          'oai-authenticated-user-email': 'first@example.com',
        },
      })
    ).status,
    401,
  );
  assert.equal(
    (await request('/api/state', { extra: { Host: 'evil.example' } })).status,
    403,
  );
  assert.equal((await request('/api/state', { user: 'unlisted' })).status, 401);
  assert.equal((await request('/')).status, 200);
  assert.equal(
    (await request('/api/verification', { auth: false })).status,
    401,
  );
  assert.equal(
    (
      await request('/api/verification', {
        method: 'POST',
        origin: 'https://evil.example',
        data: { action: 'capture' },
      })
    ).status,
    403,
  );
  const evidence = await request('/api/verification', {
    method: 'POST',
    data: { action: 'capture' },
  });
  assert.equal(evidence.status, 200, JSON.stringify(evidence.data));
  assert.equal(evidence.data.receiptAudit, true);
  assert.equal(evidence.data.ledger.inputs[0].chainId, 57073);
  assert.equal(
    evidence.data.ledger.runs[0].id,
    '0xa9e5f12591c08d173d762c7701c43238b8a4f58eaedae726aeabf2ff6585a72e',
  );
  assert.equal(evidence.data.ledger.runs[0].receipts, 9);
  assert.equal(
    (await request('/api/verification', { user: 'second' })).data.ledger.inputs
      .length,
    0,
  );
  await request('/api/verification', {
    user: 'second',
    method: 'DELETE',
    data: {},
  });
  assert.deepEqual((await request('/api/verification')).data, evidence.data);
  assert.equal(
    (
      await request('/api/watches', {
        method: 'POST',
        origin: 'https://evil.example',
        data: {},
      })
    ).status,
    403,
  );
  const created = await request('/api/watches', {
    method: 'POST',
    data: {
      address: '0x9138E2cAdFEB23AFFdc0419F2912CaB8F135dba9',
      label: 'Persistent Node test',
    },
    extra: { 'oai-authenticated-user-id': 'forged-owner' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.watchId;
  const watch = created.data.watches.find((item) => item.id === id);
  assert(watch.latest, watch.lastError);
  assert(BigInt(watch.latest.blockNumber) > 0n);
  const scenario = await request('/api/scenarios', {
    method: 'POST',
    data: {
      watchId: id,
      name: 'Saved scenario',
      collateralShock: -20,
      debtShock: 10,
      repayUsd: 100,
      targetHealthFactor: 1.5,
    },
  });
  assert.equal(scenario.status, 201, JSON.stringify(scenario.data));
  assert.equal(
    (await request('/api/state', { user: 'second' })).data.watches.length,
    0,
  );
  assert.equal(
    (
      await request('/api/watches', {
        user: 'second',
        method: 'DELETE',
        data: { id },
      })
    ).status,
    404,
  );
  await stop();
  await start();
  const saved = await request('/api/state');
  assert.deepEqual((await request('/api/verification')).data, evidence.data);
  const retried = await request('/api/verification', {
    method: 'POST',
    data: { action: 'retry' },
  });
  assert.equal(retried.status, 200, JSON.stringify(retried.data));
  assert(retried.data.version > evidence.data.version);
  assert.equal(retried.data.ledger.inputs.length, 1);
  const liveEvidence = await request('/api/verification', {
    method: 'POST',
    data: { action: 'live', blockNumber: '56543618' },
  });
  assert.equal(liveEvidence.status, 200, JSON.stringify(liveEvidence.data));
  assert.equal(liveEvidence.data.ledger.inputs[0].source, 'live');
  assert.equal(
    liveEvidence.data.ledger.inputs[0].header.receiptsRoot,
    evidence.data.ledger.inputs[0].header.receiptsRoot,
  );
  const clearedEvidence = await request('/api/verification', {
    method: 'DELETE',
    data: {},
  });
  assert.equal(clearedEvidence.data.ledger.inputs.length, 0);
  assert.equal(saved.data.watches[0].id, id);
  assert.equal(saved.data.scenarios.length, 1);
  const markets = await request('/api/markets');
  assert.equal(markets.status, 200, JSON.stringify(markets.data));
  assert(markets.data.market.reserves.length > 0);
  assert.equal(
    (await request('/signout-with-chatgpt')).headers.get('location'),
    '/oauth2/sign_out?rd=%2Foauth2%2Fsign_in',
  );
  assert.equal(
    (await request('/api/watches', { method: 'DELETE', data: { id } })).status,
    200,
  );
  await stop();
  const db = openDatabase(env.DATABASE_PATH);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM snapshots').first()).n,
    0,
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM scenarios').first()).n,
    0,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) AS n FROM _position_lens_migrations')
        .first()
    ).n,
    3,
  );
  db.close();
  console.log(
    JSON.stringify({
      result: 'passed',
      target: 'compiled Node release',
      liveBlock: watch.latest.blockNumber,
      reserves: markets.data.market.reserves.length,
      checks: [
        'real SQLite',
        'idempotent migrations',
        'proxy identity validation',
        'SSR',
        'live RPC',
        'cross-owner isolation',
        'CSRF',
        'persistence across process restart',
        'integrated Ink verification: capture, live RPC, retry, owner isolation, persistence and clearing',
        'scenarios',
        'cascading deletion',
      ],
    }),
  );
} finally {
  await stop();
  await rm(temporary, { recursive: true, force: true });
}
