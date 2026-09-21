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
const options = {
  artifact: '.lightsail-build',
  terraform: 'infra/lightsail',
  extraDirectories: ['deploy/lightsail'],
};
const plan = path.join(root, options.terraform, 'release.tfplan');
const receiptPath = path.join(root, options.terraform, 'release.receipt.json');
const action = process.argv[2];
assert(['plan', 'apply'].includes(action), 'Use plan or apply.');
await Promise.any(
  ['terraform.tfvars', 'terraform.tfvars.json'].map((name) =>
    access(path.join(root, options.terraform, name)),
  ),
).catch(() => {
  throw new Error(
    'Fill infra/lightsail/terraform.tfvars or terraform.tfvars.json with the deployment parameters.',
  );
});
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (action === 'plan') {
  await rm(receiptPath, { force: true });
  run(process.execPath, ['scripts/build-lightsail.mjs']);
  run('terraform', ['-chdir=infra/lightsail', 'init', '-input=false']);
  run('terraform', ['-chdir=infra/lightsail', 'validate']);
  const inputs = await releaseInputs(root, options);
  run('terraform', ['-chdir=infra/lightsail', 'plan', '-out=release.tfplan']);
  assert.deepEqual(
    await releaseInputs(root, options),
    inputs,
    'Inputs changed while planning. Create a new plan.',
  );
  await writeFile(
    receiptPath,
    JSON.stringify(
      { format: 1, inputs, plan_sha256: await hashFile(plan) },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log('Review the plan. npm run deploy:apply executes the saved plan.');
} else {
  await verifyRelease(
    root,
    plan,
    JSON.parse(await readFile(receiptPath, 'utf8')),
    options,
  );
  run('terraform', ['-chdir=infra/lightsail', 'apply', 'release.tfplan']);
}
