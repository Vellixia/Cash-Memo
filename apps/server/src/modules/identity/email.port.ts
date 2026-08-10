export type EmailDeliveryOperation = "verification" | "password_reset";

export interface EmailDeliveryEvent {
  readonly operation: EmailDeliveryOperation;
  readonly providerMessageId: string | null;
  readonly state: "accepted" | "delivered" | "failed" | "bounced";
  readonly durationMs: number;
  readonly correlationId: string;
}

export interface EmailDeliveryInput {
  readonly destination: string;
  readonly oneTimeUrl: string;
  readonly operation: EmailDeliveryOperation;
}

export interface EmailPort {
  send(input: Readonly<EmailDeliveryInput>): Promise<EmailDeliveryEvent>;
}
