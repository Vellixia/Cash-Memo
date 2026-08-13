import { readdir, readFile } from "node:fs/promises";
import { cruise } from "dependency-cruiser";
import { describe, expect, it } from "vitest";

import boundaryConfig, { moduleNames } from "../../dependency-cruiser.config.mjs";

describe("modular monolith architecture", () => {
  it("keeps the current dependency graph inside inward-facing boundaries", async () => {
    const result = await cruise(["apps", "packages"], {
      ...boundaryConfig.options,
      outputType: "err-long",
      ruleSet: { forbidden: boundaryConfig.forbidden },
    });
    const diagnostic =
      typeof result.output === "string" ? result.output : JSON.stringify(result.output);

    expect(result.exitCode, diagnostic).toBe(0);
  });

  it("declares a cross-module port rule for every planned module", () => {
    const ruleNames = new Set(boundaryConfig.forbidden.map((rule) => rule.name));

    for (const moduleName of moduleNames) {
      expect(ruleNames.has(`module-${moduleName}-uses-other-modules-through-ports`)).toBe(true);
    }
  });

  it("keeps web/server in one runtime image and verifier outside production", async () => {
    const applicationDirectories = (await readdir("apps", { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const containerFiles = (await readdir("infra/containers")).filter((name) =>
      name.toLowerCase().includes("dockerfile"),
    );
    const dockerfile = await readFile("infra/containers/Dockerfile", "utf8");
    const verifierDockerfile = await readFile("infra/containers/Verifier.Dockerfile", "utf8");

    expect(applicationDirectories).toEqual(["server", "web"]);
    expect(containerFiles.sort()).toEqual(["Dockerfile", "Verifier.Dockerfile"]);
    expect(dockerfile.match(/^FROM .* AS production$/gmu)).toHaveLength(1);
    expect(verifierDockerfile).toContain('dev.cashmemo.verifier.production="forbidden"');
    expect(verifierDockerfile).not.toMatch(/^FROM .* AS production$/gmu);
  });
});
