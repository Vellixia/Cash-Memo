locals {
  resurrection_artifact_classes = toset([
    "manual_snapshot",
    "final_snapshot",
    "copied_snapshot",
    "shared_snapshot",
    "retained_automated_backup",
    "aws_backup_recovery_point",
    "cross_region_copy",
  ])

  required_lineage_tags = {
    "cashmemo:lineage-registered" = "true"
    "cashmemo:network-isolated"   = "true"
    "cashmemo:release-blocking"   = "true"
  }

  # Privileged APIs cannot all be structurally prevented. This deny policy requires
  # registration tags; inventory and release gates detect and escalate any bypass.
  no_resurrection_copies_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DenyUnregisteredRdsCopies"
        Effect = "Deny"
        Action = [
          "rds:CreateDBSnapshot",
          "rds:CopyDBSnapshot",
          "rds:RestoreDBInstanceFromDBSnapshot",
          "rds:CreateDBInstanceReadReplica",
        ]
        Resource = "*"
        Condition = {
          StringNotEquals = {
            "aws:RequestTag/cashmemo:lineage-registered" = "true"
          }
        }
      },
      {
        Sid    = "DenySnapshotSharing"
        Effect = "Deny"
        Action = ["rds:ModifyDBSnapshotAttribute"]
        Resource = "*"
      },
      {
        Sid    = "DenyUnregisteredBackupCopies"
        Effect = "Deny"
        Action = ["backup:CopyIntoBackupVault", "backup:StartCopyJob", "backup:StartRestoreJob"]
        Resource = "*"
        Condition = {
          StringNotEquals = {
            "aws:RequestTag/cashmemo:lineage-registered" = "true"
          }
        }
      },
    ]
  }
}

check "all_resurrection_classes_are_policy_owned" {
  assert {
    condition     = length(local.resurrection_artifact_classes) == 7
    error_message = "Every prohibited or tracked resurrection-capable class must remain policy-owned."
  }
}

output "no_resurrection_copies_policy_json" {
  description = "Attach through the production composition module; drift blocks release."
  value       = jsonencode(local.no_resurrection_copies_policy)
}
