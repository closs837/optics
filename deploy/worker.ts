import app from 'vinext/server/fetch-handler';
import {
  authenticateAccess,
  safeReturnPath,
  type AccessConfig,
} from './access';
export * from 'vinext/server/fetch-handler';

interface StandaloneEnv extends AccessConfig {
  DB: D1Database;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: StandaloneEnv, ctx: ExecutionContext) {
    const authenticated = await authenticateAccess(request, env);
    if (authenticated instanceof Response) return authenticated;
    const url = new URL(request.url);
    if (url.pathname === '/signout-with-chatgpt')
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/cdn-cgi/access/logout',
          'Cache-Control': 'no-store',
        },
      });
    if (url.pathname === '/signin-with-chatgpt')
      return new Response(null, {
        status: 302,
        headers: {
          Location: safeReturnPath(
            url.searchParams.get('return_to'),
            env.APP_ORIGIN,
          ),
          'Cache-Control': 'no-store',
        },
      });
    // Terraform invokes the Worker first so assets are covered by the same guard.
    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = await env.ASSETS.fetch(authenticated);
      if (asset.status !== 404) return asset;
    }
    return app.fetch(authenticated, env, ctx);
  },
} satisfies ExportedHandler<StandaloneEnv>;
