output "url" {
  value = "https://${local.hostname}"
}
output "static_ip" {
  value = aws_lightsail_static_ip.app.ip_address
}
output "instance_name" {
  value = aws_lightsail_instance.app.name
}
output "data_disk_name" {
  value = aws_lightsail_disk.data.name
}
output "release_sha256" {
  value = local.release.sha256
}
