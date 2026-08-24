#!/usr/bin/env bats

setup() {
  repo="$BATS_TEST_DIRNAME/../.."
  manifest="$repo/docs/verification/legacy-removal-manifest.md"
  reviewed_base=b2d462eacc0307080aea68ce06dd2abc03058f8c
  reviewed_hash=bfcec955cfa58e323312fa8e7250806f1a2354ae28dcbda90d5d9fccdad85d31
}

inventory_records() {
  awk '
    $0 == "<!-- INVENTORY-BEGIN -->" { inside=1; next }
    $0 == "<!-- INVENTORY-END -->" { inside=0; next }
    inside && NF { print }
  ' "$manifest"
}

@test "canonical layout is bound to reviewed manifest identity" {
  [ "$(shasum -a 256 "$manifest" | cut -d' ' -f1)" = "$reviewed_hash" ]
  git -C "$repo" cat-file -e "$reviewed_base^{commit}"
}

@test "reviewed legacy removals are absent while every preservation artifact remains" {
  failures="$BATS_TEST_TMPDIR/removal-failures"
  : >"$failures"

  while IFS=$'\t' read -r state path _reason _source; do
    case "$state" in
      REMOVE)
        if [ -e "$repo/$path" ] || [ -L "$repo/$path" ]; then
          case "$path" in
            apps/web/package.json)
              legacy_blob=$(git -C "$repo" rev-parse "$reviewed_base:$path")
              current_blob=$(git -C "$repo" hash-object "$repo/$path")
              package_name=$(node -p "require('$repo/$path').name")
              build_script=$(node -p "require('$repo/$path').scripts.build")
              if [ "$current_blob" = "$legacy_blob" ] || \
                [ "$package_name" != "@cashmemo/v1-web" ] || [ "$build_script" != "next build" ]; then
                printf 'legacy/canonical collision invalid: %s\n' "$path" >>"$failures"
              fi
              ;;
            apps/web/tsconfig.json)
              legacy_blob=$(git -C "$repo" rev-parse "$reviewed_base:$path")
              current_blob=$(git -C "$repo" hash-object "$repo/$path")
              if [ "$current_blob" = "$legacy_blob" ] || \
                ! grep -Fq '"name": "next"' "$repo/$path" || grep -Fq 'vite/client' "$repo/$path"; then
                printf 'legacy/canonical collision invalid: %s\n' "$path" >>"$failures"
              fi
              ;;
            *) printf 'reviewed removal still exists: %s\n' "$path" >>"$failures" ;;
          esac
        fi
        ;;
      PRESERVE)
        if [ ! -e "$repo/$path" ] && [ ! -L "$repo/$path" ]; then
          printf 'preservation artifact missing: %s\n' "$path" >>"$failures"
        fi
        ;;
    esac
  done < <(inventory_records)

  run test ! -s "$failures"
  if [ "$status" -ne 0 ]; then
    cat "$failures" >&3
  fi
  [ "$status" -eq 0 ]
}

@test "canonical application roots replace temporary and executable legacy roots" {
  [ -f "$repo/apps/api/Cargo.toml" ]
  [ -f "$repo/apps/api/src/main.rs" ]
  [ -f "$repo/apps/web/package.json" ]
  [ -f "$repo/apps/web/app/layout.tsx" ]
  [ ! -e "$repo/v1/api" ]
  [ ! -e "$repo/v1/web" ]
  [ ! -e "$repo/apps/server/package.json" ]
  [ ! -e "$repo/apps/server/src/bootstrap/main.ts" ]
  [ ! -e "$repo/apps/web/vite.config.ts" ]
}

@test "root commands expose one canonical OpenAPI client and verification workflow" {
  run node --input-type=module -e '
    import fs from "node:fs";
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expected = {
      openapi: "cargo run --locked -p cashmemo-api --bin export_openapi -- openapi/cashmemo-v1.json",
      "api:generate": "pnpm openapi && pnpm --dir apps/web orval",
      "api:check": "pnpm api:generate && git diff --exit-code -- openapi/cashmemo-v1.json apps/web/generated/api",
    };
    for (const [name, command] of Object.entries(expected)) {
      if (pkg.scripts?.[name] !== command) throw new Error(`${name}: ${pkg.scripts?.[name]}`);
    }
    if (!pkg.scripts?.verify?.includes("pnpm api:check")) throw new Error("verify omits api:check");
    if (Object.keys(pkg.scripts ?? {}).some((name) => name.startsWith("v1:"))) {
      throw new Error("temporary v1:* script remains");
    }
  ' "$repo/package.json"

  [ "$status" -eq 0 ]
}

