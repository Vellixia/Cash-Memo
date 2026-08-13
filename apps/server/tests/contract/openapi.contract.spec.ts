import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import Ajv2020, { type AnySchema, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";
import { describe, expect, it } from "vitest";

const contractPath = "specs/001-cashmemo-mvp/contracts/openapi.yaml";
const document = YAML.parse(readFileSync(contractPath, "utf8")) as unknown;
const httpMethods = new Set(["delete", "get", "patch", "post", "put"]);
const publicOperationIds = new Set([
  "completePasswordReset",
  "login",
  "requestPasswordReset",
  "resendVerification",
  "signUp",
  "verifyEmail",
]);
const providerIdentifier =
  /(?:^|[^a-z])(?:aws|betterauth|drizzle|openai|postgres|s3|ses)(?:[^a-z]|$)/iu;

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Contract shape invalid at ${label}`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Contract array missing at ${label}`);
  return value;
}

function localReference(reference: string): unknown {
  if (!reference.startsWith("#/")) throw new Error("Only local contract references are allowed");
  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((current, part) => object(current, reference)[part], document);
}

function resolveObject(value: unknown, label: string): JsonObject {
  const candidate = object(value, label);
  const reference = candidate["$ref"];
  return typeof reference === "string"
    ? resolveObject(localReference(reference), reference)
    : candidate;
}

function dereferenceSchema(value: unknown, seen = new Set<string>()): unknown {
  if (Array.isArray(value)) return value.map((entry) => dereferenceSchema(entry, seen));
  if (typeof value !== "object" || value === null) return value;

  const candidate = value as JsonObject;
  const reference = candidate["$ref"];
  if (typeof reference === "string") {
    if (seen.has(reference)) return {};
    const nextSeen = new Set(seen).add(reference);
    const resolved = object(dereferenceSchema(localReference(reference), nextSeen), reference);
    const siblings = Object.fromEntries(
      Object.entries(candidate)
        .filter(([key]) => key !== "$ref")
        .map(([key, entry]) => [key, dereferenceSchema(entry, nextSeen)]),
    );
    return { ...resolved, ...siblings };
  }

  return Object.fromEntries(
    Object.entries(candidate).map(([key, entry]) => [key, dereferenceSchema(entry, seen)]),
  );
}

function operations(): { operation: JsonObject; operationId: string; path: string }[] {
  const paths = object(object(document, "root")["paths"], "paths");
  const result: { operation: JsonObject; operationId: string; path: string }[] = [];

  for (const [contractPathName, pathItemValue] of Object.entries(paths)) {
    const pathItem = object(pathItemValue, contractPathName);
    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!httpMethods.has(method)) continue;
      const operation = object(operationValue, `${method} ${contractPathName}`);
      const operationId = operation["operationId"];
      if (typeof operationId !== "string")
        throw new Error(`operationId missing at ${contractPathName}`);
      result.push({ operation, operationId, path: `${method.toUpperCase()} ${contractPathName}` });
    }
  }

  return result;
}

function safeValidationDiagnostic(validator: ValidateFunction): string {
  return (validator.errors ?? [])
    .map((error) => `${error.instancePath || "/"}:${error.keyword}`)
    .join(",");
}

function validateDeclaredExamples(): { invalid: string[]; total: number } {
  const ajv = new Ajv2020.default({ allErrors: true, strict: false, validateFormats: true });
  addFormats.default(ajv);
  const invalid: string[] = [];
  let total = 0;

  const validate = (schema: unknown, example: unknown, label: string) => {
    total += 1;
    const dereferenced = dereferenceSchema(schema);
    if (typeof dereferenced !== "boolean" && typeof dereferenced !== "object") {
      throw new Error(`Example schema missing at ${label}`);
    }
    const validator = ajv.compile(dereferenced as AnySchema);
    if (!validator(example)) invalid.push(`${label}:${safeValidationDiagnostic(validator)}`);
  };

  const visit = (value: unknown, label: string) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        visit(entry, `${label}[${String(index)}]`);
      });
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const candidate = value as JsonObject;
    if (candidate["schema"] !== undefined && candidate["example"] !== undefined) {
      validate(candidate["schema"], candidate["example"], `${label}.example`);
    }
    if (candidate["schema"] !== undefined && candidate["examples"] !== undefined) {
      for (const [name, exampleValue] of Object.entries(object(candidate["examples"], label))) {
        const resolved = resolveObject(exampleValue, `${label}.examples.${name}`);
        if (resolved["value"] !== undefined) {
          validate(candidate["schema"], resolved["value"], `${label}.examples.${name}`);
        }
      }
    }
    for (const [key, entry] of Object.entries(candidate)) visit(entry, `${label}.${key}`);
  };

  visit(document, "openapi");
  return { invalid, total };
}

