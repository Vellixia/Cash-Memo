variable "RELEASE_SHA" {
  default = "0000000000000000000000000000000000000000"
  validation {
    condition     = can(regex("^[0-9a-f]{40}$", RELEASE_SHA))
    error_message = "RELEASE_SHA must be an exact commit SHA."
  }
}

variable "IMAGE_NAME" { default = "cashmemo" }

target "production" {
  context    = "../.."
  dockerfile = "infra/containers/Dockerfile"
  target     = "production"
  tags       = ["${IMAGE_NAME}:${RELEASE_SHA}"]
  labels = {
    "org.opencontainers.image.revision" = RELEASE_SHA
    "org.opencontainers.image.source"   = "https://github.com/Vellixia/cashmemo"
  }
  attest = ["type=sbom,generator=docker/scout-sbom-indexer:1", "type=provenance,mode=max"]
  output = ["type=image,push=true,name-canonical=true,push-by-digest=true"]
}
