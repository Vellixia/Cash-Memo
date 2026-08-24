import { describe, expect, it } from "vitest";

import { api } from "../lib/api/axios";

describe("generated API transport", () => {
  it("sends an already-versioned generated path without duplicating its prefix", () => {
    expect(api.getUri({ url: "/api/v1/auth/register" })).toBe("/api/v1/auth/register");
  });
});
