import { readFile, writeFile, mkdir, chown, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateWebhook } from '../node/access-notifier.mjs';

export function configuration(config, authSecret) {
  const slackWebhook = validateWebhook(config.slack_webhook_url);
  const origin = new URL(config.origin);
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== config.origin ||
    !/^[a-z0-9.-]+$/.test(origin.hostname)
  )
    throw new Error('Invalid app origin.');
  if (
    config.acme_email &&
    !/^[^\s@{}]+@[^\s@{}]+\.[^\s@{}]+$/.test(config.acme_email)
  )
    throw new Error('Invalid ACME email.');
  if (
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(
      config.auto_approve_email_domain ?? '',
    )
  )
    throw new Error('Configure an exact lowercase trial approval domain.');
  if (typeof authSecret !== 'string' || authSecret.length < 43)
    throw new Error('A persistent authentication secret is required.');
  return {
    runtime:
      JSON.stringify(
        {
          origin: origin.origin,
          auth_secret: authSecret,
          auto_approve_email_domain: config.auto_approve_email_domain,
          slack_webhook_url: slackWebhook,
        },
        null,
        2,
      ) + '\n',
    caddy:
      '{\n  admin off\n' +
      (config.acme_email ? '  email ' + config.acme_email + '\n' : '') +
      '  storage file_system {\n    root /srv/position-lens-data/caddy\n  }\n}\n' +
      origin.host +
      ` {
  encode zstd gzip
  header {
    -Server
    X-Content-Type-Options nosniff
    X-Frame-Options DENY
    Referrer-Policy same-origin
    Strict-Transport-Security "max-age=31536000"
  }
  request_body {
    max_size 1MB
  }
  @internal path /_health
  respond @internal 404
  reverse_proxy 127.0.0.1:3000 {
    header_up -oai-*
    header_up -X-Forwarded-User
    header_up -X-Forwarded-Email
    header_up -X-Forwarded-Preferred-Username
    header_up -X-Auth-Request-*
    header_up -Authorization
    header_up -CF-Connecting-IP
    header_up X-Real-IP {remote_host}
  }
}
`,
  };
}
if (process.argv[1]?.endsWith('/render-config.mjs')) {
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const secretPath = '/srv/position-lens-data/secrets/auth-secret';
  await mkdir('/srv/position-lens-data/secrets', {
    recursive: true,
    mode: 0o700,
  });
  let secret;
  try {
    secret = await readFile(secretPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    secret = randomBytes(48).toString('base64url');
    await writeFile(secretPath, secret, { mode: 0o600, flag: 'wx' });
  }
  const rendered = configuration(config, secret.trim());
  await chmod('/etc/position-lens', 0o755);
  for (const [filename, content, account] of [
    ['/etc/position-lens/runtime.json', rendered.runtime, 'position-lens'],
    ['/etc/caddy/Caddyfile', rendered.caddy, 'caddy'],
  ]) {
    await writeFile(filename, content, { mode: 0o640 });
    const group = Number(
      execFileSync('id', ['-g', account], { encoding: 'utf8' }).trim(),
    );
    await chown(filename, 0, group);
    await chmod(filename, 0o640);
  }
  await chown(
    '/etc/caddy',
    0,
    Number(execFileSync('id', ['-g', 'caddy'], { encoding: 'utf8' }).trim()),
  );
}
