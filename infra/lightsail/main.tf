locals {
  project_root = abspath("${path.module}/../..")
  build_root   = "${local.project_root}/.lightsail-build"
  release      = jsondecode(file("${local.build_root}/manifest.json"))
  hostname     = var.subdomain == "@" ? var.domain : "${var.subdomain}.${var.domain}"
  zone         = var.availability_zone == null ? "${var.aws_region}a" : var.availability_zone
  config = {
    origin                    = "https://${local.hostname}"
    auto_approve_email_domain = var.auto_approve_email_domain
    acme_email                = var.acme_email
  }
  deploy_script_hash = sha256(join("", [for name in sort(tolist(fileset("${local.project_root}/deploy/lightsail", "**"))) : filesha256("${local.project_root}/deploy/lightsail/${name}")]))
}
resource "terraform_data" "artifact" {
  input = local.release.sha256
  lifecycle {
    precondition {
      condition     = local.release.target == "lightsail-node" && local.release.sha256 == filesha256("${local.build_root}/release.tar.gz")
      error_message = "Run npm run build:lightsail before planning; the release must match its manifest."
    }
  }
}
resource "aws_lightsail_instance" "app" {
  # Establish IP capacity before creating billable compute/storage resources.
  depends_on        = [aws_lightsail_static_ip.app]
  name              = var.name
  availability_zone = local.zone
  blueprint_id      = "ubuntu_24_04"
  bundle_id         = var.lightsail_bundle_id
  ip_address_type   = "ipv4"
  user_data         = file("${local.project_root}/deploy/lightsail/bootstrap.sh")
  add_on {
    type          = "AutoSnapshot"
    status        = "Enabled"
    snapshot_time = "03:00"
  }
}
resource "aws_lightsail_static_ip" "app" {
  name = "${var.name}-ip"
}
resource "aws_lightsail_static_ip_attachment" "app" {
  static_ip_name = aws_lightsail_static_ip.app.name
  instance_name  = aws_lightsail_instance.app.name
  lifecycle { replace_triggered_by = [aws_lightsail_instance.app] }
}
resource "aws_lightsail_instance_public_ports" "app" {
  instance_name = aws_lightsail_instance.app.name
  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
    cidrs     = ["0.0.0.0/0"]
  }
  port_info {
    protocol  = "tcp"
    from_port = 443
    to_port   = 443
    cidrs     = ["0.0.0.0/0"]
  }
  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
    cidrs     = ["${var.namecheap_client_ip}/32"]
    # AWS's authenticated browser SSH service also witnesses the host keys
    # returned by GetInstanceAccessDetails for strict SSH verification.
    cidr_list_aliases = ["lightsail-connect"]
  }
  lifecycle { replace_triggered_by = [aws_lightsail_instance.app] }
}
resource "aws_lightsail_disk" "data" {
  depends_on        = [aws_lightsail_static_ip.app]
  name              = "${var.name}-data"
  size_in_gb        = var.data_disk_size_gb
  availability_zone = local.zone
  lifecycle { prevent_destroy = true }
}
resource "aws_lightsail_disk_attachment" "data" {
  disk_name     = aws_lightsail_disk.data.name
  instance_name = aws_lightsail_instance.app.name
  disk_path     = "/dev/xvdf"
  lifecycle { replace_triggered_by = [aws_lightsail_instance.app] }
}
# Same MERGE pattern as profile-test/terraform/modules/namecheap-records.
resource "namecheap_domain_records" "app" {
  domain = var.domain
  mode   = "MERGE"
  record {
    hostname = var.subdomain
    type     = "A"
    address  = aws_lightsail_static_ip.app.ip_address
    ttl      = var.dns_ttl
  }
  depends_on = [aws_lightsail_static_ip_attachment.app]
}
resource "terraform_data" "deploy" {
  triggers_replace = [
    aws_lightsail_instance.app.id,
    local.release.sha256,
    local.deploy_script_hash,
    sha256(jsonencode(local.config)),
    var.configuration_revision,
  ]
  provisioner "local-exec" {
    working_dir = local.project_root
    command     = "node scripts/provision-lightsail.mjs"
    environment = {
      POSITION_LENS_REGION        = var.aws_region
      POSITION_LENS_AWS_PROFILE   = var.aws_profile == null ? "" : var.aws_profile
      POSITION_LENS_INSTANCE      = aws_lightsail_instance.app.name
      POSITION_LENS_STATIC_IP     = aws_lightsail_static_ip.app.ip_address
      POSITION_LENS_DISK          = aws_lightsail_disk.data.name
      POSITION_LENS_CONFIG_JSON   = jsonencode(local.config)
      POSITION_LENS_SLACK_WEBHOOK = var.slack_webhook_url
    }
  }
  depends_on = [terraform_data.artifact, aws_lightsail_instance_public_ports.app, aws_lightsail_disk_attachment.data, namecheap_domain_records.app]
}
