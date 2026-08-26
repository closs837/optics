# Deploy Optics to your Cloudflare account

This deploys the complete application: a compiled Vinext Worker and static assets, a persistent D1 database with the real SQL migrations, a custom HTTPS hostname, and a Cloudflare Access application restricted to your email allowlist. Position and market data come from Ink RPCs. The production path contains no test accounts, sample balances, or authentication bypasses.

## Fill in the parameters

From the project directory:

```sh
npm ci
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
```

Edit `terraform.tfvars`. It is ignored by Git.

| Parameter | Value to supply |
| --- | --- |
| `account_id` | Your 32-character Cloudflare account ID. |
| `zone_id` | The 32-character ID of an active DNS zone in that account. |
| `hostname` | An unused hostname in that zone, such as `positions.example.com`. No scheme or path. |
| `access_team_domain` | Your existing Zero Trust team domain, such as `my-team.cloudflareaccess.com`. |
| `allowed_emails` | A nonempty list of exact sign-in email addresses. |
| `cloudflare_api_token` | Optional sensitive token parameter. An empty value uses `CLOUDFLARE_API_TOKEN` from the deployment environment. |
| `name` | Optional resource prefix; defaults to `optics`. |
| `access_identity_provider_ids` | Optional list of existing Access identity-provider IDs. Empty permits the account's configured providers. |
| `d1_location_hint` | Optional location hint for a new database: `wnam`, `enam`, `weur`, `eeur`, `apac`, or `oc`. |

The token can be entered in the ignored file, supplied as `TF_VAR_cloudflare_api_token`, or injected as `CLOUDFLARE_API_TOKEN`. The token parameter is both sensitive and ephemeral, so Terraform omits it from saved plans and state. It must remain available when applying the plan. Terraform 1.10 or later is required for this behavior. See [Terraform ephemeral values](https://developer.hashicorp.com/terraform/language/manage-sensitive-data/ephemeral).

The account must already have a Zero Trust organization and a usable identity provider. Email one-time PIN works if it is enabled in that organization. This module creates the app and policy inside that organization. Select a hostname without an existing Worker, Access app, or conflicting DNS record.

Use Node 22.18 or later, Terraform `>= 1.10, < 2`, and the committed npm/provider lockfiles. For sustained production traffic, choose a Cloudflare plan with sufficient Worker CPU, D1, and Access capacity.

## Token permissions

Scope the token to the account and DNS zone above. It needs:

- Workers create, update, deploy, and read permissions: Workers `Editor` at the product scope, or the legacy `Workers Scripts Edit`/Write permission.
- Account `D1 Edit`/Write for database creation and migrations.
- Account `Access: Apps and Policies Edit`/Write.
- Zone `Workers Routes Edit`/Write for the custom hostname.

Permission labels differ between the legacy and current Cloudflare UI. See [Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/), [D1 creation permissions](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/), and [Access API permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/). The deployment token is used only by Terraform and Wrangler; it is never bound to the application Worker.

## Plan and deploy

```sh
npm run deploy:cloudflare:plan
```

This builds the standalone application into `.cloudflare-build/`, initializes the pinned Cloudflare provider, validates the configuration, and saves a real API-backed plan to `infra/terraform/release.tfplan`. Review the resource changes in that output. Planning does not create cloud resources.

```sh
npm run deploy:cloudflare:apply
terraform -chdir=infra/terraform output -raw url
```

The apply command executes that saved plan immediately. It checks a receipt against the plan, compiled modules, static files, migrations, deployment scripts, dependency lockfiles, and Terraform inputs first. If any have changed, create and review a new plan. Keep the plan and build in the same checkout and directory until the apply completes.

During apply, Terraform creates D1, runs `wrangler d1 migrations apply --remote` against its exact database ID, then uploads and publishes the Worker version. Failed migrations stop publication of the new version. Cloudflare provisions the custom domain and certificate; DNS/certificate activation may take additional time. Open the output URL and sign in with an allowed address.

The build's placeholder local database ID is never used for deployment: Terraform supplies the new D1 ID. The `DB` and `ASSETS` bindings and the Access application audience are wired from the provisioned resources. [Cloudflare supports uploading Worker modules and assets through Terraform](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/).

## Identity and operation

Every request, including static assets, passes through the Worker guard. It verifies the Access JWT signature, issuer, audience, and expiry using the team's signing keys, enforces the configured HTTPS origin, and removes incoming application identity headers before constructing a verified owner identity. The account's existing IdP performs sign-in. `workers.dev` and preview URLs are disabled. This follows [Cloudflare's JWT validation guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

This standalone deployment has a new D1 database. Owners are identified by `cf-access:<Access subject>`. Existing Sites/ChatGPT watches are not automatically migrated or linked by email. The Sites deployment remains separately managed; `npm run build` still builds for Sites, while `npm run build:cloudflare` builds for this Terraform deployment.

Monitoring retains the current product behavior: approximately 60-second polling while the application is open. Closing the application pauses checks. This deployment does not add a background scheduler or an external notification service.

Worker observability is enabled with 10% head sampling and query-string redaction. Use Cloudflare's Worker and Access dashboards to inspect errors and sign-in failures. After deployment, confirm sign-in, a saved watch that survives reload, live markets, and denial of an address outside `allowed_emails`.

## Updates, state, and recovery

Run the same plan/apply commands for updates. New server code or static assets force a new immutable Worker version, and the deployment routes 100% of traffic to it. Terraform owns these resources; coordinate dashboard changes with Terraform before the next release.

Keep applied SQL migration files immutable and append new migrations. D1 records which files have run. Use backward-compatible schema changes because the previous Worker remains active while migrations run. A failed migration rolls back that migration, not earlier migrations; a Worker upload failure may therefore leave successful schema changes in place. See [D1 migration behavior](https://developers.cloudflare.com/d1/reference/migrations/).

The D1 resource has `prevent_destroy = true`. A rename or configuration change that requires replacement will fail rather than remove the database. That guard is not a backup: confirm the account's [D1 Time Travel retention and recovery process](https://developers.cloudflare.com/d1/reference/time-travel/) before storing important data. Application rollback and database recovery are separate operations. To roll back code, rebuild a known-good source revision with its compatible migrations retained, review a new plan, and deploy it.

Terraform defaults to local state in this directory. Store state securely and back it up; it records the managed resources and allowed email addresses. For shared production operation, configure your existing encrypted, locking remote backend before the first apply. An HCP Terraform workspace should use **local execution** for these scripts, since the build files and Node/Wrangler migration runner must be present on the applying machine. Use separate state, a unique `name`, and a separate hostname for each environment.

Never commit local `.tfvars`, state, plans, or receipts. The checked-in `.terraform.lock.hcl` is intentional and should be retained.

## Verification without cloud credentials

```sh
npm test
npm run typecheck
npm run lint
npm run build:cloudflare
npm run test:cloudflare
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform test
```

The runtime test runs the compiled production Worker in `workerd`, applies the real SQL schema to an isolated local D1, verifies signed test JWTs, serves the actual assets and SSR, tests account isolation and persistence, and reads live Ink data. Only its Access signing keys are fixtures. It creates no remote Cloudflare resources.

Terraform tests use a mock provider only to validate the resource configuration and parameter rejection without credentials. Normal plan/apply uses the real pinned provider. These checks do not substitute for an authenticated cloud plan, apply, and post-deployment sign-in check in your account.
