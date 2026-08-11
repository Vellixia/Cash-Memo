export type CapabilityStatusKind =
  | "assisted_capture_unavailable"
  | "auth_unavailable"
  | "calculation_unavailable"
  | "core_storage_unavailable"
  | "voice_unavailable";

const messages: Record<CapabilityStatusKind, { heading: string; detail: string }> = {
  assisted_capture_unavailable: {
    detail: "Structured manual entry remains available.",
    heading: "Assisted capture unavailable",
  },
  auth_unavailable: {
    detail: "Protected operations are unavailable. Authentication is never bypassed.",
    heading: "Authentication unavailable",
  },
  calculation_unavailable: {
    detail: "Journal capture and history remain available.",
    heading: "Calculation unavailable",
  },
  core_storage_unavailable: {
    detail: "Saving is unavailable. Any local draft remains unsaved and is not a Money Memo.",
    heading: "Journal saving unavailable",
  },
  voice_unavailable: {
    detail: "Typed and structured manual entry remain available.",
    heading: "Voice assistance unavailable",
  },
};

export function CapabilityStatus({ kind }: { readonly kind: CapabilityStatusKind }) {
  const message = messages[kind];
  const core = kind === "auth_unavailable" || kind === "core_storage_unavailable";
  return (
    <section
      aria-live={core ? "assertive" : "polite"}
      data-capability-class={core ? "core" : "degraded"}
      data-testid={`capability-${kind}`}
      role={core ? "alert" : "status"}
    >
      <h3>{message.heading}</h3>
      <p>{message.detail}</p>
    </section>
  );
}
