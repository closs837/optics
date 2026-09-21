import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { fromNodeHeaders } from 'better-auth/node';
import { safeReturnPath } from './return-path.ts';
import { createAccessNotifier } from './access-notifier.mjs';
import { createAuth } from './auth.mjs';
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
const auth = createAuth(config, runtimeDatabase().raw);
const notifyAccess = createAccessNotifier(config);
const authAssets = new Map(
  await Promise.all(
    [
      ['/auth', 'auth.html', 'text/html; charset=utf-8'],
      ['/auth/app.js', 'auth-ui.mjs', 'text/javascript; charset=utf-8'],
      ['/auth/style.css', 'auth.css', 'text/css; charset=utf-8'],
    ].map(async ([route, filename, type]) => [
      route,
      { body: await readFile(new URL(filename, import.meta.url)), type },
    ]),
  ),
);
const authMethods = new Map([
  ['/api/auth/sign-up/email', 'POST'],
  ['/api/auth/sign-in/email', 'POST'],
  ['/api/auth/sign-out', 'POST'],
  ['/api/auth/get-session', 'GET'],
  ['/api/auth/change-password', 'POST'],
  ['/api/auth/reset-password', 'POST'],
]);
process.env.APP_ORIGIN = origin.origin;
process.env.VINEXT_TRUST_PROXY = '1';
process.env.VINEXT_TRUSTED_HOSTS = origin.host;
const { startProdServer } = await import('vinext/server/prod-server');
const { server } = await startProdServer({
  port: Number(process.env.PORT ?? 3000),
  host: '127.0.0.1',
  outDir: 'dist',
});
const handlers = server.listeners('request');
server.removeAllListeners('request');
server.on('request', (request, response) => {
  void handle(request, response).catch(() => {
    console.error('Application request failed.');
    if (!response.headersSent)
      response.writeHead(500, { 'Cache-Control': 'no-store' });
    response.end();
  });
});

async function handle(request, response) {
  const json = (status, body) => {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
  };
  const redirect = (location) => {
    response.writeHead(303, {
      Location: location,
      'Cache-Control': 'no-store',
    });
    response.end();
  };
  if (
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
      request.socket.remoteAddress,
    )
  )
    return json(403, { error: 'Forbidden' });
  let url;
  try {
    url = new URL(request.url, origin);
  } catch {
    return json(400, { error: 'Invalid URL' });
  }
  if (url.origin !== origin.origin) return json(403, { error: 'Forbidden' });
  if (url.pathname === '/_health' && request.method === 'GET') {
    try {
      const db = runtimeDatabase().raw;
      db.prepare('SELECT id FROM watches LIMIT 1').get();
      db.prepare('SELECT id FROM auth_session LIMIT 1').get();
      json(200, { status: 'ok' });
    } catch {
      json(503, { status: 'unavailable' });
    }
    return;
  }
  // Only Caddy may reach this loopback listener. Client-supplied identities
  // are never trusted; every workspace request resolves a database session.
  for (const key of Object.keys(request.headers))
    if (
      key.startsWith('oai-') ||
      key.startsWith('x-auth-request-') ||
      [
        'authorization',
        'cf-connecting-ip',
        'x-forwarded-user',
        'x-forwarded-email',
        'x-forwarded-host',
      ].includes(key)
    )
      delete request.headers[key];
  if (
    request.headers.host !== origin.host ||
    request.headers['x-forwarded-proto'] !== 'https'
  )
    return json(403, { error: 'Forbidden' });
  const suppliedIp = request.headers['x-real-ip'];
  const clientIp =
    typeof suppliedIp === 'string' && isIP(suppliedIp)
      ? suppliedIp
      : request.socket.remoteAddress;
  request.headers['x-real-ip'] = clientIp;
  request.headers['cf-connecting-ip'] = clientIp;
  request.headers['x-forwarded-for'] = clientIp;

  if (url.pathname.startsWith('/api/auth/')) {
    if (!authMethods.has(url.pathname))
      return json(404, { error: 'Not found' });
    if (request.method !== authMethods.get(url.pathname))
      return json(405, { error: 'Method not allowed' });
    let body;
    if (request.method === 'POST') {
      if (
        request.headers.origin !== origin.origin ||
        request.headers['sec-fetch-site'] === 'cross-site'
      )
        return json(403, { error: 'Invalid request origin' });
      if (
        request.headers['content-type']?.split(';')[0].trim() !==
        'application/json'
      )
        return json(415, { error: 'Use application/json' });
      const chunks = [];
      let size = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 16_384) {
          request.resume();
          return json(413, { error: 'Request too large' });
        }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
    const result = await auth.handler(
      new Request(url, {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        body,
      }),
    );
    result.headers.forEach((value, key) => {
      if (key !== 'set-cookie') response.setHeader(key, value);
    });
    const cookies = result.headers.getSetCookie();
    if (cookies.length) response.setHeader('Set-Cookie', cookies);
    response.setHeader('Cache-Control', 'no-store');
    response.statusCode = result.status;
    response.end(Buffer.from(await result.arrayBuffer()));
    return;
  }
  if (
    authAssets.has(url.pathname) &&
    ['GET', 'HEAD'].includes(request.method)
  ) {
    const asset = authAssets.get(url.pathname);
    response.writeHead(200, {
      'Content-Type': asset.type,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : asset.body);
    return;
  }
  if (url.pathname === '/signin-with-chatgpt')
    return redirect(
      '/auth?return_to=' +
        encodeURIComponent(
          safeReturnPath(url.searchParams.get('return_to'), origin.origin),
        ),
    );
  if (url.pathname === '/signout-with-chatgpt')
    return redirect('/auth?mode=logout');
  const { response: session, headers } = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
    returnHeaders: true,
  });
  const cookies = headers.getSetCookie();
  if (cookies.length) response.setHeader('Set-Cookie', cookies);
  if (url.pathname === '/api/access' && request.method === 'GET')
    return json(200, {
      user: session
        ? {
            email: session.user.email,
            name: session.user.name,
            approval: session.user.approval,
          }
        : null,
      autoApproveDomain: config.auto_approve_email_domain,
    });
  if (!session) {
    if (url.pathname.startsWith('/api/'))
      return json(401, { error: 'Sign in required' });
    return redirect(
      '/auth?return_to=' +
        encodeURIComponent(
          safeReturnPath(url.pathname + url.search, origin.origin),
        ),
    );
  }
  if (session.user.approval !== 'approved') {
    const pending = session.user.approval === 'pending';
    if (url.pathname.startsWith('/api/'))
      return json(403, {
        error: pending ? 'Account pending approval' : 'Account access blocked',
        code: pending ? 'APPROVAL_PENDING' : 'ACCOUNT_BLOCKED',
      });
    return redirect('/auth?mode=' + (pending ? 'pending' : 'blocked'));
  }
  request.headers['oai-authenticated-user-id'] = 'local:' + session.user.id;
  request.headers['oai-authenticated-user-email'] = session.user.email;
  request.headers['oai-authenticated-user-full-name'] = encodeURIComponent(
    session.user.name,
  );
  request.headers['oai-authenticated-user-full-name-encoding'] =
    'percent-encoded-utf-8';
  if (
    request.method === 'GET' &&
    url.pathname === '/' &&
    request.headers.accept?.includes('text/html') &&
    !request.headers.rsc
  )
    response.once('finish', () => {
      if (response.statusCode === 200) void notifyAccess(session.user.email);
    });
  for (const handler of handlers) handler.call(server, request, response);
}
server.requestTimeout = 120_000;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 15_000).unref();
  });
