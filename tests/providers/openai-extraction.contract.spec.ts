import { describe, expect, it } from "vitest";

const enabled =
  process.env["CASHMEMO_REAL_PROVIDER_CONTRACT"] === "true" &&
  Boolean(process.env["OPENAI_API_KEY"]);
const model = "gpt-5.4-mini-2026-03-17";

describe.skipIf(!enabled)("protected real OpenAI extraction contract", () => {
  it("uses pinned model, strict JSON schema, synthetic text, and no SDK logging", async () => {
    expect(process.env["OPENAI_LOG"] ?? "off").toBe("off");
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: "Synthetic expense of 12.50 USD. Return only fields.",
        model,
        store: false,
        text: {
          format: {
            name: "cashmemo_draft",
            schema: {
              additionalProperties: false,
              properties: {
                amount: { type: "string" },
                currency: { type: "string" },
                direction: { enum: ["expense", "income"] },
              },
              required: ["amount", "currency", "direction"],
              type: "object",
            },
            strict: true,
            type: "json_schema",
          },
        },
      }),
      headers: {
        Authorization: `Bearer ${process.env["OPENAI_API_KEY"] ?? ""}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    expect(response.ok).toBe(true);
    expect(model).toBe(process.env["EXTRACTION_MODEL_SNAPSHOT"] ?? model);
  }, 60_000);
});

if (!enabled) {
  describe("protected real OpenAI extraction contract", () => {
    it.skip("BLOCKED: requires CASHMEMO_REAL_PROVIDER_CONTRACT=true and OPENAI_API_KEY", () =>
      undefined);
  });
}
