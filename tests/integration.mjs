import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
assert(
  ['localhost', '127.0.0.1'].includes(new URL(base).hostname),
  'Integration fixtures only run on a local server.',
);
const cookie = '__sites_local_auth=1';
function sql(statement) {
  const raw = execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--local',
      '--config',
      'wrangler.local.json',
      '--command',
      statement,
      '--json',
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(raw);
}
async function request(
  path,
  { method = 'GET', data, auth = true, origin = base } = {},
) {
  const options = {
    method,
    headers: {
      ...(auth ? { Cookie: cookie } : {}),
      ...(method !== 'GET'
        ? { 'Content-Type': 'application/json', Origin: origin }
        : {}),
    },
  };
  if (data !== undefined && method !== 'GET')
    options.body = JSON.stringify(data);
  const r = await fetch(base + path, options);
  const text = await r.text();
  const isJson = r.headers.get('content-type')?.includes('application/json');
  assert(
    isJson || r.status >= 400,
    `${path} returned ${r.status}: ${text.slice(0, 200)}`,
  );
  return {
    status: r.status,
    data: isJson ? JSON.parse(text) : { error: text.slice(0, 200) },
  };
}
let watchId;
const foreignId = 'test_foreign_' + crypto.randomUUID();
const address =
  process.env.TEST_POSITION_ADDRESS ??
  '0x9138E2cAdFEB23AFFdc0419F2912CaB8F135dba9';
