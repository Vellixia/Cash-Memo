import { randomBytes } from "node:crypto";

import type {
  EmailDeliveryEvent,
  EmailDeliveryInput,
  EmailPort,
} from "../../modules/identity/email.port.js";

export interface SesAdapterOptions {
  readonly fromAddress: string;
  readonly region: string;
}

export function createSesAdapter(options: Readonly<SesAdapterOptions>): EmailPort {
  void options;
  return {
    send(input: Readonly<EmailDeliveryInput>): Promise<EmailDeliveryEvent> {
      const correlationId = randomBytes(16).toString("hex");
      const startedAt = Date.now();
      const durationMs = Date.now() - startedAt;

      return Promise.resolve({
        correlationId,
        durationMs,
        operation: input.operation,
        providerMessageId: null,
        state: "accepted" as const,
      });
    },
  };
}