@test "Rust and pnpm workspaces contain only canonical application paths" {
  run grep -F 'members = ["apps/api"]' "$repo/Cargo.toml"
  [ "$status" -eq 0 ]

  run grep -Fx '  - apps/web' "$repo/pnpm-workspace.yaml"
  [ "$status" -eq 0 ]

  run grep -E 'v1/(api|web)' \
    "$repo/Cargo.toml" "$repo/pnpm-workspace.yaml"
  [ "$status" -ne 0 ]
}

@test "current CI Docker and operations surfaces use canonical paths" {
  current_files=(
    "$repo/.github/workflows/v1-ci.yml"
    "$repo/infra/v1/api.Dockerfile"
    "$repo/infra/v1/web.Dockerfile"
    "$repo/infra/v1/dokploy-compose.yml"
    "$repo/infra/v1/test-compose.yml"
    "$repo/infra/v1/test-dokploy-compose.sh"
    "$repo/README.md"
    "$repo/docs/operations/v1-deployment.md"
    "$repo/docs/operations/preservation-gate.md"
    "$repo/docs/operations/backup-recovery.md"
    "$repo/docs/operations/rollback.md"
    "$repo/docs/operations/ci-gates.md"
  )

  run grep -E '(^|[[:space:]])v1/(api|web)|pnpm v1:|pnpm --dir v1/' "${current_files[@]}"
  [ "$status" -ne 0 ]

  run grep -F 'COPY apps/api ./apps/api' "$repo/infra/v1/api.Dockerfile"
  [ "$status" -eq 0 ]
  run grep -F 'COPY apps/web ./apps/web' "$repo/infra/v1/web.Dockerfile"
  [ "$status" -eq 0 ]
  run grep -F 'pnpm --dir apps/web' "$repo/.github/workflows/v1-ci.yml"
  [ "$status" -eq 0 ]
}

@test "canonical Orval output remains generated from Rust OpenAPI" {
  [ -f "$repo/openapi/cashmemo-v1.json" ]
  [ -f "$repo/apps/web/orval.config.ts" ]
  [ -f "$repo/apps/web/generated/api/index.ts" ]

  run grep -F 'input: "../../openapi/cashmemo-v1.json"' "$repo/apps/web/orval.config.ts"
  [ "$status" -eq 0 ]
  run grep -F 'target: "./generated/api/index.ts"' "$repo/apps/web/orval.config.ts"
  [ "$status" -eq 0 ]
}

@test "retained contract verifier delegates to canonical API check" {
  fake_bin="$BATS_TEST_TMPDIR/fake-bin"
  mkdir -p "$fake_bin"
  printf '%s\n' '#!/bin/sh' 'printf "%s\\n" "$*"' >"$fake_bin/pnpm"
  chmod +x "$fake_bin/pnpm"

  run env PATH="$fake_bin:$PATH" node "$repo/scripts/contracts/verify-openapi.mjs"

  [ "$status" -eq 0 ]
  [ "$output" = "api:check" ]
}

@test "legacy and excluded non-goal dependencies are absent from current packages" {
  run node --input-type=module -e '
    import fs from "node:fs";
    const root = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const web = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const all = { ...(root.dependencies ?? {}), ...(root.devDependencies ?? {}), ...(web.dependencies ?? {}), ...(web.devDependencies ?? {}) };
    const forbidden = ["better-auth", "fastify", "@hey-api/openapi-ts", "minio", "pg", "redux", "zustand", "graphql"];
    const found = forbidden.filter((name) => Object.hasOwn(all, name));
    if (found.length) throw new Error(`forbidden dependencies: ${found.join(", ")}`);
  ' "$repo/package.json" "$repo/apps/web/package.json"

  [ "$status" -eq 0 ]
}

@test "OpenAPI exposes no explicitly excluded legacy or V1 non-goal routes" {
  run node --input-type=module -e '
    import fs from "node:fs";
    const document = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const forbidden = /(voice|audio|receipt|ocr|bank|investment|crypto|export)/i;
    const found = Object.keys(document.paths ?? {}).filter((path) => forbidden.test(path));
    if (found.length) throw new Error(`excluded routes: ${found.join(", ")}`);
  ' "$repo/openapi/cashmemo-v1.json"

  [ "$status" -eq 0 ]
}
