variable "cloudflare_api_token" {
  description = "Optional scoped Cloudflare API token. Empty uses CLOUDFLARE_API_TOKEN. Ephemeral: excluded from Terraform plans and state."
  type        = string
  sensitive   = true
  ephemeral   = true
  default     = ""
  nullable    = false
}

variable "account_id" {
  description = "Cloudflare account that owns the Worker, D1 database, Access application, and zone."
  type        = string
  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.account_id))
    error_message = "account_id must be a 32-character Cloudflare account ID."
  }
}

variable "zone_id" {
  description = "Cloudflare DNS zone containing hostname."
  type        = string
  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.zone_id))
    error_message = "zone_id must be a 32-character Cloudflare zone ID."
  }
}

variable "hostname" {
  description = "Unused hostname for this deployment, for example positions.example.com. No scheme or path."
  type        = string
  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,}$", var.hostname))
    error_message = "Use a lowercase DNS hostname, without https:// or a path."
  }
}

variable "name" {
  description = "Unique Worker/resource prefix in this account. Use different names and state for staging and production."
  type        = string
  default     = "optics"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,49}$", var.name))
    error_message = "Use 3–50 lowercase letters, digits, or hyphens, starting with a letter."
  }
}

variable "access_team_domain" {
  description = "Existing Zero Trust team domain, for example my-team.cloudflareaccess.com."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]*\\.cloudflareaccess\\.com$", var.access_team_domain))
    error_message = "Use your existing team.cloudflareaccess.com domain without https://."
  }
}

variable "allowed_emails" {
  description = "Exact user email addresses allowed into this private deployment. At least one is required."
  type        = set(string)
  validation {
    condition     = length(var.allowed_emails) > 0 && alltrue([for email in var.allowed_emails : can(regex("^[^[:space:]@*]+@[^[:space:]@*]+\\.[^[:space:]@*]+$", email))])
    error_message = "Provide at least one valid email address; wildcard and everyone policies are not used."
  }
}

variable "access_identity_provider_ids" {
  description = "Optional existing Access IdP IDs. Empty uses the account's configured providers (including email OTP if enabled)."
  type        = set(string)
  default     = []
}

variable "d1_location_hint" {
  description = "Optional primary location hint for a new database. Null lets Cloudflare choose."
  type        = string
  default     = null
  validation {
    condition     = var.d1_location_hint == null ? true : contains(["wnam", "enam", "weur", "eeur", "apac", "oc"], var.d1_location_hint)
    error_message = "Choose a supported D1 location hint or null."
  }
}
