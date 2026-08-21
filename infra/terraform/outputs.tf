output "url" {
  description = "Deployment URL, protected by Cloudflare Access."
  value       = local.origin
}

output "worker_name" {
  value = cloudflare_worker.app.name
}

output "worker_version_id" {
  value = cloudflare_worker_version.app.id
}

output "database_id" {
  value = cloudflare_d1_database.app.id
}

output "access_application_id" {
  value = cloudflare_zero_trust_access_application.app.id
}

output "artifact_sha256" {
  description = "Fingerprint of the exact modules and static files used by this release."
  value       = local.artifact_hash
}
