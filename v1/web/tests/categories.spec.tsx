import { describe, expect, it } from "vitest";
import { categorySchema } from "../lib/validation/category";

describe("category UX validation", () => {
  it("accepts both seeded and custom category kinds with exact trimmed limit", () => {
    expect(categorySchema.safeParse({ name: ` ${"收入".repeat(40)} `, kind: "income" }).success).toBe(true);
    expect(categorySchema.safeParse({ name: "Food", kind: "expense" }).success).toBe(true);
  });

  it("rejects names over 80 Unicode characters", () => {
    expect(categorySchema.safeParse({ name: "x".repeat(81), kind: "expense" }).success).toBe(false);
  });
});
