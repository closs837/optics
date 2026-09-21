import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { hashFile } from './release-integrity.mjs';
import { configuration } from '../deploy/lightsail/render-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const region = process.env.POSITION_LENS_REGION;
const instance = process.env.POSITION_LENS_INSTANCE;
const ip = process.env.POSITION_LENS_STATIC_IP;
const disk = process.env.POSITION_LENS_DISK;
assert(
  /^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(region ?? ''),
  'Terraform must provide the AWS region.',
);
assert(
  /^[a-z][a-z0-9-]+$/.test(instance ?? '') &&
    /^[a-z][a-z0-9-]+$/.test(disk ?? ''),
  'Terraform must provide resource names.',
);
assert(
  /^\d{1,3}(\.\d{1,3}){3}$/.test(ip ?? ''),
  'Terraform must provide the static IP.',
);
const config = {
  ...JSON.parse(process.env.POSITION_LENS_CONFIG_JSON ?? '{}'),
  slack_webhook_url: process.env.POSITION_LENS_SLACK_WEBHOOK ?? '',
};
configuration(config, 'validation-only'.repeat(4));
const release = path.join(root, '.lightsail-build/release.tar.gz');
const manifest = JSON.parse(
  await readFile(path.join(root, '.lightsail-build/manifest.json'), 'utf8'),
);
assert.equal(
  await hashFile(release),
  manifest.sha256,
  'Artifact changed after planning.',
);
const temporary = await mkdtemp(
  path.join(os.tmpdir(), 'position-lens-deploy-'),
);
const awsArgs = ['--region', region, '--no-cli-pager', '--output', 'json'];
if (process.env.POSITION_LENS_AWS_PROFILE)
  awsArgs.push('--profile', process.env.POSITION_LENS_AWS_PROFILE);
function run(
  command,
  args,
  { capture = false, timeout = 1_200_000, allowFailure = false } = {},
) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0)
    throw new Error(command + ' failed. Review the deployment output.');
  return result;
}
let stage;
let sshOptions;
let target;
try {
  const diskDetails = JSON.parse(
    run('aws', [...awsArgs, 'lightsail', 'get-disk', '--disk-name', disk], {
      capture: true,
    }).stdout,
  ).disk;
  assert(
    diskDetails.attachedTo === instance &&
      diskDetails.isSystemDisk === false &&
      diskDetails.path === '/dev/xvdf',
    'The expected application disk is not attached.',
  );
  const volume = diskDetails.supportCode?.match(/\/(vol-[a-f0-9]{8,32})$/)?.[1];
  assert(
    volume,
    'AWS did not return a verifiable volume identifier for the data disk.',
  );
  const diskSerial = volume.replace('-', '');
  let details;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = run(
      'aws',
      [
        ...awsArgs,
        'lightsail',
        'get-instance-access-details',
        '--instance-name',
        instance,
        '--protocol',
        'ssh',
      ],
      { capture: true, timeout: 30_000, allowFailure: true },
    );
    if (result.status === 0) {
      const candidate = JSON.parse(result.stdout).accessDetails;
      if (
        candidate?.hostKeys?.length &&
        candidate.privateKey &&
        candidate.certKey &&
        candidate.ipAddress === ip
      ) {
        details = candidate;
        break;
      }
    }
    if (attempt % 6 === 0)
      console.log('Waiting for Lightsail SSH credentials and host keys...');
    await delay(5000);
  }
  assert(
    details,
    'Lightsail did not supply temporary SSH access for the static IP.',
  );
  assert.equal(details.instanceName, instance);
  assert(/^[a-z_][a-z0-9_-]*$/.test(details.username));
  await writeFile(path.join(temporary, 'key'), details.privateKey, {
    mode: 0o600,
  });
  await writeFile(path.join(temporary, 'key-cert.pub'), details.certKey, {
    mode: 0o600,
  });
  const hostKeys = details.hostKeys.map((key) => {
    assert(
      /^[a-z0-9@._+-]+$/.test(key.algorithm) &&
        /^[A-Za-z0-9+/=]+$/.test(key.publicKey),
    );
    return ip + ' ' + key.algorithm + ' ' + key.publicKey;
  });
  await writeFile(
    path.join(temporary, 'known_hosts'),
    hostKeys.join('\n') + '\n',
    { mode: 0o600 },
  );
  sshOptions = [
    '-i',
    path.join(temporary, 'key'),
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'UserKnownHostsFile=' + path.join(temporary, 'known_hosts'),
    '-o',
    'ConnectTimeout=10',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=4',
  ];
  target = details.username + '@' + ip;
  let reachable = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (
      run('ssh', [...sshOptions, target, 'true'], {
        capture: true,
        timeout: 20_000,
        allowFailure: true,
      }).status === 0
    ) {
      reachable = true;
      break;
    }
    await delay(5000);
  }
  assert(
    reachable,
    'SSH is unavailable. Confirm the deployer IP matches namecheap_client_ip.',
  );
  run('ssh', [...sshOptions, target, 'sudo cloud-init status --wait']);
  stage = run(
    'ssh',
    [...sshOptions, target, 'umask 077; mktemp -d /tmp/position-lens.XXXXXXXX'],
    { capture: true },
  ).stdout.trim();
  assert(/^\/tmp\/position-lens\.[A-Za-z0-9]+$/.test(stage));
  await writeFile(
    path.join(temporary, 'configuration.json'),
    JSON.stringify(config),
    { mode: 0o600 },
  );
  for (const [source, name] of [
    [release, 'release.tar.gz'],
    [path.join(temporary, 'configuration.json'), 'configuration.json'],
    [
      path.join(root, 'deploy/lightsail/install-release.sh'),
      'install-release.sh',
    ],
  ])
    run('scp', [...sshOptions, source, target + ':' + stage + '/' + name]);
  const snapshotsEnabled = diskDetails.addOns?.some(
    (addOn) => addOn.name === 'AutoSnapshot' && addOn.status === 'Enabled',
  );
  if (!snapshotsEnabled)
    run(
      'aws',
      [
        ...awsArgs,
        'lightsail',
        'enable-add-on',
        '--resource-name',
        disk,
        '--add-on-request',
        JSON.stringify({
          addOnType: 'AutoSnapshot',
          autoSnapshotAddOnRequest: { snapshotTimeOfDay: '03:00' },
        }),
      ],
      { capture: true },
    );
  run('ssh', [
    ...sshOptions,
    target,
    'sudo bash ' +
      stage +
      '/install-release.sh ' +
      stage +
      ' ' +
      manifest.sha256 +
      ' ' +
      diskSerial,
  ]);
  console.log('Application installed. Checking public HTTPS and sign-in...');
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(config.origin + '/auth', {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (
        response.status === 200 &&
        (await response.text()).includes('Create an account')
      ) {
        ready = true;
        break;
      }
    } catch {
      /* DNS and certificate issuance can take time. */
    }
    await delay(5000);
  }
  assert(
    ready,
    'The application is installed, but public HTTPS is not ready. Check DNS/Caddy, then create a new plan and apply again.',
  );
  console.log('HTTPS is ready: ' + config.origin);
} finally {
  try {
    if (stage && sshOptions && target)
      run('ssh', [...sshOptions, target, 'sudo rm -rf -- ' + stage], {
        timeout: 30_000,
        capture: true,
        allowFailure: true,
      });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
