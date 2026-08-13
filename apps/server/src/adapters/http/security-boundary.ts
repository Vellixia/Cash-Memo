export interface HttpSecurityEnvironment {
  readonly appOrigin: string;
  readonly environment: "development" | "local" | "production" | "staging" | "test";
}
const STATE_CHANGING_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);
export function allowedOrigins(
  configuration: Readonly<HttpSecurityEnvironment>,
): readonly string[] {
  if (
    configuration.environment === "production" &&
    /localhost|127\.0\.0\.1/iu.test(configuration.appOrigin)
  )
    throw new Error("PRODUCTION_ORIGIN_INVALID");
  return configuration.environment === "local"
    ? Object.freeze([configuration.appOrigin, "http://localhost:5173", "https://localhost:5173"])
    : Object.freeze([configuration.appOrigin]);
}
export function requireSameOrigin(input: {
  readonly configuration: HttpSecurityEnvironment;
  readonly method: string;
  readonly origin: string | undefined;
}): "allowed" | "blocked" {
  if (!STATE_CHANGING_METHODS.has(input.method.toUpperCase())) return "allowed";
  if (input.origin === undefined) return "blocked";
  return allowedOrigins(input.configuration).includes(input.origin) ? "allowed" : "blocked";
}
export function privateSecurityHeaders(https: boolean): Readonly<Record<string, string>> {
  return Object.freeze({
    "Cache-Control": "private, no-store",
    "Content-Security-Policy":
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...(https ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  });
}
export function secureDownloadHeaders(
  filename: "cashmemo-export.zip",
): Readonly<Record<string, string>> {
  return Object.freeze({
    ...privateSecurityHeaders(true),
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Type": "application/zip",
    "X-Content-Type-Options": "nosniff",
  });
}
