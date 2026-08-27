# Task 12 report — Reproducible clean web runtime image

## Status and identities

Status: implementation complete; signed commit created after evidence verification (exact SHA in
handoff below).

- Branch: `rewrite/cashmemo-v1`
- Base and initial feature HEAD: `d3f328155c260907799720aa762efad9b2674f17`
- `git rev-parse HEAD`: `d3f328155c260907799720aa762efad9b2674f17`
- `git rev-parse d3f328155c260907799720aa762efad9b2674f17`: same SHA
- `git merge-base HEAD d3f328155c260907799720aa762efad9b2674f17`: same SHA

Initial `git status --short --branch` showed only user-owned untracked `.serena/`; it was ignored,
reported, and never read or changed. No production, deploy, Dokploy, generated, or existing test
file changed.

Pinned toolchain evidence (using repository Node path):

```text
node --version: v24.14.0
pnpm --version: 11.13.1
pnpm toolchain:check
Toolchain verified: node=24.14.0, pnpm=11.13.1
```

## RED runtime and scan evidence

Before repair, `docker build --pull -f infra/v1/web.Dockerfile -t cashmemo-web:repair-red .`
produced image ID `sha256:81ed2c5f55ba722c5d4e8c7534bd45825128e800b110386a01c7e6784133cb23`.
Verified paths in that image:

```text
node /usr/local/bin/node -> /usr/local/bin/node
npm /usr/local/bin/npm -> /usr/local/lib/node_modules/npm/bin/npm-cli.js
npx /usr/local/bin/npx -> /usr/local/lib/node_modules/npm/bin/npx-cli.js
corepack /usr/local/bin/corepack -> /usr/local/lib/node_modules/corepack/dist/corepack.js
pnpm absent; yarn /usr/local/bin/yarn -> /opt/yarn-v1.22.22/bin/yarn
/usr/local/lib/node_modules/npm/package.json present
/usr/local/lib/node_modules/corepack/package.json present
uid=1000(node) gid=1000(node) groups=1000(node)
```

The required runtime contract failed current image as required:

```text
$ bash infra/v1/test-web-image.sh cashmemo-web:repair-red
/usr/local/bin/node
/usr/local/bin/npm
/usr/local/bin/npx
/usr/local/bin/corepack
Package-manager command or manifest still present
RED_RUNTIME_EXIT=1
```

Exact scan policy: `CRITICAL,HIGH`, `--ignore-unfixed`, `--exit-code 1`, `--pkg-types os,library`.
The exact `trivy image` command was attempted, but local Docker 29.5.2 image analysis fails before
enumeration with `file blobs/... not found in tar`. Disposable exported-rootfs scan with identical
policy preserved RED vulnerability evidence:

```text
Total: 6 (HIGH: 4, CRITICAL: 2)
tar (package.json) 7.5.7 -> fixed 7.5.21, CVE-2026-73566 (HIGH)
libcap2 1:2.66-4+deb12u2+b2 -> fixed 1:2.66-4+deb12u3 (HIGH)
libgnutls30 3.7.9-2+deb12u6 -> fixed 3.7.9-2+deb12u7 (five HIGH/CRITICAL CVEs)
TRIVY_RED_ROOTFS_EXIT=1
```

## Base resolution and minimum Docker change

Resolution commands:

```text
docker image inspect --format '{{index .RepoDigests 0}}' node:24.14.0-bookworm-slim
node@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
docker manifest inspect node:24.14.0-bookworm-slim
official Docker Hub multi-platform tag; linux/arm64 manifest sha256:b3e8b37cd3102ef30c77d039f15baffe72c18fa23058c6e18b75a2e2faaad2e3
```

Both Dockerfile stages now use immutable official digest
`node@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8`.

Pinned-base build was run before package removal. Its paths matched RED. Its Trivy findings led to
only these exact package upgrades, with no blanket upgrade or suppression:

