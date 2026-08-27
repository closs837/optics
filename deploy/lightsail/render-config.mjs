import { readFile, writeFile, mkdir, chown, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateWebhook } from '../node/access-notifier.mjs';

export function configuration(config, cookieSecret) {
  const slackWebhook = validateWebhook(config.slack_webhook_url);
  const origin = new URL(config.origin);
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== config.origin ||
    !/^[a-z0-9.-]+$/.test(origin.hostname)
  )
    throw new Error('Invalid app origin.');
  if (!/^[^\s@{}]+@[^\s@{}]+\.[^\s@{}]+$/.test(config.acme_email))
    throw new Error('Invalid ACME email.');
  if (
    !config.allowed_emails?.length ||
    config.allowed_emails.some(
      (email) => !/^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(email),
    )
  )
    throw new Error('Exact allowed emails are required.');
  if (
    new URL(config.oidc_issuer_url).protocol !== 'https:' ||
    !config.oidc_client_id ||
    !config.oidc_client_secret
  )
    throw new Error('OIDC configuration is incomplete.');
  const values = {
    provider: 'oidc',
    oidc_issuer_url: config.oidc_issuer_url,
    client_id: config.oidc_client_id,
    client_secret: config.oidc_client_secret,
    redirect_url: origin.origin + '/oauth2/callback',
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    insecure_oidc_skip_nonce: false,
    insecure_oidc_allow_unverified_email: false,
    http_address: '127.0.0.1:4180',
    upstreams: ['http://127.0.0.1:3000/'],
    api_routes: ['^/api/'],
    reverse_proxy: true,
    trusted_proxy_ips: ['127.0.0.1/32', '::1/128'],
    pass_host_header: true,
    pass_user_headers: true,
    pass_basic_auth: false,
    skip_auth_strip_headers: true,
    authenticated_emails_file: '/etc/position-lens/allowed-emails',
    cookie_secret: cookieSecret,
    cookie_name: '__Host-position_lens',
    cookie_secure: true,
    cookie_httponly: true,
    cookie_samesite: 'lax',
    cookie_path: '/',
    cookie_expire: '12h',
    cookie_refresh: '1h',
    skip_provider_button: false,
    request_logging: false,
  };
  return {
    runtime:
      JSON.stringify(
        {
          origin: origin.origin,
          oidc_issuer_url: config.oidc_issuer_url,
          allowed_emails: config.allowed_emails,
          slack_webhook_url: slackWebhook,
        },
        null,
        2,
      ) + '\n',
    emails: config.allowed_emails.join('\n') + '\n',
    proxy:
      Object.entries(values)
        .map(([key, value]) => key + ' = ' + JSON.stringify(value))
        .join('\n') + '\n',
    caddy:
      '{\n  admin off\n  email ' +
      config.acme_email +
      '\n  storage file_system {\n    root /srv/position-lens-data/caddy\n  }\n}\n' +
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
  reverse_proxy 127.0.0.1:4180 {
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
  const secretPath = '/srv/position-lens-data/secrets/oauth-cookie';
  await mkdir('/srv/position-lens-data/secrets', {
    recursive: true,
    mode: 0o700,
  });
  let cookie;
  try {
    cookie = await readFile(secretPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    cookie = randomBytes(32).toString('base64url');
    await writeFile(secretPath, cookie, { mode: 0o600, flag: 'wx' });
  }
  const rendered = configuration(config, cookie.trim());
  await chmod('/etc/position-lens', 0o755);
  for (const [filename, content, account] of [
    ['/etc/position-lens/runtime.json', rendered.runtime, 'position-lens'],
    [
      '/etc/position-lens/allowed-emails',
      rendered.emails,
      'position-lens-auth',
    ],
    [
      '/etc/position-lens/oauth2-proxy.cfg',
      rendered.proxy,
      'position-lens-auth',
    ],
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
