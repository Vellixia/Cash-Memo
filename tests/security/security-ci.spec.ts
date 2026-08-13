import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflow = await readFile(
  new URL("../../.github/workflows/security.yml", import.meta.url),
  "utf8",
);

describe("blocking security CI", () => {
  it("contains every required blocking scan and artifact", () => {
    for (const required of [
      "pnpm audit",
      "trivy",
      "checkov",
      "syft",
      "license",
      "gitleaks",
      "sbom",
    ]) {
      expect(workflow.toLowerCase()).toContain(required);
    }
  });

  it("has no advisory failure bypass", () => {
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toContain("|| true");
  });

  it("does not deploy infrastructure", () => {
    expect(workflow).not.toMatch(/tofu\s+apply|terraform\s+apply|aws\s+cloudformation\s+deploy/u);
  });

  it("ties SBOM generation to the checked source/build revision", () => {
    expect(workflow).toContain("github.sha");
    expect(workflow).toContain("upload-artifact: true");
    expect(workflow).not.toMatch(/uses:\s+[^\n]+@v\d/iu);
  });
});