The pinned-base exported-rootfs scan under the same policy returned `TRIVY_PINNED_ROOTFS_EXIT=1`
and `Total: 6 (HIGH: 4, CRITICAL: 2)`, including npm `tar` 7.5.7 and the two Debian package
families below. The direct `trivy image` form was attempted too, but local Docker layer retrieval
failed before enumeration as described above.

```text
libcap2=1:2.66-4+deb12u3+b1
libgnutls30=3.7.9-2+deb12u7
```

Final image removes only verified `/usr/local/lib/node_modules/npm`,
`/usr/local/lib/node_modules/corepack`, `/usr/local/bin/npm`, `/usr/local/bin/npx`, and
`/usr/local/bin/corepack`. It does not recursively delete Node directories. Official Yarn v1
resolves outside Corepack (`/opt/yarn-v1.22.22/bin/yarn`) and remains under the brief's constrained
shim-removal rule.

## GREEN runtime and scan evidence

```text
docker build --pull -f infra/v1/web.Dockerfile -t cashmemo-web:repair-green .
Successfully built fc60541c21f7
bash infra/v1/test-web-image.sh cashmemo-web:repair-green
/usr/local/bin/node
v24.14.0
HTTP GET /: PASS (200 after redirects)
IMAGE_DIGEST=cashmemo-web@sha256:fc60541c21f7f14f0caeec6f11be90f121aa6303f7c8af0d85dd161bcf35fc8b
IMAGE_ID=sha256:fc60541c21f7f14f0caeec6f11be90f121aa6303f7c8af0d85dd161bcf35fc8b
```

Independent checks:

```text
node=/usr/local/bin/node -> /usr/local/bin/node
npm=absent; npx=absent; corepack=absent; pnpm=absent
libcap2=1:2.66-4+deb12u3+b1
libgnutls30=3.7.9-2+deb12u7
uid=1000(node) gid=1000(node) groups=1000(node)
required npm/corepack manifests absent
```

Contract explicitly starts `node apps/web/server.js`, follows root redirect, and receives HTTP 200.
Standalone output remains under `/app`; Node remains executable. Exported-rootfs Trivy with the
identical policy completed cleanly: Debian 12.13 vulnerabilities `0`, every detected Node target
`0`, `TRIVY_GREEN_ROOTFS_EXIT=0`. Direct image scan was also attempted and hit the local Docker
layer-reader error above; hosted CI is authoritative for direct image scanning.

## Hosted workflow evidence

`.github/workflows/v1-ci.yml` `docker-images` now runs before scan, only for web:

```text
if: matrix.image == 'web'
run: bash infra/v1/test-web-image.sh "cashmemo-v1-web:${{ github.sha }}"
```

Existing Trivy action retains `severity: CRITICAL,HIGH`, `ignore-unfixed: true`, `exit-code: 1`,
with explicit `vuln-type: os,library`. No ignore file, severity reduction, or undocumented
suppression added.

## Changed-test contradiction evidence

`git diff --name-only -- tests` returned empty. No existing test expectation changed or weakened.
`bash -n infra/v1/test-web-image.sh` and `git diff --check` pass. New executable contract is the
only test artifact.

## Self-review and concerns

- Runtime uses pinned official Node, Next standalone/static/public output, and `USER node`.
- Removal is exact and limited to verified npm/Corepack trees and shims.
- Narrow OS repairs are version-locked to findings; no package-manager upgrade was added.
- Yarn v1 remains outside verified Corepack tree per brief; review only if clean-runtime scope later
  explicitly expands beyond required npm/npx/Corepack assertions.
- Local direct image Trivy is blocked by Docker 29.5.2/Trivy layer retrieval; rootfs scan is clean,
  and hosted workflow retains authoritative direct image scan.

Commit command required by task:

```text
git add infra/v1 .github/workflows/v1-ci.yml docs/verification/v1-pr3-repair-evidence.md .superpowers/sdd/2026-08-25-cashmemo-v1-pr3-repair/task-12-report.md
git commit -S -m "fix: harden the web runtime image"
```
