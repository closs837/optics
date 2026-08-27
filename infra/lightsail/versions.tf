terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.66.0"
    }
    namecheap = {
      source  = "namecheap/namecheap"
      version = "2.9.3"
    }
  }
}
provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
  default_tags {
    tags = { Application = "optics", ManagedBy = "Terraform" }
  }
}
provider "namecheap" {
  user_name   = var.namecheap_user_name
  api_user    = var.namecheap_api_user == "" ? var.namecheap_user_name : var.namecheap_api_user
  api_key     = var.namecheap_api_key == "" ? null : var.namecheap_api_key
  client_ip   = var.namecheap_client_ip
  use_sandbox = false
}
