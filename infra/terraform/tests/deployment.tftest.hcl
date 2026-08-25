# Configuration tests only. Production plan/apply uses the real provider.
mock_provider "cloudflare" {
  override_during = plan
  mock_resource "cloudflare_d1_database" {
    defaults = { id = "11111111-1111-4111-8111-111111111111" }
  }
  mock_resource "cloudflare_zero_trust_access_application" {
    defaults = { aud = "test-application-audience" }
  }
  mock_resource "cloudflare_worker_version" {
    defaults = { id = "22222222-2222-4222-8222-222222222222" }
  }
}

variables {
  cloudflare_api_token = "test-fixture-not-a-real-token"
  account_id           = "11111111111111111111111111111111"
  zone_id              = "22222222222222222222222222222222"
  hostname             = "positions.example.com"
  access_team_domain   = "test-team.cloudflareaccess.com"
  allowed_emails       = ["Owner@example.com", "second@example.com"]
}

run "private_fullstack_deployment" {
  command = plan
  assert {
    condition     = !cloudflare_worker.app.subdomain.enabled && !cloudflare_worker.app.subdomain.previews_enabled
    error_message = "The deployment must not expose alternate workers.dev or preview URLs."
  }
  assert {
    condition     = cloudflare_worker_version.app.assets.config.run_worker_first == true
    error_message = "Static assets must pass through the same Access guard as API requests."
  }
  assert {
    condition     = one([for binding in cloudflare_worker_version.app.bindings : binding.id if binding.name == "DB"]) == cloudflare_d1_database.app.id
    error_message = "The deployed Worker must use the provisioned D1 database."
  }
  assert {
    condition     = one([for binding in cloudflare_worker_version.app.bindings : binding.text if binding.name == "ACCESS_AUD"]) == cloudflare_zero_trust_access_application.app.aud
    error_message = "The JWT guard must verify this deployment's Access application audience."
  }
  assert {
    condition     = cloudflare_zero_trust_access_policy.users.decision == "allow" && toset([for rule in cloudflare_zero_trust_access_policy.users.include : rule.email.email]) == toset(["owner@example.com", "second@example.com"])
    error_message = "Access must be limited to the configured exact email addresses."
  }
  assert {
    condition     = cloudflare_workers_custom_domain.app.hostname == var.hostname && output.url == "https://positions.example.com"
    error_message = "The route and app origin must agree with the configured hostname."
  }
  assert {
    condition     = one(cloudflare_workers_deployment.app.versions).version_id == cloudflare_worker_version.app.id && one(cloudflare_workers_deployment.app.versions).percentage == 100
    error_message = "The deployment must publish the built version at 100 percent."
  }
}

run "reject_empty_allowlist" {
  command = plan
  variables { allowed_emails = [] }
  expect_failures = [var.allowed_emails]
}

run "reject_wildcard_allowlist" {
  command = plan
  variables { allowed_emails = ["*@example.com"] }
  expect_failures = [var.allowed_emails]
}

run "reject_hostname_with_scheme" {
  command = plan
  variables { hostname = "https://positions.example.com" }
  expect_failures = [var.hostname]
}

run "reject_untrusted_team_domain" {
  command = plan
  variables { access_team_domain = "example.com" }
  expect_failures = [var.access_team_domain]
}
