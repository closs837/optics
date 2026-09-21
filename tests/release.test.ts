import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  hashFile,
  releaseInputs,
  verifyRelease,
} from '../scripts/release-integrity.mjs';

await test('apply refuses changed modules, assets, SQL, configuration, scripts or saved plans', async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'position-lens-release-test-'),
  );
  const names = [
    'package.json',
    'package-lock.json',
    '.lightsail-build/app/dist/server/index.js',
    '.lightsail-build/app/dist/client/app.css',
    'drizzle/0000.sql',
    'scripts/provision-lightsail.mjs',
    'deploy/lightsail/bootstrap.sh',
    'infra/lightsail/main.tf',
    'infra/lightsail/terraform.tfvars',
    'infra/lightsail/.terraform.lock.hcl',
  ];
  try {
    for (const name of names) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), 'original');
    }
    const planPath = path.join(root, 'infra/lightsail/release.tfplan');
    await writeFile(planPath, 'saved plan');
    const receipt = {
      format: 1,
      inputs: await releaseInputs(root),
      plan_sha256: await hashFile(planPath),
    };
    await verifyRelease(root, planPath, receipt);
    for (const name of names) {
      await writeFile(path.join(root, name), 'changed');
      await assert.rejects(
        verifyRelease(root, planPath, receipt),
        /Release inputs changed/,
      );
      await writeFile(path.join(root, name), 'original');
    }
    const added = path.join(
      root,
      '.lightsail-build/app/dist/client/unplanned.js',
    );
    await writeFile(added, 'added');
    await assert.rejects(
      verifyRelease(root, planPath, receipt),
      /Release inputs changed/,
    );
    await rm(added);
    await writeFile(planPath, 'changed plan');
    await assert.rejects(
      verifyRelease(root, planPath, receipt),
      /saved plan changed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
