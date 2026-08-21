locals {
  project_root = abspath("${path.module}/../..")
  build_root   = "${local.project_root}/.cloudflare-build"
  manifest     = jsondecode(file("${local.build_root}/manifest.json"))
  origin       = "https://${var.hostname}"

  # The build script inventories and hashes every uploaded file. A changed
  # server module OR static asset creates a new immutable Worker version.
  artifact_hash = sha256(jsonencode({
    manifest = local.manifest
    server   = { for name in local.manifest.server_modules : name => filesha256("${local.build_root}/server/${name}") }
    client   = { for name in local.manifest.client_files : name => filesha256("${local.build_root}/client/${name}") }
  }))
  migration_hash = sha256(jsonencode({
    for name in sort(tolist(fileset("${local.project_root}/drizzle", "*.sql"))) :
    name => filesha256("${local.project_root}/drizzle/${name}")
  }))
  modules = concat(
    [for name in local.manifest.server_modules : {
      name         = name
      content_file = "${local.build_root}/server/${name}"
      content_type = endswith(name, ".wasm") ? "application/wasm" : "application/javascript+module"
    }],
    [for name in ["_headers", "_redirects"] : {
      name         = name
      content_file = "${local.build_root}/client/${name}"
      content_type = "text/plain"
    } if fileexists("${local.build_root}/client/${name}")],
  )
}

resource "terraform_data" "artifact" {
  input = local.artifact_hash
  lifecycle {
    precondition {
      condition     = local.manifest.format == 1 && local.manifest.target == "cloudflare-access"
      error_message = "Build the standalone artifact with npm run build:cloudflare before planning."
    }
  }
}

resource "cloudflare_d1_database" "app" {
  account_id            = var.account_id
  name                  = "${var.name}-db"
  primary_location_hint = var.d1_location_hint
  read_replication      = { mode = "disabled" }
  lifecycle {
    prevent_destroy = true
  }
}

# D1 has no SQL-migration Terraform resource. Wrangler tracks applied SQL files
# in D1; a failed migration stops this apply before a new version is published.
resource "terraform_data" "migrations" {
  triggers_replace = [cloudflare_d1_database.app.id, local.migration_hash]
  provisioner "local-exec" {
    working_dir = local.project_root
    command     = "node scripts/migrate-cloudflare.mjs"
    environment = merge({
      CLOUDFLARE_ACCOUNT_ID = var.account_id
      POSITION_LENS_D1_ID   = cloudflare_d1_database.app.id
      POSITION_LENS_D1_NAME = cloudflare_d1_database.app.name
    }, var.cloudflare_api_token == "" ? {} : { CLOUDFLARE_API_TOKEN = var.cloudflare_api_token })
  }
}

resource "cloudflare_zero_trust_access_policy" "users" {
  account_id       = var.account_id
  name             = "${var.name}-users"
  decision         = "allow"
  session_duration = "24h"
  include          = [for email in sort(tolist(var.allowed_emails)) : { email = { email = lower(email) } }]
}

resource "cloudflare_zero_trust_access_application" "app" {
  account_id                 = var.account_id
  name                       = var.name
  type                       = "self_hosted"
  domain                     = var.hostname
  session_duration           = "24h"
  http_only_cookie_attribute = true
  same_site_cookie_attribute = "lax"
  allowed_idps               = length(var.access_identity_provider_ids) > 0 ? var.access_identity_provider_ids : null
  policies = [{
    id         = cloudflare_zero_trust_access_policy.users.id
    precedence = 1
  }]
}

resource "cloudflare_worker" "app" {
  account_id = var.account_id
  name       = var.name
  subdomain  = { enabled = false, previews_enabled = false }
  observability = {
    enabled             = true
    head_sampling_rate  = 0.1
    redact_query_string = true
  }
}

resource "cloudflare_worker_version" "app" {
  account_id          = var.account_id
  worker_id           = cloudflare_worker.app.id
  main_module         = local.manifest.main_module
  compatibility_date  = local.manifest.compatibility_date
  compatibility_flags = local.manifest.compatibility_flags
  modules             = local.modules
  assets = {
    directory = "${local.build_root}/client"
    config = {
      html_handling      = "none"
      not_found_handling = "none"
      run_worker_first   = true
    }
  }
  bindings = [
    { name = "DB", type = "d1", id = cloudflare_d1_database.app.id },
    { name = "ASSETS", type = "assets" },
    { name = "ACCESS_TEAM_DOMAIN", type = "plain_text", text = var.access_team_domain },
    { name = "ACCESS_AUD", type = "plain_text", text = cloudflare_zero_trust_access_application.app.aud },
    { name = "APP_ORIGIN", type = "plain_text", text = local.origin },
  ]
  annotations = { workers_message = "Optics ${substr(local.artifact_hash, 0, 16)}" }
  depends_on  = [terraform_data.migrations]
  lifecycle {
    create_before_destroy = true
    replace_triggered_by  = [terraform_data.artifact]
  }
}

resource "cloudflare_workers_deployment" "app" {
  account_id  = var.account_id
  script_name = cloudflare_worker.app.name
  strategy    = "percentage"
  versions    = [{ version_id = cloudflare_worker_version.app.id, percentage = 100 }]
}

resource "cloudflare_workers_custom_domain" "app" {
  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = var.hostname
  service    = cloudflare_worker.app.name
  depends_on = [cloudflare_workers_deployment.app, cloudflare_zero_trust_access_application.app]
}
