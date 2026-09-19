
# access state for shared resources (primary DNS zone, dev VPC and dev caches)
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket = var.shared_state_bucket
    key    = var.shared_state_key
    region = var.shared_state_region
  }
}
