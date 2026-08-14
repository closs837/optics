import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const id = process.env.POSITION_LENS_D1_ID;
const name = process.env.POSITION_LENS_D1_NAME;
if (!process.env.CLOUDFLARE_API_TOKEN)
  throw new Error('Set CLOUDFLARE_API_TOKEN in the deployment environment.');
if (
  !/^[a-f0-9]{32}$/.test(account ?? '') ||
  !/^[a-f0-9-]{36}$/.test(id ?? '') ||
  !/^[a-z][a-z0-9-]+$/.test(name ?? '')
)
  throw new Error(
    'Terraform must supply the exact Cloudflare account and D1 database identifiers.',
  );

const temporary = await mkdtemp(
  path.join(os.tmpdir(), 'position-lens-migrations-'),
);
try {
  const config = path.join(temporary, 'wrangler.json');
  await writeFile(
    config,
    JSON.stringify({
      name: 'position-lens-migrations',
      account_id: account,
      compatibility_date: '2026-05-15',
      d1_databases: [
        {
          binding: 'DB',
          database_name: name,
          database_id: id,
          migrations_dir: path.join(root, 'drizzle'),
        },
      ],
    }),
  );
  const run = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'd1',
      'migrations',
      'apply',
      'DB',
      '--remote',
      '--config',
      config,
    ],
    {
      cwd: root,
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
      stdio: 'inherit',
    },
  );
  if (run.error) throw run.error;
  if (run.status !== 0)
    throw new Error(
      'D1 migrations failed. No new Worker version should be deployed.',
    );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
