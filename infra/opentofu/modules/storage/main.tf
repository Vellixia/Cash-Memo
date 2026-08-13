variable "name" { type = string }
variable "aws_account_id" { type = string }
variable "runtime_role_arn" { type = string }
variable "worker_role_arn" { type = string }
variable "restore_role_arn" { type = string }
variable "deployment_role_arn" { type = string }

locals {
  classes = {
    exports         = { readers = [var.runtime_role_arn, var.worker_role_arn], writers = [var.worker_role_arn] }
    evidence        = { readers = [var.deployment_role_arn], writers = [var.deployment_role_arn] }
    deletion-ledger = { readers = [var.worker_role_arn, var.restore_role_arn], writers = [var.worker_role_arn, var.restore_role_arn] }
  }
}

resource "aws_kms_key" "class" {
  for_each                = local.classes
  description             = "${var.name} ${each.key} encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "AccountAdministration", Effect = "Allow", Principal = { AWS = "arn:aws:iam::${var.aws_account_id}:root" }, Action = "kms:*", Resource = "*" },
    { Sid = "ClassUseOnly", Effect = "Allow", Principal = { AWS = distinct(concat(each.value.readers, each.value.writers)) }, Action = ["kms:Decrypt", "kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey"], Resource = "*" },
  ] })
}

resource "aws_kms_alias" "class" {
  for_each      = local.classes
  name          = "alias/${var.name}-${each.key}"
  target_key_id = aws_kms_key.class[each.key].key_id
}

resource "aws_s3_bucket" "class" {
  # checkov:skip=CKV_AWS_18:S3 data events are audited centrally; server-access-log payloads create another sensitive durable class.
  # checkov:skip=CKV_AWS_144:Cross-region replicas conflict with approved residency and deletion-copy reconciliation boundaries.
  # checkov:skip=CKV2_AWS_61:Evidence and ledger retain data without time expiry; explicit multipart-only lifecycle is defined separately.
  for_each = local.classes
  bucket   = "${var.name}-${var.aws_account_id}-${each.key}"
}

resource "aws_s3_bucket_notification" "class" {
  for_each    = local.classes
  bucket      = aws_s3_bucket.class[each.key].id
  eventbridge = true
}

resource "aws_s3_bucket_public_access_block" "class" {
  for_each                = local.classes
  bucket                  = aws_s3_bucket.class[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "class" {
  for_each = local.classes
  bucket   = aws_s3_bucket.class[each.key].id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "class" {
  for_each = local.classes
  bucket   = aws_s3_bucket.class[each.key].id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "class" {
  for_each = local.classes
  bucket   = aws_s3_bucket.class[each.key].id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.class[each.key].arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_policy" "class" {
  for_each = local.classes
  bucket   = aws_s3_bucket.class[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.class[each.key].arn, "${aws_s3_bucket.class[each.key].arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } },
    { Sid = "AllowRead", Effect = "Allow", Principal = { AWS = each.value.readers }, Action = ["s3:GetObject", "s3:ListBucket"], Resource = [aws_s3_bucket.class[each.key].arn, "${aws_s3_bucket.class[each.key].arn}/*"] },
    { Sid = "AllowWrite", Effect = "Allow", Principal = { AWS = each.value.writers }, Action = ["s3:DeleteObject", "s3:GetObject", "s3:ListBucket", "s3:PutObject"], Resource = [aws_s3_bucket.class[each.key].arn, "${aws_s3_bucket.class[each.key].arn}/*"] },
  ] })
}

resource "aws_s3_bucket_lifecycle_configuration" "exports" {
  bucket = aws_s3_bucket.class["exports"].id
  rule {
    id     = "application-expiry-defense-in-depth"
    status = "Enabled"
    expiration { days = 1 }
    noncurrent_version_expiration { noncurrent_days = 1 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "non_expiring" {
  for_each = { for key, value in local.classes : key => value if key != "exports" }
  bucket   = aws_s3_bucket.class[each.key].id
  rule {
    id     = "abort-incomplete-upload-only"
    status = "Enabled"
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}

check "only_approved_storage_classes_exist" {
  assert {
    condition     = toset(keys(local.classes)) == toset(["exports", "evidence", "deletion-ledger"])
    error_message = "Only export, evidence, and deletion-ledger durable storage classes are allowed."
  }
}

output "bucket_arns" { value = { for key, bucket in aws_s3_bucket.class : key => bucket.arn } }
output "kms_key_arns" { value = { for key, key_resource in aws_kms_key.class : key => key_resource.arn } }
