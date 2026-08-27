import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

const webRoot = resolve(import.meta.dirname, "..");
const globalsCss = readFileSync(resolve(webRoot, "app/globals.css"), "utf8");
const layoutSource = readFileSync(resolve(webRoot, "app/layout.tsx"), "utf8");

function getHexToken(tokenName: string) {
  const match = new RegExp(`${tokenName}:\\s*(#[0-9a-fA-F]{6})`).exec(globalsCss);
  if (!match) throw new Error(`token ${tokenName} missing`);
  return match[1];
}

function srgbChannelToLinear(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string) {
  const value = hex.replace("#", "");
  const red = srgbChannelToLinear(Number.parseInt(value.slice(0, 2), 16));
  const green = srgbChannelToLinear(Number.parseInt(value.slice(2, 4), 16));
  const blue = srgbChannelToLinear(Number.parseInt(value.slice(4, 6), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(background: string, foreground: string) {
  const [lighter, darker] = [relativeLuminance(background), relativeLuminance(foreground)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

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
    const destructiveSurface = getHexToken("--destructive-surface");
    const destructiveSurfaceForeground = getHexToken("--destructive-surface-foreground");

    expect(globalsCss).toMatch(
      /\.error-panel\s*\{[\s\S]*var\(--destructive-border\)[\s\S]*var\(--destructive-surface\)[\s\S]*var\(--destructive-surface-foreground\)/,
    );
    expect(globalsCss).toContain(".confirm-box,\n.notice {");
    expect(contrastRatio(destructiveSurface, destructiveSurfaceForeground)).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
