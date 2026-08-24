import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePublicOrigin } from "../e2e/support/environment.mjs";

interface ComposeConfig {
  services: {
    postgres: {
      image: string;
      tmpfs?: string[];
    };
  };
}

describe("real-stack E2E harness", () => {
  it("canonicalizes a trailing-slash public origin for every E2E consumer", () => {
    expect(normalizePublicOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it("mounts PostgreSQL 18 temporary storage at its version-safe parent directory", () => {
    const composeFile = path.resolve(process.cwd(), "../../infra/v1/test-compose.yml");
    const hasComposePlugin =
      spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;
    const config = JSON.parse(
      execFileSync(
        hasComposePlugin ? "docker" : "docker-compose",
        [
          ...(hasComposePlugin ? ["compose"] : []),
          "-f",
          composeFile,
          "config",
          "--format",
          "json",
        ],
        { encoding: "utf8" },
      ),
    ) as ComposeConfig;

    expect(config.services.postgres.image).toMatch(/^postgres:18\./);
    expect(config.services.postgres.tmpfs).toContain("/var/lib/postgresql");
    expect(config.services.postgres.tmpfs).not.toContain("/var/lib/postgresql/data");
  });
});
