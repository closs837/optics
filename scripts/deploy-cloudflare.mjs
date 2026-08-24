import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashFile,
  releaseInputs,
  verifyRelease,
} from './release-integrity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2] ?? 'plan';
const planPath = path.join(root, 'infra/terraform/release.tfplan');
const receiptPath = path.join(root, 'infra/terraform/release.receipt.json');
if (!['plan', 'apply'].includes(action)) throw new Error('Use plan or apply.');
await access(path.join(root, 'infra/terraform/terraform.tfvars')).catch(() => {
  throw new Error(
    'Copy infra/terraform/terraform.tfvars.example to terraform.tfvars and fill in your account details.',
  );
});
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (action === 'plan') {
  await rm(receiptPath, { force: true });
  run(process.execPath, ['scripts/build-cloudflare.mjs']);
  run('terraform', ['-chdir=infra/terraform', 'init', '-input=false']);
  run('terraform', ['-chdir=infra/terraform', 'validate']);
  const inputs = await releaseInputs(root);
  run('terraform', ['-chdir=infra/terraform', 'plan', '-out=release.tfplan']);
  assert.deepEqual(
    await releaseInputs(root),
    inputs,
    'Release inputs changed while planning. Run npm run deploy:cloudflare:plan again.',
  );
  await writeFile(
    receiptPath,
    JSON.stringify(
      { format: 1, inputs, plan_sha256: await hashFile(planPath) },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log(
    'Review the plan above. Run npm run deploy:cloudflare:apply to deploy this exact release.',
  );
} else {
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  await verifyRelease(root, planPath, receipt);
  run('terraform', ['-chdir=infra/terraform', 'apply', 'release.tfplan']);
}
