variable "name" {
  description = "Unique Lightsail resource prefix in this AWS region."
  type        = string
  default     = "optics"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,39}$", var.name))
    error_message = "Use 3–40 lowercase letters, numbers or hyphens, starting with a letter."
  }
}
variable "aws_region" {
  type    = string
  default = "ca-central-1"
}
variable "aws_profile" {
  description = "Optional local AWS CLI/profile name. Null uses the standard AWS credential chain."
  type        = string
  default     = null
}
variable "availability_zone" {
  description = "Optional Lightsail availability zone; null uses aws_region + a."
  type        = string
  default     = null
}
variable "lightsail_bundle_id" {
  description = "IPv4 Linux Lightsail plan. The default medium plan has 4 GB RAM and 2 vCPUs."
  type        = string
  default     = "medium_3_0"
}
variable "data_disk_size_gb" {
  type    = number
  default = 8
  validation {
    condition     = var.data_disk_size_gb >= 8 && floor(var.data_disk_size_gb) == var.data_disk_size_gb
    error_message = "Use an integer of at least 8 GB."
  }
}
variable "domain" {
  description = "An already registered root domain using Namecheap DNS, e.g. example.com."
  type        = string
  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,}$", var.domain))
    error_message = "Use a lowercase registered domain without scheme or path."
  }
}
variable "subdomain" {
  description = "DNS record hostname, e.g. positions. Use @ for the domain apex."
  type        = string
  default     = "@"
  validation {
    condition     = var.subdomain == "@" || can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.subdomain))
    error_message = "Use @ or a lowercase DNS hostname."
  }
}
variable "dns_ttl" {
  type    = number
  default = 300
  validation {
    condition     = var.dns_ttl >= 60 && var.dns_ttl <= 60000 && floor(var.dns_ttl) == var.dns_ttl
    error_message = "Namecheap TTL must be an integer from 60 to 60000."
  }
}
variable "namecheap_user_name" {
  type        = string
  description = "Namecheap account username with API access enabled."
}
variable "namecheap_api_user" {
  type    = string
  default = ""
}
variable "namecheap_api_key" {
  description = "Optional API key; empty uses NAMECHEAP_API_KEY. Not saved in Terraform plan/state."
  type        = string
  sensitive   = true
  ephemeral   = true
  default     = ""
}
variable "namecheap_client_ip" {
  description = "Your deployer's public IPv4, allowlisted for Namecheap API access. Also the only SSH source."
  type        = string
  validation {
    condition     = can(cidrnetmask("${var.namecheap_client_ip}/32"))
    error_message = "Use a single public IPv4 address."
  }
}
variable "acme_email" {
  description = "Optional email for certificate renewal notices. Empty uses ACME without an email contact."
  type        = string
  default     = ""
  validation {
    condition     = var.acme_email == "" || can(regex("^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$", var.acme_email))
    error_message = "Provide a valid email or leave empty."
  }
}
variable "auto_approve_email_domain" {
  description = "Exact email domain approved immediately at registration; every other account stays pending. Does not verify email ownership."
  type        = string
  default     = "inkfnd.com"
  validation {
    condition     = can(regex("^[a-z0-9-]+(\\.[a-z0-9-]+)+$", var.auto_approve_email_domain))
    error_message = "Use one exact lowercase email domain, without @ or wildcards."
  }
}
variable "configuration_revision" {
  description = "Increment after rotating the ephemeral Slack webhook to trigger configuration delivery."
  type        = number
  default     = 1
}
variable "slack_webhook_url" {
  description = "Optional existing Slack incoming webhook for authenticated workspace access alerts. Excluded from plan/state."
  type        = string
  sensitive   = true
  ephemeral   = true
  default     = ""
  validation {
    condition     = var.slack_webhook_url == "" || can(regex("^https://hooks\\.slack(-gov)?\\.com/services/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$", var.slack_webhook_url))
    error_message = "Use an HTTPS Slack incoming webhook URL, or leave it empty."
  }
}
