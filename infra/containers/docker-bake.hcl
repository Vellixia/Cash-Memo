variable "RELEASE_SHA" {
  default = "0000000000000000000000000000000000000000"
  validation {
    condition     = can(regex("^[0-9a-f]{40}$", RELEASE_SHA))
    error_message = "RELEASE_SHA must be an exact commit SHA."
  }
}

variable "RUNTIME_IMAGE_NAME" { default = "ghcr.io/vellixia/cashmemo-runtime" }
variable "VERIFIER_IMAGE_NAME" { default = "ghcr.io/vellixia/cashmemo-verifier" }
variable "PGBACKREST_IMAGE_NAME" { default = "ghcr.io/vellixia/cashmemo-pgbackrest" }

target "runtime" {
  context    = "../.."
  dockerfile = "infra/containers/Dockerfile"
  target     = "production"
  tags       = ["${RUNTIME_IMAGE_NAME}:git-${RELEASE_SHA}"]
  args = {
    RELEASE_SHA = RELEASE_SHA
    BUILD_VERSION = "git-${RELEASE_SHA}"
  }
  labels = {
    "org.opencontainers.image.revision" = RELEASE_SHA
    "org.opencontainers.image.source"   = "https://github.com/Vellixia/cashmemo"
  }
  attest = ["type=sbom,generator=docker/scout-sbom-indexer:1", "type=provenance,mode=max"]
  output = ["type=image,push=true,name-canonical=true,push-by-digest=true"]
}

target "verifier" {
  context    = "../.."
  dockerfile = "infra/containers/Verifier.Dockerfile"
  tags       = ["${VERIFIER_IMAGE_NAME}:git-${RELEASE_SHA}"]
  args = {
    RELEASE_SHA = RELEASE_SHA
    BUILD_VERSION = "git-${RELEASE_SHA}"
  }
  labels = {
    "org.opencontainers.image.revision" = RELEASE_SHA
    "org.opencontainers.image.source"   = "https://github.com/Vellixia/cashmemo"
  }
  attest = ["type=sbom,generator=docker/scout-sbom-indexer:1", "type=provenance,mode=max"]
  output = ["type=image,push=true,name-canonical=true,push-by-digest=true"]
}

target "pgbackrest" {
  context    = "../.."
  dockerfile = "infra/pgbackrest/Dockerfile"
  tags       = ["${PGBACKREST_IMAGE_NAME}:git-${RELEASE_SHA}"]
  args = {
    RELEASE_SHA = RELEASE_SHA
    BUILD_VERSION = "git-${RELEASE_SHA}"
  }
  labels = {
    "org.opencontainers.image.revision" = RELEASE_SHA
    "org.opencontainers.image.source"   = "https://github.com/Vellixia/cashmemo"
  }
  attest = ["type=sbom,generator=docker/scout-sbom-indexer:1", "type=provenance,mode=max"]
  output = ["type=image,push=true,name-canonical=true,push-by-digest=true"]
}

group "artifacts" {
  targets = ["runtime", "pgbackrest", "verifier"]
}