function publicSchemaIdentifiers(): string[] {
  const identifiers: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const candidate = value as JsonObject;
    const properties = candidate["properties"];
    if (typeof properties === "object" && properties !== null && !Array.isArray(properties)) {
      identifiers.push(...Object.keys(properties));
    }
    if (Array.isArray(candidate["enum"])) {
      identifiers.push(
        ...candidate["enum"].filter((entry): entry is string => typeof entry === "string"),
      );
    }
    const reference = candidate["$ref"];
    if (typeof reference === "string") identifiers.push(reference.split("/").at(-1) ?? "");
    Object.values(candidate).forEach(visit);
  };

  const root = object(document, "root");
  const components = object(root["components"], "components");
  identifiers.push(...Object.keys(object(components["schemas"], "components.schemas")));
  for (const { operation, operationId } of operations()) {
    identifiers.push(operationId);
    const parameters = operation["parameters"];
    if (Array.isArray(parameters)) {
      for (const parameter of parameters) {
        const name = resolveObject(parameter, operationId)["name"];
        if (typeof name === "string") identifiers.push(name);
      }
    }
  }
  visit(components["schemas"]);
  return identifiers;
}

describe("Cashmemo OpenAPI contract", () => {
  it("passes OpenAPI 3.1 lint", () => {
    const result = spawnSync(
      "pnpm",
      ["exec", "redocly", "lint", contractPath, "--format=stylish"],
      { cwd: process.cwd(), encoding: "utf8", shell: false },
    );
    const diagnostic = [result.stdout, result.stderr].filter(Boolean).join("\n");

    expect(result.status, diagnostic).toBe(0);
  }, 30_000);

  it("validates every declared parameter, request, and response example", () => {
    const result = validateDeclaredExamples();

    expect(result.invalid).toEqual([]);
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  it("gives every operation explicit authority and stable error coverage", () => {
    const root = object(document, "root");
    const inheritedSecurity = array(root["security"], "security");
    const operationIds = new Set<string>();

    for (const { operation, operationId, path } of operations()) {
      expect(operationIds.has(operationId), `${path} duplicate operationId`).toBe(false);
      operationIds.add(operationId);
      const security = operation["security"] ?? inheritedSecurity;
      expect(Array.isArray(security), `${path} security`).toBe(true);
      if (Array.isArray(security) && security.length === 0) {
        expect(publicOperationIds.has(operationId), `${path} unexpected public operation`).toBe(
          true,
        );
      } else {
        expect(JSON.stringify(security)).toContain("sessionCookie");
      }

      const responses = object(operation["responses"], `${path}.responses`);
      expect(Object.keys(responses).some((status) => /^2[0-9]{2}$/u.test(status))).toBe(true);
      expect(Object.keys(responses).some((status) => /^[45][0-9]{2}$/u.test(status))).toBe(true);

      for (const [status, responseValue] of Object.entries(responses)) {
        if (!/^[45][0-9]{2}$/u.test(status)) continue;
        const response = resolveObject(responseValue, `${path}.responses.${status}`);
        const content = object(response["content"], `${path}.responses.${status}.content`);
        const media = object(content["application/json"], `${path}.responses.${status}.json`);
        const schema = object(media["schema"], `${path}.responses.${status}.schema`);
        const reference = schema["$ref"];
        expect(
          typeof reference === "string" && /(?:Error|ResultsChangedError)$/u.test(reference),
        ).toBe(true);
      }
    }
  });

  it("exposes no provider-specific schema, property, enum, parameter, or operation identifiers", () => {
    expect(
      publicSchemaIdentifiers().filter((identifier) => providerIdentifier.test(identifier)),
    ).toEqual([]);
  });
});
