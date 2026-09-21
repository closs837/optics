mock_provider "aws" {
  override_during = plan
  mock_resource "aws_lightsail_static_ip" {
    defaults = { ip_address = "192.0.2.10" }
  }
}
mock_provider "namecheap" {}
variables {
  domain              = "example.com"
  namecheap_user_name = "fixture-user"
  namecheap_api_key   = "fixture-not-a-real-key"
  namecheap_client_ip = "203.0.113.10"
  acme_email          = "owner@example.com"
}
run "lightsail_dns_and_persistence" {
  command = plan
  assert {
    condition     = namecheap_domain_records.app.mode == "MERGE" && one(namecheap_domain_records.app.record).address == aws_lightsail_static_ip.app.ip_address
    error_message = "Namecheap must merge the static-IP A record without owning unrelated DNS."
  }
  assert {
    condition     = aws_lightsail_instance.app.ip_address_type == "ipv4" && aws_lightsail_disk_attachment.data.disk_path == "/dev/xvdf"
    error_message = "The app must use the configured IPv4 deployment and persistent disk attachment."
  }
  assert {
    condition     = toset([for rule in aws_lightsail_instance_public_ports.app.port_info : rule.from_port]) == toset([22, 80, 443])
    error_message = "Only SSH and the HTTP(S) ingress may be exposed."
  }
  assert {
    condition     = one([for rule in aws_lightsail_instance_public_ports.app.port_info : rule.cidrs if rule.from_port == 22]) == toset(["203.0.113.10/32"])
    error_message = "SSH must be restricted to the deployer address."
  }
  assert {
    condition     = one([for rule in aws_lightsail_instance_public_ports.app.port_info : rule.cidr_list_aliases if rule.from_port == 22]) == toset(["lightsail-connect"])
    error_message = "AWS browser SSH must remain available for authenticated host-key discovery and operator access."
  }
  assert {
    condition     = one(aws_lightsail_instance.app.add_on).status == "Enabled" && var.aws_region == "ca-central-1" && aws_lightsail_instance.app.bundle_id == "medium_3_0"
    error_message = "Snapshots and the medium Montreal instance must be configured."
  }
}
run "apex_domain" {
  command = plan
  variables { subdomain = "@" }
  assert {
    condition     = output.url == "https://example.com" && one(namecheap_domain_records.app.record).hostname == "@"
    error_message = "Apex domains must be supported."
  }
}
run "reject_wildcard_approval_domain" {
  command = plan
  variables { auto_approve_email_domain = "*.inkfnd.com" }
  expect_failures = [var.auto_approve_email_domain]
}
run "registration_defaults" {
  command = plan
  assert {
    condition     = local.config.auto_approve_email_domain == "inkfnd.com"
    error_message = "Only the exact configured email domain is automatically approved."
  }
}
