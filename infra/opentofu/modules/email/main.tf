variable "name" { type = string }
variable "domain_name" { type = string }
variable "event_topic_arn" { type = string }

resource "aws_ses_domain_identity" "this" { domain = var.domain_name }
resource "aws_ses_domain_dkim" "this" { domain = aws_ses_domain_identity.this.domain }

resource "aws_sesv2_configuration_set" "this" {
  configuration_set_name = var.name
  reputation_options { reputation_metrics_enabled = true }
  sending_options { sending_enabled = true }
  suppression_options { suppressed_reasons = ["BOUNCE", "COMPLAINT"] }
}

resource "aws_sesv2_configuration_set_event_destination" "content_free" {
  configuration_set_name = aws_sesv2_configuration_set.this.configuration_set_name
  event_destination_name = "content-free-delivery-status"
  event_destination {
    enabled              = true
    matching_event_types = ["BOUNCE", "COMPLAINT", "DELIVERY", "REJECT"]
    sns_destination { topic_arn = var.event_topic_arn }
  }
}

output "identity_arn" { value = aws_ses_domain_identity.this.arn }
output "configuration_set_name" { value = aws_sesv2_configuration_set.this.configuration_set_name }
output "dkim_tokens" { value = aws_ses_domain_dkim.this.dkim_tokens }
