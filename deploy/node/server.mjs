import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { safeReturnPath } from './return-path.ts';
import { createAccessNotifier } from './access-notifier.mjs';
import { runtimeDatabase } from './sqlite.mjs';

const config = JSON.parse(
  await readFile(
    process.env.POSITION_LENS_CONFIG ?? '/etc/position-lens/runtime.json',
    'utf8',
  ),
);
const origin = new URL(config.origin);
if (origin.protocol !== 'https:' || origin.origin !== config.origin)
  throw new Error('Configure an exact HTTPS application origin.');
const allowed = new Set(
  config.allowed_emails.map((email) => email.toLowerCase()),
);
if (!allowed.size) throw new Error('An email allowlist is required.');
const notifyAccess = createAccessNotifier(config);
process.env.APP_ORIGIN = origin.origin;
process.env.VINEXT_TRUST_PROXY = '1';
process.env.VINEXT_TRUSTED_HOSTS = origin.host;
const namespace = createHash('sha256')
  .update(config.oidc_issuer_url)
  .digest('hex')
  .slice(0, 16);
const { startProdServer } = await import('vinext/server/prod-server');
const { server } = await startProdServer({
  port: Number(process.env.PORT ?? 3000),
  host: '127.0.0.1',
  outDir: 'dist',
});
const handlers = server.listeners('request');
server.removeAllListeners('request');
server.on('request', (request, response) => {
  const deny = (status) => {
    response.writeHead(status, { 'Cache-Control': 'no-store' });
    response.end();
  };
  if (
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
      request.socket.remoteAddress,
    )
  )
    return deny(403);
  let url;
  try {
    url = new URL(request.url, origin);
  } catch {
    return deny(400);
  }
  if (url.origin !== origin.origin) return deny(403);
  if (url.pathname === '/_health') {
    try {
      runtimeDatabase().raw.prepare('SELECT id FROM watches LIMIT 1').get();
      response.end('ok');
    } catch {
      deny(503);
    }
    return;
  }
  // Caddy strips these headers at ingress. OAuth2 Proxy supplies the verified
  // subject/email after OIDC authentication; both upstream ports are loopback.
  const subject = request.headers['x-forwarded-user'];
  const email = request.headers['x-forwarded-email'];
  for (const key of Object.keys(request.headers))
    if (key.startsWith('oai-')) delete request.headers[key];
  if (
    request.headers.host !== origin.host ||
    request.headers['x-forwarded-proto'] !== 'https'
  )
    return deny(403);
  if (
    typeof subject !== 'string' ||
    !subject ||
    subject.length > 512 ||
    typeof email !== 'string' ||
    !allowed.has(email.toLowerCase())
  )
    return deny(401);
  request.headers['oai-authenticated-user-id'] =
    'oidc:' + namespace + ':' + subject;
  request.headers['oai-authenticated-user-email'] = email;
  delete request.headers['cf-connecting-ip'];
  const clientIp = request.headers['x-real-ip'];
  if (typeof clientIp === 'string')
    request.headers['cf-connecting-ip'] = clientIp;
  if (
    ['/signin-with-chatgpt', '/signout-with-chatgpt'].includes(url.pathname)
  ) {
    response.writeHead(302, {
      'Cache-Control': 'no-store',
      Location:
        url.pathname === '/signout-with-chatgpt'
          ? '/oauth2/sign_out?rd=%2Foauth2%2Fsign_in'
          : safeReturnPath(url.searchParams.get('return_to'), origin.origin),
    });
    response.end();
    return;
  }
  if (
    request.method === 'GET' &&
    url.pathname === '/' &&
    request.headers.accept?.includes('text/html') &&
    !request.headers.rsc
  )
    response.once('finish', () => {
      if (response.statusCode === 200) void notifyAccess(email);
    });
  for (const handler of handlers) handler.call(server, request, response);
});
server.requestTimeout = 120_000;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 15_000).unref();
  });
