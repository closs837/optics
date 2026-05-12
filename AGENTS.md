# AGENTS.md

Agent guide for the Optics workspace: a Tydro V3 lending terminal on Ink, built with
React/Vinext and deployed as a Node server on Lightsail (or a Cloudflare Sites preview).

## Runtime and package manager

- Node 22.18 or later. `scripts/preflight.mjs` asserts `engines` in `package.json` and fails
  every workflow otherwise.
- Always run work through npm: `npm ci` to install, `npm run <script>` or `npm test` to execute.
  Never call `node`, `npx`, or binaries such as `vinext`, `tsc`, or `oxlint` directly — they are
  not on `PATH`, they bypass `scripts/preflight.mjs`, and they fail.
- If `node`/`npm` are not on `PATH`, prepend a Node 22.18 install first, e.g.
  `export PATH="$HOME/sdk/node-v22.18.0-linux-arm64/bin:$PATH"`.

## Install

```sh
npm ci
```

## Tests

- `npm test` — authored unit suite (`node --experimental-strip-types --test tests/*.test.ts`):
  analytics, access, engine, client evidence, release integrity, SQLite, verification and
  replay workloads.
- `npm run test:integration` — live API, ownership and read-flow checks against a local server;
  run `npm run dev` in another shell first.
- `npm run build` first, then:
  - `npm run test:lightsail` — Node deployment adapter and SQLite persistence against
    `.lightsail-build/app`.
  - `npm run test:auth` — HTTPS registration, sign-in and session handling through the pinned
    Caddy binary.
- `npm run test:replay` (`smoke`, or `verify --seeds <list>`) — re-runs the verified-activity
  path against the recorded Ink fixture and writes observed state under
  `outputs/verification-replay`.
- `npm run check:production` — the full pre-deployment gate: typecheck, lint, unit tests,
  `npm audit --omit=dev`, Lightsail build, auth checks, Node runtime checks, and Terraform
  `validate`/`test`.

Keep tests deterministic and self-contained: temporary fixtures and ports are created and
removed by the suites, and integration tests only bind loopback hosts.

## Build and checks

- `npm run dev` starts the Sites development target; `npm run build` produces the Lightsail Node
  release at `.lightsail-build/release.tar.gz` with a hashed manifest; `npm run build:sites`
  builds the Sites preview; `npm run start` launches the built release.
- `npm run typecheck`, `npm run lint`, and `npm run format` are the static checks. Lint is scoped
  to authored sources (`app lib db deploy scripts tests vendor vite.config.ts drizzle.config.ts`).
- `npm run db:local` applies the generated Drizzle migrations to the local D1 database;
  `npm run db:generate` regenerates SQL under `drizzle/` after `db/schema.ts` changes.
- `npm run deploy:plan` / `npm run deploy:apply` drive Lightsail provisioning; review the saved
  plan before applying.
- The `vendor/esbuild` snapshots are hash-pinned in `vendor/esbuild/manifest.json` and verified by
  `scripts/preflight.mjs`. Do not alter them without updating the manifest hash.

## Commits

- Use Conventional Commits, one logical change per commit, subject only:
  `<type>(<scope>): lowercase imperative subject`. Types seen in this history are `feat`, `fix`,
  `chore`, `test`, `docs`, and `style`; scopes name the touched area (`ui`, `api`, `deploy`,
  `runtime`, `verification`, `auth`, `storage`, `markets`, `infra`, `tooling`, `build`, `replay`).
- Keep subjects short (about 72 characters or less); no body, no trailers, no attribution lines.
- Run `npm run typecheck`, `npm run lint`, and `npm test` before committing changes to `app`,
  `lib`, `db`, `deploy`, or `scripts`, and run the narrower suite (`test:auth`, `test:lightsail`,
  `test:replay`) when its area changed.
- Never commit ignored artifacts: `node_modules`, `.wrangler`, `.vinext`, `outputs/`, `work/`,
  `.lightsail-build/`, `*.sqlite*`, `*.tsbuildinfo`, and `.env*` files.
