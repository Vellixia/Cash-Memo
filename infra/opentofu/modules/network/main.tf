variable "name" { type = string }
variable "vpc_cidr" { type = string }
variable "availability_zones" {
  type = list(string)
  validation {
    condition     = length(var.availability_zones) >= 2
    error_message = "At least two availability zones are required."
  }
}
variable "public_subnet_cidrs" { type = list(string) }
variable "application_subnet_cidrs" { type = list(string) }
variable "database_subnet_cidrs" { type = list(string) }
variable "certificate_arn" { type = string }
variable "kms_key_arn" { type = string }
variable "application_port" {
  type    = number
  default = 3000
}

locals {
  subnet_count = length(var.availability_zones)
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = var.name }
}

resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id
}

resource "aws_cloudwatch_log_group" "vpc_flow" {
  name              = "/cashmemo/${var.name}/vpc-flow"
  retention_in_days = 365
  kms_key_id        = var.kms_key_arn
}

resource "aws_iam_role" "vpc_flow" {
  name = "${var.name}-vpc-flow"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "vpc-flow-logs.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}

resource "aws_iam_role_policy" "vpc_flow" {
  name = "content-free-flow-log-delivery"
  role = aws_iam_role.vpc_flow.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow"
    Action = [
      "logs:CreateLogStream",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    Resource = "${aws_cloudwatch_log_group.vpc_flow.arn}:*"
  }] })
}

resource "aws_flow_log" "this" {
  iam_role_arn    = aws_iam_role.vpc_flow.arn
  log_destination = aws_cloudwatch_log_group.vpc_flow.arn
  traffic_type    = "REJECT"
  vpc_id          = aws_vpc.this.id
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-internet" }
}

resource "aws_subnet" "public" {
  count                   = local.subnet_count
  vpc_id                  = aws_vpc.this.id
  availability_zone       = var.availability_zones[count.index]
  cidr_block              = var.public_subnet_cidrs[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name}-public-${count.index + 1}", Tier = "public-alb" }
}

resource "aws_subnet" "application" {
  count                   = local.subnet_count
  vpc_id                  = aws_vpc.this.id
  availability_zone       = var.availability_zones[count.index]
  cidr_block              = var.application_subnet_cidrs[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name}-application-${count.index + 1}", Tier = "private-application" }
}

resource "aws_subnet" "database" {
  count                   = local.subnet_count
  vpc_id                  = aws_vpc.this.id
  availability_zone       = var.availability_zones[count.index]
  cidr_block              = var.database_subnet_cidrs[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name}-database-${count.index + 1}", Tier = "private-database" }
}

resource "aws_eip" "nat" {
  count      = local.subnet_count
  domain     = "vpc"
  tags       = { Name = "${var.name}-nat-${count.index + 1}" }
  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  count         = local.subnet_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "${var.name}-nat-${count.index + 1}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table_association" "public" {
  count          = local.subnet_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "application" {
  count  = local.subnet_count
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[count.index].id
  }
  tags = { Name = "${var.name}-application-${count.index + 1}" }
}

resource "aws_route_table_association" "application" {
  count          = local.subnet_count
  subnet_id      = aws_subnet.application[count.index].id
  route_table_id = aws_route_table.application[count.index].id
}

resource "aws_route_table" "database" {
  count  = local.subnet_count
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name}-database-${count.index + 1}" }
}

resource "aws_route_table_association" "database" {
  count          = local.subnet_count
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.database[count.index].id
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public HTTPS boundary only"
  vpc_id      = aws_vpc.this.id
}

resource "aws_security_group" "application" {
  # checkov:skip=CKV2_AWS_5:ECS awsvpc service attaches this module output dynamically.
  name        = "${var.name}-application"
  description = "Private ECS tasks"
  vpc_id      = aws_vpc.this.id
}

resource "aws_security_group" "database" {
  # checkov:skip=CKV2_AWS_5:RDS module attaches this module output dynamically.
  name        = "${var.name}-database"
  description = "Private RDS; no public ingress or internet route"
  vpc_id      = aws_vpc.this.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_application" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Application tasks"
  from_port                    = var.application_port
  to_port                      = var.application_port
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.application.id
}

resource "aws_vpc_security_group_ingress_rule" "application_from_alb" {
  security_group_id            = aws_security_group.application.id
  description                  = "ALB only"
  from_port                    = var.application_port
  to_port                      = var.application_port
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "application_https" {
  security_group_id = aws_security_group.application.id
  description       = "TLS provider and AWS API egress"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "application_to_database" {
  security_group_id            = aws_security_group.application.id
  description                  = "PostgreSQL"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.database.id
}

resource "aws_vpc_security_group_ingress_rule" "database_from_application" {
  security_group_id            = aws_security_group.database.id
  description                  = "ECS tasks only"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.application.id
}

resource "aws_lb" "this" {
  # checkov:skip=CKV_AWS_91:Central ALB access-log destination depends on approved AWS identity in open T233.
  name                       = substr(replace(var.name, "_", "-"), 0, 32)
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  enable_deletion_protection = true
  drop_invalid_header_fields = true
}

resource "aws_wafv2_web_acl" "this" {
  # checkov:skip=CKV2_AWS_31:Raw WAF request logs can contain cookies and user values; only allowlisted aggregate metrics are approved.
  name  = "${var.name}-public"
  scope = "REGIONAL"
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${replace(var.name, "-", "")}-public"
    sampled_requests_enabled   = false
  }
  rule {
    name     = "aws-common"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${replace(var.name, "-", "")}-common"
      sampled_requests_enabled   = false
    }
  }
  rule {
    name     = "aws-known-bad-inputs"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${replace(var.name, "-", "")}-knownbad"
      sampled_requests_enabled   = false
    }
  }
  rule {
    name     = "aws-anonymous-ip"
    priority = 3
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAnonymousIpList"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${replace(var.name, "-", "")}-anonymous"
      sampled_requests_enabled   = false
    }
  }
}

resource "aws_wafv2_web_acl_association" "this" {
  resource_arn = aws_lb.this.arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}

resource "aws_lb_target_group" "application" {
  name        = substr("${replace(var.name, "_", "-")}-app", 0, 32)
  port        = var.application_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.this.id
  health_check {
    path                = "/api/v1/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  deregistration_delay = 30
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.application.arn
  }
}

check "subnet_shapes_match" {
  assert {
    condition = alltrue([
      length(var.public_subnet_cidrs) == local.subnet_count,
      length(var.application_subnet_cidrs) == local.subnet_count,
      length(var.database_subnet_cidrs) == local.subnet_count,
    ])
    error_message = "Each subnet tier must define one CIDR per availability zone."
  }
}

output "vpc_id" { value = aws_vpc.this.id }
output "application_subnet_ids" { value = aws_subnet.application[*].id }
output "database_subnet_ids" { value = aws_subnet.database[*].id }
output "application_security_group_id" { value = aws_security_group.application.id }
output "database_security_group_id" { value = aws_security_group.database.id }
output "target_group_arn" { value = aws_lb_target_group.application.arn }
output "alb_dns_name" { value = aws_lb.this.dns_name }
