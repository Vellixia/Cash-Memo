import { readFileSync } from "node:fs";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

const contractPath = "specs/001-cashmemo-mvp/contracts/openapi.yaml";
const document = YAML.parse(readFileSync(contractPath, "utf8")) as unknown;

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Identity contract object missing at ${label}`);
  }
  return value as JsonObject;
}

function operation(path: string, method: "get" | "post"): JsonObject {
  const paths = object(object(document, "root")["paths"], "paths");
  return object(object(paths[path], path)[method], `${method.toUpperCase()} ${path}`);
}

function component(
  group: "parameters" | "responses" | "schemas" | "securitySchemes",
  name: string,
) {
  const components = object(object(document, "root")["components"], "components");
  return object(object(components[group], `components.${group}`)[name], `${group}.${name}`);
}

function reference(value: unknown, label: string): string {
  const candidate = object(value, label)["$ref"];
  if (typeof candidate !== "string")
    throw new Error(`Identity contract reference missing at ${label}`);
  return candidate;
}

function responses(path: string, method: "get" | "post"): JsonObject {
  return object(operation(path, method)["responses"], `${method.toUpperCase()} ${path}.responses`);
}

function requestSchema(path: string): JsonObject {
  const requestBody = object(operation(path, "post")["requestBody"], `${path}.requestBody`);
  const content = object(requestBody["content"], `${path}.requestBody.content`);
  const media = object(content["application/json"], `${path}.requestBody.application/json`);
  return object(media["schema"], `${path}.requestBody.schema`);
}

describe("identity HTTP contract", () => {
  it("keeps exactly the intended entry actions public and every session action cookie-authenticated", () => {
    const publicActions = [
      "/auth/sign-up",
      "/auth/verification/resend",
      "/auth/verify-email",
      "/auth/login",
      "/auth/password-reset/request",
      "/auth/password-reset/complete",
    ];
    for (const path of publicActions) expect(operation(path, "post")["security"], path).toEqual([]);

    for (const [path, method] of [
      ["/auth/session", "get"],
      ["/auth/logout", "post"],
      ["/auth/reauthenticate", "post"],
      ["/auth/sessions/revoke-others", "post"],
    ] as const) {
      expect(operation(path, method)["security"], path).toBeUndefined();
    }

    expect(component("securitySchemes", "sessionCookie")).toEqual({
      in: "cookie",
      name: "__Host-cashmemo_session",
      type: "apiKey",
    });
  });

  it("accepts email/password signup without adding profile, name, image, or provider inputs", () => {
    expect(reference(requestSchema("/auth/sign-up"), "signup schema")).toBe(
      "#/components/schemas/SignUpRequest",
    );
    const schema = component("schemas", "SignUpRequest");
    const properties = object(schema["properties"], "SignUpRequest.properties");

    expect(schema["additionalProperties"]).toBe(false);
    expect(schema["required"]).toEqual(["email", "password", "idempotencyKey"]);
    expect(Object.keys(properties).sort()).toEqual(["email", "idempotencyKey", "password"]);
    expect(properties).not.toHaveProperty("name");
    expect(properties).not.toHaveProperty("image");
    expect(properties).not.toHaveProperty("provider");
  });

  it("uses one enumeration-safe response for signup, verification resend, and reset request", () => {
    for (const path of [
      "/auth/sign-up",
      "/auth/verification/resend",
      "/auth/password-reset/request",
    ]) {
      const declared = responses(path, "post");
      const accepted = object(declared["202"], `${path}.202`);
      const content = object(accepted["content"], `${path}.202.content`);
      const media = object(content["application/json"], `${path}.202.application/json`);
      expect(reference(media["schema"], `${path}.202.schema`)).toBe(
        "#/components/schemas/GenericAuthAccepted",
      );
      expect(declared).not.toHaveProperty("404");
      expect(declared).not.toHaveProperty("409");
    }

    expect(component("schemas", "GenericAuthAccepted")).toMatchObject({
      additionalProperties: false,
      required: ["status", "messageCode"],
      properties: {
        messageCode: { const: "CHECK_EMAIL_IF_ELIGIBLE" },
        status: { const: "accepted" },
      },
    });
  });

  it("uses stable invalid-action and credential errors without exposing auth internals", () => {
    for (const path of ["/auth/verify-email", "/auth/password-reset/complete"]) {
      expect(reference(responses(path, "post")["400"], `${path}.400`)).toBe(
        "#/components/responses/AuthActionInvalid",
      );
    }
    expect(reference(responses("/auth/login", "post")["401"], "login.401")).toBe(
      "#/components/responses/AuthFailed",
    );
    expect(reference(responses("/auth/login", "post")["403"], "login.403")).toBe(
      "#/components/responses/EmailNotVerified",
    );

    const error = component("schemas", "Error");
    const properties = object(error["properties"], "Error.properties");
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(["code", "messageCode", "correlationId", "retryable", "fieldErrors"]),
    );
    for (const prohibited of [
      "email",
      "password",
      "token",
      "sessionToken",
      "providerPayload",
      "stack",
    ]) {
      expect(properties, prohibited).not.toHaveProperty(prohibited);
    }
    expect(error["description"]).toContain("Never contains request content");
  });

  it("defines opaque session restoration, logout, revocation, and session-bound grant transport", () => {
    const login = responses("/auth/login", "post");
    const loginSuccess = object(login["200"], "login.200");
    expect(object(loginSuccess["headers"], "login.200.headers")).toHaveProperty("Set-Cookie");
    expect(responses("/auth/session", "get")).toHaveProperty("200");
    expect(responses("/auth/logout", "post")).toHaveProperty("204");
    expect(responses("/auth/sessions/revoke-others", "post")).toHaveProperty("204");

    const session = component("schemas", "SessionView");
    expect(session["required"]).toEqual([
      "sessionId",
      "userId",
      "createdAt",
      "idleExpiresAt",
      "absoluteExpiresAt",
    ]);
    const sessionProperties = object(session["properties"], "SessionView.properties");
    expect(sessionProperties).not.toHaveProperty("token");
    expect(sessionProperties).not.toHaveProperty("email");

    expect(component("parameters", "ReauthGrant")).toMatchObject({
      in: "header",
      name: "X-Reauth-Grant",
      required: true,
    });
    const scopes = component("schemas", "ReauthScope");
    expect(scopes["enum"]).toEqual([
      "export",
      "purge",
      "account_delete",
      "sessions",
      "preferences",
    ]);
    expect(JSON.stringify(operation("/auth/sessions/revoke-others", "post"))).toContain(
      "#/components/parameters/ReauthGrant",
    );
  });
});
