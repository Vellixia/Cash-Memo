terraform {
  # Supply bucket and environment-specific key only through reviewed backend config:
  # tofu init -backend-config=bucket=... -backend-config=key=cashmemo/<environment>/state.tfstate
  # Missing bucket/key fails closed. State locking uses S3 conditional writes.
  backend "s3" {
    region       = "ap-southeast-1"
    encrypt      = true
    use_lockfile = true
  }
}

check "reviewed_plan_digest_bound" {
  assert {
    condition     = var.reviewed_plan_sha256 == var.approved_plan_sha256
    error_message = "Applied plan digest must equal protected reviewed-plan digest."
  }
}
