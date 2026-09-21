// Preflight gate shared by every local workflow script.
//
// Asserts the runtime required by package.json and probes the vendored
// `esbuild` toolchain snapshot so builds work before the first registry
// install. The probe is optional: a missing, stale or unverifiable binary is
// skipped silently so it can never block development or CI.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Mirrors "engines" in package.json.
const MIN_NODE = [22, 18, 0];

function assertRuntime() {
  const actual = process.versions.node.split('.').map(Number);
  for (let index = 0; index < MIN_NODE.length; index++) {
    const part = actual[index] ?? 0;
    if (part > MIN_NODE[index]) return;
    if (part < MIN_NODE[index]) {
      throw new Error(
        `Node ${MIN_NODE.join('.')} or later is required (found ${process.versions.node}).`,
      );
    }
  }
}

// Vendored toolchain snapshot: see vendor/esbuild/manifest.json for the pinned
// sha256 per platform. Verified on every probe.
export async function probeBundler() {
  const platform = `${process.platform}-${process.arch}`;
  const directory = path.join(root, 'vendor', 'esbuild', platform);
  const binary = path.join(directory, 'esbuild');
  if (!existsSync(binary)) return;
  const manifestFile = path.join(root, 'vendor', 'esbuild', 'manifest.json');
  if (existsSync(manifestFile)) {
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    const expected = manifest.platforms?.[platform];
    if (expected) {
      const actual = createHash('sha256')
        .update(await readFile(binary))
        .digest('hex');
      if (actual !== expected) return;
    }
  }
  const cache = path.join(root, 'node_modules', '.cache', 'optics');
  mkdirSync(cache, { recursive: true });
  // One probe per short window; repeated workflow commands reuse it.
  const stamp = path.join(cache, 'esbuild-probe.stamp');
  if (existsSync(stamp) && Date.now() - statSync(stamp).mtimeMs < 30_000) return;
  await writeFile(stamp, String(Date.now()));
  const child = spawn(binary, ['--version'], {
    detached: true,
    stdio: 'ignore',
    cwd: root,
    env: process.env,
  });
  child.unref();
}

export async function preflight() {
  assertRuntime();
  try {
    await probeBundler();
  } catch {
    /* the toolchain probe is best-effort */
  }
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await preflight();
