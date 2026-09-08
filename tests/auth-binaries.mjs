import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Official release archives, matching deploy/lightsail/bootstrap.sh. These
// binaries exercise the real ingress and login services, not header fixtures.
const releases = {
  'darwin-arm64': [
    [
      'oauth2-proxy/oauth2-proxy',
      'v7.15.4',
      'oauth2-proxy-v7.15.4.darwin-arm64.tar.gz',
      'ec5acdd46df12da2a2449e77aa9e16bc6ff0ad46c87b9e19c8c93c18be6dbb4d',
      'oauth2-proxy-v7.15.4.darwin-arm64/oauth2-proxy',
    ],
    [
      'caddyserver/caddy',
      'v2.11.4',
      'caddy_2.11.4_mac_arm64.tar.gz',
      '9efb0af2d6cf09cfb5053c0e51721b9b3d4956d346234f39368d943d25a3c9a7',
      'caddy',
    ],
  ],
  'linux-x64': [
    [
      'oauth2-proxy/oauth2-proxy',
      'v7.15.4',
      'oauth2-proxy-v7.15.4.linux-amd64.tar.gz',
      '4fbe902189aab713d9c0519b90a645032d4636ecb523dc36f5cc312d8ebef1e2',
      'oauth2-proxy-v7.15.4.linux-amd64/oauth2-proxy',
    ],
    [
      'caddyserver/caddy',
      'v2.11.4',
      'caddy_2.11.4_linux_amd64.tar.gz',
      '527fbf917c39189a1e3b31d34fa955601680b2d5c8055d2a87b8b9588dec7bb9',
      'caddy',
    ],
  ],
};

export async function authBinaries(root) {
  const platform = process.platform + '-' + process.arch;
  const entries = releases[platform];
  if (!entries)
    throw new Error('Auth integration supports macOS arm64 and Linux x64.');
  const output = [];
  for (const [repo, version, archive, expected, executable] of entries) {
    const directory = path.join(root, 'work/auth-binaries', platform, version);
    const file = path.join(directory, archive);
    await mkdir(directory, { recursive: true });
    let data;
    try {
      data = await readFile(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      console.log('Downloading pinned test binary: ' + archive);
      const response = await fetch(
        `https://github.com/${repo}/releases/download/${version}/${archive}`,
        { signal: AbortSignal.timeout(120_000) },
      );
      if (!response.ok)
        throw new Error('Binary download failed: ' + response.status);
      data = Buffer.from(await response.arrayBuffer());
    }
    if (createHash('sha256').update(data).digest('hex') !== expected)
      throw new Error('Binary archive checksum mismatch: ' + archive);
    // Re-extract verified bytes; a changed cached executable cannot bypass the checksum.
    await writeFile(file + '.partial', data);
    await rename(file + '.partial', file);
    await rm(path.join(directory, executable), { force: true });
    execFileSync('tar', ['-xzf', file, '-C', directory, executable]);
    output.push(path.join(directory, executable));
  }
  return { oauth2Proxy: output[0], caddy: output[1] };
}
