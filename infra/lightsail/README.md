# Optics on Lightsail and Namecheap

This is the default deployment target. It follows the Lightsail/static-IP/DNS pattern in artbattle/profile-test/terraform and the SSH release delivery pattern in artbattle/google-profile/deel-payment-app/terraform.

Terraform creates a Linux Lightsail instance, attaches a static IPv4 address and a separate persistent data disk, merges an A record into Namecheap DNS, and deploys the full application. Caddy provides HTTPS and renewal. OAuth2 Proxy provides OIDC sign-in. The compiled Vinext Node server runs the real APIs against SQLite and live Ink RPCs.

## What you need to provide

1. **AWS credentials** in your existing AWS CLI configuration, SSO session, or environment. Optionally select an aws_profile.
2. **A registered Namecheap domain using Namecheap DNS**, its account username/API key, and your deploying machine's public IPv4 address. Enable API access and allowlist that IPv4 in Namecheap. Terraform manages DNS for the existing domain; it does not purchase or transfer it.
3. **An OIDC web application**, for example in Google, Auth0, or another OIDC provider: issuer URL, client ID, client secret, and the exact allowed email addresses. Register https://YOUR_HOSTNAME/oauth2/callback as its callback. Enable the provider's openid/email/profile scopes and authorization-code flow with PKCE. Emails must be verified by the provider.
4. **An email for certificate notices**, and the desired domain/subdomain.

No Cloudflare account, Web3 private key, funded wallet, contract deployment, or paid RPC credential is required.

The deployer needs Node 22.18+, Terraform 1.10+, AWS CLI v2, OpenSSH (ssh/scp), and tar. The server installs pinned Node 24.21.0, Caddy 2.11.4, and OAuth2 Proxy 7.15.4 from official archives after verifying their checksums.

## Fill the parameters and deploy

From the project directory:

```sh
npm ci
cp infra/lightsail/terraform.tfvars.example infra/lightsail/terraform.tfvars
chmod 600 infra/lightsail/terraform.tfvars
```

Fill the ignored terraform.tfvars. The main settings are:

| Setting                            | What to put there                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| aws_region, optional aws_profile   | The AWS region and configured credential profile.                                      |
| name                               | Unique Lightsail resource prefix, default optics.                               |
| domain                             | Existing registered root domain, such as example.com.                                  |
| subdomain                          | positions for positions.example.com, or @ for the apex.                                |
| namecheap_user_name                | Namecheap account username.                                                            |
| namecheap_client_ip                | Your public IPv4, allowlisted at Namecheap. SSH is restricted to this address too.     |
| namecheap_api_key                  | API key, or supply NAMECHEAP_API_KEY / TF_VAR_namecheap_api_key.                       |
| acme_email                         | Certificate contact email.                                                             |
| oidc_issuer_url                    | Provider's HTTPS issuer, e.g. https://accounts.google.com.                             |
| oidc_client_id, oidc_client_secret | Credentials for your registered OIDC web application.                                  |
| allowed_emails                     | Exact verified email addresses permitted to sign in.                                   |
| lightsail_bundle_id                | Lightsail instance size, default small_3_0; check regional availability.               |
| data_disk_size_gb                  | Separate persistent disk size, default 8 GB.                                           |
| configuration_revision             | Increment after changing an ephemeral OIDC secret so configuration is delivered again. |

Both API keys and the OIDC client secret are sensitive, ephemeral Terraform inputs. They are excluded from Terraform plan/state. You can put them in the ignored parameter file or environment (TF_VAR_oidc_client_secret for OIDC). Keep them available for both plan and apply; do not paste them into chat.

```sh
npm run deploy:plan
# Review the saved plan.
npm run deploy:apply
terraform -chdir=infra/lightsail output
```

The plan command builds the real Node application and saves an AWS/Namecheap-backed plan. The apply command checks that its plan, artifact, migration files, deploy scripts, and configuration have not changed, then executes that exact plan. Creating these resources incurs the usual AWS charges. No resources are created by the local tests.

The apply waits for bootstrap, uses temporary Lightsail SSH credentials and host keys obtained through the authenticated AWS API, uploads the release over SSH, installs production dependencies, applies SQL migrations, checks the application and auth proxy, then checks public HTTPS. There is no public artifact bucket and no private SSH key saved in Terraform state.

DNS and certificates can take time to activate. An apply that fails late may already have created resources; correct the reported issue, create a new plan, and apply again. Keep the same state.

## AWS and Namecheap permissions

