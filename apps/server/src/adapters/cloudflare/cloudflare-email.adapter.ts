import { randomBytes } from "node:crypto";

import type {
  EmailDeliveryEvent,
  EmailDeliveryInput,
  EmailPort,
} from "../../modules/identity/email.port.js";

export type CloudflareEmailFailureCode =
  "EMAIL_CONFIGURATION_INVALID" | "EMAIL_PERMANENT_FAILURE" | "EMAIL_TEMPORARILY_UNAVAILABLE";

export class CloudflareEmailDeliveryError extends Error {
  readonly code: CloudflareEmailFailureCode;
  readonly retryable: boolean;

  constructor(code: CloudflareEmailFailureCode, retryable: boolean) {
    super(code);
    this.name = "CloudflareEmailDeliveryError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface CloudflareEmailAdapterOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly baseUrl?: "https://api.cloudflare.com/client/v4";
  readonly fetchImplementation?: typeof fetch;
  readonly fromAddress: string;
  readonly retryLimit?: number;
  readonly timeoutMilliseconds?: number;
}

function message(input: Readonly<EmailDeliveryInput>, fromAddress: string) {
  const verification = input.operation === "verification";
  return Object.freeze({
    from: { email: fromAddress, name: "Cashmemo" },
    subject: verification ? "Verify your Cashmemo email address" : "Reset your Cashmemo password",
    text: verification
      ? `Use this link to verify your email address:\n\n${input.oneTimeUrl}\n\nThis link expires in 24 hours.`
      : `Use this link to reset your password:\n\n${input.oneTimeUrl}\n\nThis link expires in 1 hour.`,
    to: [{ email: input.destination }],
  });
}

function temporaryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function createCloudflareEmailAdapter(
  options: Readonly<CloudflareEmailAdapterOptions>,
): EmailPort {
  if (options.accountId.trim() === "" || options.apiToken.length < 32) {
    throw new CloudflareEmailDeliveryError("EMAIL_CONFIGURATION_INVALID", false);
  }
  const request = options.fetchImplementation ?? fetch;
  const endpoint = `${options.baseUrl ?? "https://api.cloudflare.com/client/v4"}/accounts/${encodeURIComponent(options.accountId)}/email/sending/send`;

  return {
    async send(input: Readonly<EmailDeliveryInput>): Promise<EmailDeliveryEvent> {
      const correlationId = randomBytes(16).toString("hex");
      const startedAt = Date.now();
      const retryLimit = options.retryLimit ?? 2;
      for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
        }, options.timeoutMilliseconds ?? 5_000);
        try {
          const response = await request(endpoint, {
            body: JSON.stringify(message(input, options.fromAddress)),
            headers: {
              Authorization: `Bearer ${options.apiToken}`,
              "Content-Type": "application/json",
            },
            method: "POST",
            signal: controller.signal,
          });
          if (response.ok) {
            return Object.freeze({
              correlationId,
              durationMs: Date.now() - startedAt,
              operation: input.operation,
              providerMessageId: response.headers.get("cf-ray"),
              state: "accepted" as const,
            });
          }
          if (temporaryStatus(response.status) && attempt < retryLimit) continue;
          throw new CloudflareEmailDeliveryError(
            temporaryStatus(response.status)
              ? "EMAIL_TEMPORARILY_UNAVAILABLE"
              : "EMAIL_PERMANENT_FAILURE",
            temporaryStatus(response.status),
          );
        } catch (error) {
          if (error instanceof CloudflareEmailDeliveryError) throw error;
          if (attempt < retryLimit) continue;
          throw new CloudflareEmailDeliveryError("EMAIL_TEMPORARILY_UNAVAILABLE", true);
        } finally {
          clearTimeout(timeout);
        }
      }
      throw new CloudflareEmailDeliveryError("EMAIL_TEMPORARILY_UNAVAILABLE", true);
    },
  };
}
