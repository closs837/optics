import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;
const sitesPreview = process.env.POSITION_LENS_TARGET === 'sites';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Platform plugins belong only to the optional Sites preview. The default
  // production build uses Node and the persistent Lightsail SQLite adapter.
  const previewPlugins = [];
  if (sitesPreview) {
    process.env.WRANGLER_WRITE_LOGS ??= 'false';
    process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
    process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';
    const [{ cloudflare }, { sites }] = await Promise.all([
      import('@cloudflare/vite-plugin'),
      import('@openai/sites-vite-plugin'),
    ]);
    previewPlugins.push(sites(), cloudflare({
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      config: localBindingConfig,
    }));
  }

  return {
    ...(!sitesPreview
      ? {
          resolve: {
            alias: [
              {
                find: /^@\/db\/runtime$/,
                replacement: fileURLToPath(
                  new URL('./deploy/node/bindings.ts', import.meta.url),
                ),
              },
            ],
          },
        }
      : {}),
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [vinext(), ...previewPlugins],
  };
});