The AWS identity needs Lightsail read/create/update/delete permissions for instances, disks and attachments, static IPs, firewall ports, tags, snapshots and add-ons, plus lightsail:GetInstanceAccessDetails for release delivery. The deployment uses [lightsail:EnableAddOn](https://docs.aws.amazon.com/cli/latest/reference/lightsail/enable-add-on.html) to enable daily snapshots on the data disk. It does not require EC2, IAM-role creation, S3, or Route 53 provisioning.

Namecheap API access must be enabled, and the domain must use BasicDNS, FreeDNS, or PremiumDNS. The MERGE resource manages the application's A record while retaining unrelated DNS records. Use an unused hostname and review the plan for an existing record at that hostname. See [Namecheap provider record management](https://registry.terraform.io/providers/namecheap/namecheap/latest/docs/resources/domain_records).

Only TCP 80 and 443 are public. SSH is restricted to namecheap_client_ip/32; update that parameter when your deployer IP changes. The application and auth proxy listen on loopback only. Temporary SSH host keys are checked against the keys returned by [Lightsail's authenticated access-details API](https://docs.aws.amazon.com/cli/latest/reference/lightsail/get-instance-access-details.html).

## Persistent data and updates

SQLite, certificate storage, session-cookie keys, and database backups reside on the separate disk mounted at /srv/position-lens-data. Terraform prevents that disk's destruction. Changes to app code update a release directory and restart the service without replacing the disk or instance. A failed app health check attempts to restart the previous release. Schema migrations are not automatically reversed.

Keep applied SQL files immutable and append new migrations. The migrator tracks filename/checksum, applies each migration in a transaction, and refuses changed historical migrations. A consistent SQLite backup is made before updates and nightly; local backup copies are retained for seven days. Daily Lightsail snapshots are enabled for both the instance and data disk. Check snapshot completion and practice restoration in your account before relying on them.

This is a single-server deployment. Updates have a brief restart window; it is not an HA cluster. Resource resizing/replacement may require a planned outage while the static IP and disk are reattached. The disk guard is not a substitute for tested backups.

Terraform defaults to local state. Protect and back up state, or configure your existing encrypted, locking remote backend before the first production apply. Remote-state services should use local execution here: the applying machine needs the build files, Node, AWS CLI, and SSH access. Use separate state, resource names, and hostnames for different environments.

The former Cloudflare/Sites deployments have separate databases and identities. Existing watches are not silently imported or linked by email. The application keeps its current browser-open monitoring behavior; this deployment does not add background position checks or external notifications.

## Check the live deployment

Open the output URL, sign in through your OIDC provider, save a public address, and verify it remains after reload. Check that an email outside the allowlist is denied. Verify the live markets and your snapshot jobs.

From an authorized Lightsail SSH session:

```sh
sudo systemctl status position-lens position-lens-auth caddy
sudo journalctl -u position-lens -u position-lens-auth -u caddy --since '15 minutes ago'
sudo systemctl list-timers position-lens-backup.timer
curl -f http://127.0.0.1:3000/_health
```

If deployment fails during bootstrap, inspect sudo cloud-init status --long and /var/log/cloud-init-output.log. If sign-in fails, verify the issuer, callback URI, client credentials, verified email claim, and allowlist.

## Local verification

```sh
npm run check:production
```

This runs type checking, lint, unit tests, the production dependency audit, a production Node build, both runtime integration suites, and Terraform validation/configuration tests. It needs network access for official release archives, dependency metadata, Terraform providers, and live Ink RPCs. No cloud resources are created.

The authentication suite (`npm run test:auth`, after `npm run build:lightsail`) runs the same pinned **Caddy and OAuth2 Proxy executables** as production in front of the compiled app and a temporary real SQLite database. The test downloads official, checksum-verified archives into ignored `work/auth-binaries`; macOS arm64 and Linux x64 are supported. OpenSSL generates a temporary test certificate without changing the system trust store. Only ports, certificate paths, and temporary storage differ from the generated deployment configuration. A second phase shortens cookie lifetime to test expiry.

A local HTTPS OIDC issuer supplies signed test identities. The suite exercises discovery, authorization code exchange with PKCE, nonce and signature verification, the verified-email allowlist, secure session cookies, sign-out, expiry, forged headers, callback replay, cross-origin writes, stable subject-based ownership, and persistence after an app restart. It rejects unverified/outside emails and tokens with invalid signatures, issuer, audience, nonce, or expiry. This verifies the real login service; your provider's client registration and credentials still require a successful sign-in after deployment.

Expired or missing API sessions return HTTP 401 through OAuth2 Proxy's [API route configuration](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/). The app pauses automatic checks and displays a top-level **Sign in again** link. Login is never attempted through a background API fetch.

The separate Node runtime suite (`npm run test:lightsail`) uses trusted-proxy identity fixtures to cover the broader APIs, real migrations, live Ink data, owner isolation, CSRF rejection, restart persistence, and cascading deletion.

Terraform configuration tests use mock providers without cloud credentials. Normal plan/apply uses the real AWS and Namecheap providers. Provider schemas, local runtime tests, and config validation do not establish that a deployment has succeeded in your AWS account.

The verified-activity replay suite (`npm run test:replay`) checks retained receipt evidence, event indexing and recovery against recorded inputs. Live receipt reads use Ink RPC; recorded blocks preserve their capture provenance.

The optional Cloudflare target remains documented in [the Cloudflare guide](../terraform/README.md) and has explicit deploy:cloudflare:plan / deploy:cloudflare:apply commands.
