import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import playwrightConfig from "../playwright.config";
import { E2E_AUTH_RATE_LIMIT, buildE2eApiEnvironment } from "../e2e/support/api-environment.mjs";
import { cashmemoApiCommand } from "../e2e/support/commands.mjs";
import { normalizePublicOrigin } from "../e2e/support/environment.mjs";
import { isolatedUser } from "../e2e/support/auth";

interface ComposeConfig {
  services: {
    postgres: {
      image: string;
      tmpfs?: string[];
    };
  };
}

describe("real-stack E2E harness", () => {
  it("gives only the child API bounded E2E auth limits", () => {
    const parentEnvironment = {
      CASHMEMO_V1_AUTH_LOGIN_LIMIT: "5",
      CASHMEMO_V1_AUTH_REGISTER_LIMIT: "5",
      CASHMEMO_V1_AUTH_RESET_REQUEST_LIMIT: "5",
      CASHMEMO_V1_AUTH_VERIFICATION_RESEND_LIMIT: "5",
      PARENT_MARKER: "unchanged",
    };

    const apiEnvironment = buildE2eApiEnvironment(parentEnvironment, {
      databaseUrl: "postgres://cashmemo:test@127.0.0.1:54329/cashmemo_e2e",
      publicOrigin: "http://localhost:3000",
      smtpPort: "1025",
    });

    expect(E2E_AUTH_RATE_LIMIT).toBe("100");
    expect(apiEnvironment).toMatchObject({
      CASHMEMO_V1_AUTH_LOGIN_LIMIT: E2E_AUTH_RATE_LIMIT,
      CASHMEMO_V1_AUTH_REGISTER_LIMIT: E2E_AUTH_RATE_LIMIT,
      CASHMEMO_V1_AUTH_RESET_REQUEST_LIMIT: E2E_AUTH_RATE_LIMIT,
      CASHMEMO_V1_AUTH_VERIFICATION_RESEND_LIMIT: E2E_AUTH_RATE_LIMIT,
      PARENT_MARKER: "unchanged",
    });
    expect(parentEnvironment).toEqual({
      CASHMEMO_V1_AUTH_LOGIN_LIMIT: "5",
      CASHMEMO_V1_AUTH_REGISTER_LIMIT: "5",
      CASHMEMO_V1_AUTH_RESET_REQUEST_LIMIT: "5",
      CASHMEMO_V1_AUTH_VERIFICATION_RESEND_LIMIT: "5",
      PARENT_MARKER: "unchanged",
    });
  });

  it("allows the parallel E2E API login to finish after Argon2 contention", () => {
    expect(playwrightConfig.expect?.timeout).toBe(30_000);
  });

  it("selects the cashmemo-api binary for migrate and serve commands", () => {
    expect(cashmemoApiCommand("migrate")).toEqual({
      executable: "cargo",
      args: ["run", "-p", "cashmemo-api", "--bin", "cashmemo-api", "--", "migrate"],
    });
    expect(cashmemoApiCommand("serve")).toEqual({
      executable: "cargo",
      args: ["run", "-p", "cashmemo-api", "--bin", "cashmemo-api", "--", "serve"],
    });
  });

  it("keeps isolated Mailpit recipients within the RFC local-part limit", () => {
    const user = isolatedUser("account-deletion");
    const [localPart] = user.email.split("@");

    expect(new TextEncoder().encode(localPart).length).toBeLessThanOrEqual(64);
  });

  it("canonicalizes a trailing-slash public origin for every E2E consumer", () => {
    expect(normalizePublicOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
  });

  it("rejects every non-loopback origin before the E2E harness can authenticate or capture", () => {
    expect(() => normalizePublicOrigin("https://cashmemo.example")).toThrow(
      /loopback.*before authentication or artifact capture/i,
    );
  });

  it("mounts PostgreSQL 18 temporary storage at its version-safe parent directory", () => {
    const composeFile = path.resolve(process.cwd(), "../../infra/v1/test-compose.yml");
    const hasComposePlugin =
      spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;
    const config = JSON.parse(
      execFileSync(
        hasComposePlugin ? "docker" : "docker-compose",
        [...(hasComposePlugin ? ["compose"] : []), "-f", composeFile, "config", "--format", "json"],
        { encoding: "utf8" },
      ),
    ) as ComposeConfig;

    expect(config.services.postgres.image).toMatch(/^postgres:18\./);
    expect(config.services.postgres.tmpfs).toContain("/var/lib/postgresql");
    expect(config.services.postgres.tmpfs).not.toContain("/var/lib/postgresql/data");
  });
});
