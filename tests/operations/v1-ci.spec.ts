import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const workflow = await readFile(".github/workflows/v1-ci.yml", "utf8");

describe("Cashmemo V1 CI contract", () => {
  it("locks Cargo resolution before regenerating the OpenAPI contract", () => {
    expect(packageJson.scripts["v1:openapi"]).toBe(
      "cargo run --locked -p cashmemo-api --bin export_openapi -- openapi/cashmemo-v1.json",
    );
    expect(packageJson.scripts["v1:api:check"]).toContain("pnpm v1:api:generate");
    expect(workflow).toContain("pnpm v1:api:check");
  });
});
