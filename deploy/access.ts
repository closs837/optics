import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AccessConfig {
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  APP_ORIGIN: string;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function remoteKeys(issuer: string) {
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'), {
      timeoutDuration: 5000,
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });
    keySets.set(issuer, keys);
  }
  return keys;
}

function deny(message: string, status: number) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

/** The optional key resolver lets tests use signed local fixtures, never a token bypass. */
export async function authenticateAccess(
  request: Request,
  config: AccessConfig,
  resolveKey?: JWTVerifyGetKey,
): Promise<Request | Response> {
  if (
    !/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(
      config.ACCESS_TEAM_DOMAIN ?? '',
    ) ||
    !config.ACCESS_AUD
  )
    return deny('Cloudflare Access is not configured.', 503);
  let origin: URL;
  try {
    origin = new URL(config.APP_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== config.APP_ORIGIN)
      throw new Error();
  } catch {
    return deny('The application origin is not configured.', 503);
  }
  if (new URL(request.url).origin !== origin.origin)
    return deny('Use the configured application hostname.', 403);

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return deny('Sign in through Cloudflare Access.', 401);
  const issuer = 'https://' + config.ACCESS_TEAM_DOMAIN;
  try {
    const { payload } = await jwtVerify(
      token,
      resolveKey ?? remoteKeys(issuer),
      {
        issuer,
        audience: config.ACCESS_AUD,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'email', 'iat', 'exp'],
        clockTolerance: 5,
      },
    );
    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.sub.length > 256 ||
      typeof payload.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)
    )
      return deny('A signed-in user identity is required.', 401);

    // Only the verified assertion may populate the existing app identity contract.
    const headers = new Headers(request.headers);
    for (const name of Array.from(headers.keys())) {
      if (name.toLowerCase().startsWith('oai-')) headers.delete(name);
    }
    headers.set('oai-authenticated-user-id', 'cf-access:' + payload.sub);
    headers.set('oai-authenticated-user-email', payload.email);
    return new Request(request, { headers });
  } catch {
    return deny('The Cloudflare Access session is invalid or expired.', 401);
  }
}

export function safeReturnPath(value: string | null, origin: string) {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const target = new URL(value, origin);
    if (
      target.origin !== origin ||
      ['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback'].includes(
        target.pathname,
      )
    )
      return '/';
    return target.pathname + target.search + target.hash;
  } catch {
    return '/';
  }
}