try {
  assert.equal((await request('/api/state', { auth: false })).status, 401);
  assert.equal(
    (
      await request('/api/watches', {
        method: 'POST',
        data: { address },
        auth: false,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request('/api/watches', {
        method: 'POST',
        data: { address },
        origin: 'https://unrelated.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (await request('/api/position?address=bad', { auth: false })).status,
    400,
  );
  const before = await request('/api/state');
  assert.equal(before.status, 200);
  assert(
    !before.data.watches.some(
      (w) => w.address.toLowerCase() === address.toLowerCase(),
    ),
    'Fixture address already saved; choose another address to avoid modifying an existing watch.',
  );
  const created = await request('/api/watches', {
    method: 'POST',
    data: { address, label: 'Integration fixture' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  watchId = created.data.watchId;
  const watch = created.data.watches.find((w) => w.id === watchId);
  assert(watch.latest, watch.lastError ?? 'Missing live observation');
  assert.equal(watch.latest.market, 'tydro-v3');
  assert(BigInt(watch.latest.blockNumber) > 0n);
  assert(Array.isArray(watch.latest.assets));
  assert.equal(
    (await request(`/api/state?watchId=${watchId}`)).data.history.length,
    1,
  );
  const renamed = await request('/api/watches', {
    method: 'PATCH',
    data: { id: watchId, label: 'Renamed fixture' },
  });
  assert.equal(
    renamed.data.watches.find((w) => w.id === watchId).label,
    'Renamed fixture',
  );
  const duplicate = await request('/api/watches', {
    method: 'POST',
    data: { address, label: 'Duplicate' },
  });
  assert.equal(
    duplicate.data.watches.filter(
      (w) => w.address.toLowerCase() === address.toLowerCase(),
    ).length,
    1,
  );
  assert.equal(
    (
      await request('/api/rules', {
        method: 'POST',
        data: {
          watchId,
          metric: 'healthFactor',
          comparison: 'below',
          threshold: '-1',
        },
      })
    ).status,
    400,
  );
  const value = Number(watch.latest.debtUsd) > 0 ? 'debtUsd' : 'collateralUsd';
  const ruleInput =
    value === 'debtUsd'
      ? { metric: value, comparison: 'above', threshold: '0.00000001' }
      : { metric: value, comparison: 'below', threshold: '999999999999999' };
  const added = await request('/api/rules', {
    method: 'POST',
    data: { watchId, ...ruleInput },
  });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  const rule = added.data.rules.find((r) => r.watchId === watchId);
  assert(rule);
  sql(`UPDATE watches SET last_polled_at=0 WHERE id='${watchId}'`);
  const refreshed = await request('/api/refresh', { method: 'POST', data: {} });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.data));
  assert.equal(
    refreshed.data.alerts.filter((a) => a.watchId === watchId).length,
    1,
  );
  assert(refreshed.data.rules.find((r) => r.id === rule.id).wasMatching);
  sql(`UPDATE watches SET last_polled_at=0 WHERE id='${watchId}'`);
  const repeated = await request('/api/refresh', { method: 'POST', data: {} });
  assert.equal(
    repeated.data.alerts.filter((a) => a.watchId === watchId).length,
    1,
    'A still-matching rule must not send duplicates.',
  );
  const marked = await request('/api/alerts', {
    method: 'PATCH',
    data: { id: refreshed.data.alerts.find((a) => a.watchId === watchId).id },
  });
  assert(marked.data.alerts.find((a) => a.watchId === watchId).read);
  const paused = await request('/api/rules', {
    method: 'PATCH',
    data: { id: rule.id, enabled: false },
  });
  assert.equal(paused.data.rules.find((r) => r.id === rule.id).enabled, false);
  sql(
    `INSERT INTO watches(id,owner_id,address,label,created_at) VALUES('${foreignId}','other_test_user','0x0000000000000000000000000000000000000002','Other user',1)`,
  );
  assert(
    !(await request('/api/state')).data.watches.some((w) => w.id === foreignId),
  );
  assert.notEqual(
    (await request(`/api/state?watchId=${foreignId}`)).status,
    200,
  );
  assert.notEqual(
    (
      await request('/api/watches', {
        method: 'PATCH',
        data: { id: foreignId, label: 'Not allowed' },
      })
    ).status,
    200,
  );
  assert.notEqual(
    (
      await request('/api/watches', {
        method: 'DELETE',
        data: { id: foreignId },
      })
    ).status,
    200,
  );
  assert.notEqual(
    (
      await request('/api/rules', {
        method: 'POST',
        data: { watchId: foreignId, ...ruleInput },
      })
    ).status,
    201,
  );
  const scenarioInput = {
    name: 'Stress fixture',
    collateralShock: -20,
    debtShock: 10,
    repayUsd: 100,
    targetHealthFactor: 1.6,
  };
  assert.equal(
    (
      await request('/api/scenarios', {
        method: 'POST',
        auth: false,
        data: { watchId, ...scenarioInput },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request('/api/scenarios', {
        method: 'POST',
        origin: 'https://unrelated.example',
        data: { watchId, ...scenarioInput },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/api/scenarios', {
        method: 'POST',
        data: { watchId, ...scenarioInput, collateralShock: -101 },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/api/scenarios', {
        method: 'POST',
        data: { watchId: foreignId, ...scenarioInput },
      })
    ).status,
    404,
  );
  const scenario = await request('/api/scenarios', {
    method: 'POST',
    data: { watchId, ...scenarioInput },
  });
  assert.equal(scenario.status, 201, JSON.stringify(scenario.data));
  const saved = scenario.data.scenarios.find((s) => s.watchId === watchId);
  assert(saved);
  assert.equal(saved.collateralShock, -20);
  assert(
    (await request('/api/state')).data.scenarios.some((s) => s.id === saved.id),
  );
  sql(
    `INSERT INTO scenarios(id,watch_id,name,parameters,created_at) VALUES('foreign_scenario_${foreignId}','${foreignId}','Foreign','{}',1)`,
  );
  assert(
    !(await request('/api/state')).data.scenarios.some(
      (s) => s.watchId === foreignId,
    ),
  );
  assert.equal(
    (
      await request('/api/scenarios', {
        method: 'DELETE',
        data: { id: 'foreign_scenario_' + foreignId },
      })
    ).status,
    404,
  );
  const removedScenario = await request('/api/scenarios', {
    method: 'DELETE',
    data: { id: saved.id },
  });
  assert.equal(removedScenario.status, 200);
  assert(!removedScenario.data.scenarios.some((s) => s.id === saved.id));
  // Leave a fresh scenario to verify watch deletion cascades.
  assert.equal(
    (
      await request('/api/scenarios', {
        method: 'POST',
        data: { watchId, ...scenarioInput },
      })
    ).status,
    201,
  );
  const hist = (await request(`/api/state?watchId=${watchId}`)).data.history;
  assert(hist.length >= 2, 'Repeated successful reads should persist history.');
  const deleted = await request('/api/watches', {
    method: 'DELETE',
    data: { id: watchId },
  });
  assert(!deleted.data.watches.some((w) => w.id === watchId));
  assert(!deleted.data.rules.some((r) => r.watchId === watchId));
  assert(!deleted.data.alerts.some((a) => a.watchId === watchId));
  assert(!deleted.data.scenarios.some((s) => s.watchId === watchId));
  assert.equal(
    sql(`SELECT COUNT(*) AS n FROM scenarios WHERE watch_id='${watchId}'`)[0]
      .results[0].n,
    0,
  );
  const rows = sql(
    `SELECT COUNT(*) AS n FROM snapshots WHERE watch_id='${watchId}'`,
  );
  assert.equal(
    rows[0].results[0].n,
    0,
    'Deleting a watch must cascade to snapshots.',
  );
  watchId = null;
  console.log(
    JSON.stringify({
      result: 'passed',
      checks: [
        'anonymous and CSRF rejection',
        'live RPC snapshot',
        'persistent watch CRUD and deduplication',
        'rule validation',
        'scenario validation, persistence, ownership and cascading deletion',
        'threshold event and duplicate suppression',
        'read receipt and pause',
        'cross-user isolation',
        'history persistence',
        'cascade deletion',
      ],
      liveBlock: watch.latest.blockNumber,
      liveAssetCount: watch.latest.assets.length,
    }),
  );
} finally {
  if (watchId) sql(`DELETE FROM watches WHERE id='${watchId}'`);
  sql(`DELETE FROM watches WHERE id='${foreignId}'`);
}
