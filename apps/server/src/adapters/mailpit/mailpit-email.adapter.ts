import { randomBytes } from "node:crypto";

import type {
  EmailDeliveryEvent,
  EmailDeliveryInput,
  EmailPort,
} from "../../modules/identity/email.port.js";

export interface MailpitAdapterOptions {
  readonly apiUrl: string;
}

export function createMailpitAdapter(options: Readonly<MailpitAdapterOptions>): EmailPort {
  return {
    async send(input: Readonly<EmailDeliveryInput>): Promise<EmailDeliveryEvent> {
      const correlationId = randomBytes(16).toString("hex");
      const startedAt = Date.now();

      const subject =
        input.operation === "verification"
          ? "Verify your Cashmemo email address"
          : "Reset your Cashmemo password";

      const body =
        input.operation === "verification"
          ? `Use this link to verify your email address:\n\n${input.oneTimeUrl}\n\nThis link expires in 24 hours.`
          : `Use this link to reset your password:\n\n${input.oneTimeUrl}\n\nThis link expires in 1 hour.`;

      const response = await fetch(`${options.apiUrl}/api/v1/send`, {
        body: JSON.stringify({
          From: "noreply@cashmemo.test",
          Subject: subject,
          Text: body,
          To: [input.destination],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const durationMs = Date.now() - startedAt;
      const messageId = response.headers.get("x-mailpit-id");

      return {
        correlationId,
        durationMs,
        operation: input.operation,
        providerMessageId: messageId,
        state: response.ok ? "accepted" : "failed",
      };
    },
  };
}
