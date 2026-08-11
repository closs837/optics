import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFile } from './release-integrity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.lightsail-build');
await rm(output, { recursive: true, force: true });
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ['node_modules/vinext/dist/cli.js', 'build'], {
  ...process.env,
  POSITION_LENS_TARGET: 'lightsail',
});
await mkdir(path.join(output, 'app/deploy'), { recursive: true });
for (const name of ['dist', 'drizzle', 'package.json', 'package-lock.json'])
  await cp(path.join(root, name), path.join(output, 'app', name), {
    recursive: true,
  });
await cp(path.join(root, 'deploy/node'), path.join(output, 'app/deploy/node'), {
  recursive: true,
});
await cp(
  path.join(root, 'deploy/lightsail'),
  path.join(output, 'app/deploy/lightsail'),
  { recursive: true },
);
await readFile(path.join(output, 'app/dist/server/index.js'));
run(
  'tar',
  [
    '-czf',
    path.join(output, 'release.tar.gz'),
    '-C',
    path.join(output, 'app'),
    '.',
  ],
  { ...process.env, COPYFILE_DISABLE: '1' },
);
await writeFile(
  path.join(output, 'manifest.json'),
  JSON.stringify(
    {
      format: 1,
      target: 'lightsail-node',
      sha256: await hashFile(path.join(output, 'release.tar.gz')),
    },
    null,
    2,
  ) + '\n',
);
console.log('Lightsail Node release ready: .lightsail-build/release.tar.gz');
