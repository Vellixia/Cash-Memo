import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

const webRoot = resolve(import.meta.dirname, "..");
const globalsCss = readFileSync(resolve(webRoot, "app/globals.css"), "utf8");
const layoutSource = readFileSync(resolve(webRoot, "app/layout.tsx"), "utf8");

describe("design system foundation", () => {
  it("tracks shadcn generator config in components.json", () => {
    const componentsJson = JSON.parse(
      readFileSync(resolve(webRoot, "components.json"), "utf8"),
    ) as {
      aliases?: { ui?: string };
      tailwind?: { css?: string; cssVariables?: boolean };
    };

    expect(componentsJson.aliases?.ui).toBe("@/components/ui");
    expect(componentsJson.tailwind?.css).toBe("app/globals.css");
    expect(componentsJson.tailwind?.cssVariables).toBe(true);
  });

  it("uses current foundation primitives instead of legacy class wrappers", () => {
    render(
      <>
        <Button variant="primary">Save</Button>
        <Button variant="quiet">Cancel</Button>
        <Input aria-label="Amount" />
      </>,
    );

    const primary = screen.getByRole("button", { name: "Save" });
    const quiet = screen.getByRole("button", { name: "Cancel" });
    const input = screen.getByLabelText("Amount");

    expect(primary.className).not.toContain("button-primary");
    expect(quiet.className).not.toContain("button-quiet");
    expect(primary.className).toContain("min-h-11");
    expect(input.className).not.toBe("input");
    expect(input.className).toContain("min-h-11");
  });

  it("defines semantic CSS tokens and removes legacy primitive selectors", () => {
    expect(globalsCss).toContain("--primary:");
    expect(globalsCss).toContain("--accent:");
    expect(globalsCss).toContain("--success:");
    expect(globalsCss).toContain("--warning:");
    expect(globalsCss).toContain("--destructive:");
    expect(globalsCss).not.toContain(".button-primary");
    expect(globalsCss).not.toContain(".button-secondary");
    expect(globalsCss).not.toContain(".button-danger");
    expect(globalsCss).not.toContain(".button-quiet");
    expect(globalsCss).not.toContain(".input {");
  });

  it("mounts exactly one Sonner host in root layout", () => {
    const hostCount = layoutSource.match(/<Toaster\b/g)?.length ?? 0;
    expect(hostCount).toBe(1);
  });

  it("targets shadcn button slot in narrow-screen action layouts", () => {
    expect(globalsCss).toContain('.page-heading > [data-slot="button"]');
    expect(globalsCss).toContain('.card-actions > [data-slot="button"]');
  });

  it("renders error panels on destructive semantic surfaces", () => {
    expect(globalsCss).toMatch(
      /\.error-panel\s*\{[\s\S]*var\(--destructive-border\)[\s\S]*var\(--destructive-surface\)/,
    );
    expect(globalsCss).toContain(".confirm-box,\n.notice {");
  });
});
