# Optics on Lightsail and Namecheap

Use this directory to deploy `https://optics.ink`. Terraform provisions a `medium_3_0` instance in `ca-central-1`, a static IPv4, an 8 GB persistent disk, firewall rules, snapshots, and a Namecheap DNS A record. Caddy terminates HTTPS and proxies to the compiled Node application. SQLite stores real accounts and workspace data; chain reads use live Ink RPCs.

## Parameters and deployment

AWS credentials use your existing CLI profile or standard environment. The ignored `terraform.tfvars.json` contains the reused Namecheap credentials, Slack webhook, hostname and deployer IP. Alternatively copy `terraform.tfvars.example` to `terraform.tfvars` and fill it in. Protect local configuration and state; do not commit either. Avoid creating both parameter files with conflicting values.

| Parameter | Default / purpose |
| --- | --- |
| `aws_region` | `ca-central-1` |
| `lightsail_bundle_id` | `medium_3_0` (4 GB RAM, 2 vCPUs) |
| `domain`, `subdomain` | `optics.ink`, `@` for the apex |
| `namecheap_user_name`, `namecheap_api_user`, `namecheap_api_key` | Existing Namecheap API credentials |
| `namecheap_client_ip` | `177.16.198.241`; Namecheap allowlist and SSH source |
| `auto_approve_email_domain` | `inkfnd.com`; exact match only |
| `slack_webhook_url` | Optional access notification webhook |
| `acme_email` | Optional certificate contact email; empty is supported |
| `configuration_revision` | Increment after rotating the Slack webhook |

The API key and Slack webhook are sensitive ephemeral inputs and are excluded from saved plans and state. Keep them available during plan and apply. The server generates its authentication secret on the persistent disk; it is never an output or a Terraform parameter. No OIDC, mail service, Cloudflare account, funded wallet or Web3 private key is required.

```sh
npm ci
npm run check:production
npm run deploy:plan
# Review the saved plan, then apply the exact release.
npm run deploy:apply
terraform -chdir=infra/lightsail output
```

Requires Node 22.18+, Terraform 1.10+, AWS CLI v2, OpenSSH and tar. The server installs checksum-verified Node 24.21.0 and Caddy 2.11.4. Release delivery uses temporary SSH credentials and host keys obtained through the authenticated Lightsail API. The installer migrates the database, starts the service and checks public HTTPS registration.

The AWS identity needs Lightsail permissions for instances, disks, attachments, static IPs, ports, tags and snapshots, including `GetInstanceAccessDetails` and `EnableAddOn`. Namecheap API access must be enabled and the domain must use Namecheap DNS. DNS uses MERGE mode to retain unrelated records. The apply creates billable resources. A late failure may leave resources running; keep the state and fix/reapply rather than starting over.

## Accounts and approval

Anyone can register an email and password. An exact `inkfnd.com` domain is immediately approved, including case-normalized addresses. All other domains, subdomains and lookalikes stay pending. Pending users can sign in and manage their password, but every workspace/API request is blocked until approval. Approval status is server-owned and cannot be set by a registration request. There is no email verification, so this rule does not establish identity or domain ownership. It never grants administrative access.

Manage accounts over your authorized SSH connection:

```sh
sudo optics-accounts list
sudo optics-accounts approve person@example.com
sudo optics-accounts block person@example.com
sudo optics-accounts reset-link person@example.com
```

Approvals and blocks are recorded in the database. Blocking revokes existing sessions immediately. Only the server operator can issue recovery links; independently confirm the account holder before sharing one. A link is single-use, expires in one hour and revokes all sessions after use. Its token is placed in a URL fragment, not server request logs. No reset emails are sent. Signed-in users can change their own password with their current password at `/auth?mode=password`.

Authentication uses Better Auth with scrypt password hashing, Secure/HttpOnly/SameSite cookies, persistent sessions, same-origin mutations and persistent login throttling. The canonical HTTPS host is enforced, and incoming identity headers are stripped. Missing/expired sessions return API 401; pending accounts return 403. Workspace data belongs to a stable account ID, never an unverified email claim.

The optional Slack webhook receives an account email, site URL and time after an approved user opens the workspace, at most once per account every 15 minutes per process. No passwords, cookies or recovery tokens are included. Delivery failure does not block access. Access notices do not enable background financial alerts.

## Operations and recovery

Only ports 80 and 443 are public. SSH is limited to the deployer IP and AWS's managed `lightsail-connect` browser SSH service; Node listens on loopback. Caddy handles certificate renewal.

```sh
sudo systemctl status position-lens caddy
sudo journalctl -u position-lens -u caddy --since '15 minutes ago'
sudo systemctl list-timers position-lens-backup.timer
curl -f http://127.0.0.1:3000/_health
```

Persistent storage is mounted at `/srv/position-lens-data`: SQLite under `app`, authentication secret under `secrets`, certificates under `caddy`, consistent SQLite backups under `backups`. The disk is protected from Terraform destruction. Backups run before updates and nightly, with seven days of local copies. Lightsail daily snapshots cover both instance and disk. Check snapshot completion and practice restoration, including restoring the authentication secret with the database. Protect and back up local Terraform state or configure an encrypted locking backend.

Updates install a versioned release and briefly restart the app. A failed health check attempts to restart the previous release; SQL migrations are not rolled back. Applied migrations are immutable and checksum-checked. This is a single-instance deployment, not an HA cluster. Monitoring runs approximately every 60 seconds while a browser is open, not as a background service.

## Validation

Deployment verified on 2026-09-22: `https://optics.ink`, Montreal `ca-central-1a`, static IP `3.98.195.59`, release `89826d34f7bfb1143249207690a1839c0375f523364421491e1ee3fe11d9fe78`. Public HTTPS, registration, pending-account restrictions, operator approval, logout, live Ink RPC and watch persistence passed on the deployed server. The temporary test account was removed. The SQLite backup passed its integrity check, both daily snapshot schedules are enabled, and the final Terraform plan reported no changes. Full snapshot restoration has not been exercised.

`npm run check:production` runs type/lint/unit checks, dependency auditing, the Node release build, real Caddy HTTPS account tests, live Ink API/persistence tests, and Terraform validation with mock-provider tests. Tests use temporary SQLite databases and never send real Slack messages or provision cloud resources. Tests cover immediate/pending approval, tampering, operator approval/blocking, password changes, recovery, secure cookies, CSRF, expiry, persisted throttling, owner isolation and restart persistence.

The verified-activity replay suite (`npm run test:replay`) checks retained receipt evidence, event indexing and recovery against recorded inputs. Live receipt reads use Ink RPC; recorded blocks preserve their capture provenance.

The optional Sites preview has separate identities and storage and is not the Lightsail production deployment.
