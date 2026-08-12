import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cloudflare-build');
// This script only replaces its own ignored artifact directory.
await rm(output, { recursive: true, force: true });
const build = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules/vinext/dist/cli.js'), 'build'],
  {
    cwd: root,
    env: { ...process.env, POSITION_LENS_TARGET: 'cloudflare' },
    stdio: 'inherit',
  },
);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const config = JSON.parse(
  await readFile(path.join(root, 'dist/server/wrangler.json'), 'utf8'),
);
await mkdir(output, { recursive: true });
await cp(path.join(root, 'dist/server'), path.join(output, 'server'), {
  recursive: true,
  filter: (source) => !source.split(path.sep).includes('.wrangler'),
});
await cp(path.join(root, 'dist/client'), path.join(output, 'client'), {
  recursive: true,
});
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error('Build artifacts may not contain symlinks.');
    if (entry.isDirectory())
      result.push(
        ...(await files(path.join(directory, entry.name))).map(
          (name) => entry.name + '/' + name,
        ),
      );
    else result.push(entry.name);
  }
  return result.sort((a, b) => a.localeCompare(b, 'en'));
}
const serverModules = (await files(path.join(output, 'server'))).filter(
  (name) => /\.(?:m?js|wasm)$/.test(name),
);
const clientFiles = await files(path.join(output, 'client'));
if (!serverModules.includes(config.main))
  throw new Error('Worker entry module is missing.');
const allHashes = {};
for (const [directory, names] of [
  ['server', serverModules],
  ['client', clientFiles],
]) {
  for (const name of names)
    allHashes[directory + '/' + name] = createHash('sha256')
      .update(await readFile(path.join(output, directory, name)))
      .digest('hex');
}
await writeFile(
  path.join(output, 'manifest.json'),
  JSON.stringify(
    {
      format: 1,
      target: 'cloudflare-access',
      main_module: config.main,
      compatibility_date: config.compatibility_date,
      compatibility_flags: config.compatibility_flags,
      server_modules: serverModules,
      client_files: clientFiles,
      hashes: allHashes,
    },
    null,
    2,
  ) + '\n',
);
console.log('Standalone artifact ready: ' + output);
console.log(
  serverModules.length +
    ' Worker modules; ' +
    clientFiles.length +
    ' static files.',
);
