import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function hashFile(file) {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

// The provider reads module/asset files during apply; a saved Terraform plan
// alone does not freeze their bytes. Include migrations and their runner too.
export async function releaseInputs(
  root,
  {
    artifact = '.lightsail-build',
    terraform = 'infra/lightsail',
    extraDirectories = ['deploy/lightsail'],
  } = {},
) {
  const names = ['package.json', 'package-lock.json'];
  async function walk(relative) {
    for (const entry of await readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      if (entry.isSymbolicLink())
        throw new Error('Release inputs may not be symlinks.');
      const name = relative + '/' + entry.name;
      if (entry.isDirectory()) await walk(name);
      else names.push(name);
    }
  }
  for (const directory of [artifact, 'drizzle', 'scripts', ...extraDirectories])
    await walk(directory);
  for (const entry of await readdir(path.join(root, terraform), {
    withFileTypes: true,
  })) {
    if (
      /\.(?:tf|tfvars|tfvars\.json)$/.test(entry.name) ||
      entry.name === '.terraform.lock.hcl'
    ) {
      if (!entry.isFile())
        throw new Error('Terraform inputs must be regular files.');
      names.push(terraform + '/' + entry.name);
    }
  }
  return Object.fromEntries(
    await Promise.all(
      names
        .sort()
        .map(async (name) => [name, await hashFile(path.join(root, name))]),
    ),
  );
}

export async function verifyRelease(root, planPath, receipt, options) {
  assert.equal(
    receipt.format,
    1,
    'Unknown release receipt format. Create a new plan for this deployment target.',
  );
  const current = await releaseInputs(root, options);
  const changed = [
    ...new Set([...Object.keys(receipt.inputs), ...Object.keys(current)]),
  ].filter((name) => receipt.inputs[name] !== current[name]);
  if (changed.length)
    throw new Error(
      'Release inputs changed after planning: ' +
        changed.join(', ') +
        '. Create a new plan for this deployment target.',
    );
  assert.equal(
    await hashFile(planPath),
    receipt.plan_sha256,
    'The saved plan changed. Create a new plan for this deployment target.',
  );
}
