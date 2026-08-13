import type { Pool } from "pg";

import type { PrivacyBoundaryPort } from "@cashmemo/privacy-rules";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";
import { createDraft, type ComposeDraftView } from "../draft/application/ports/draft-store.port.js";
import { validateExtractionOutput } from "./extraction-validation.js";
import type { ExtractionPort, ExtractionResult } from "./provider-ports.js";

export interface TextExtractionInput {
  readonly captureStartedAt: string;
  readonly captureTimezone: string;
  readonly consent: string;
  readonly text: string;
}

export interface TextExtractionView {
  readonly captureId: string;
  readonly draft: ComposeDraftView;
  readonly state: "correction_required" | "draft_review" | "failed_recoverable";
}

export class TextExtractionError extends Error {
  constructor(
    readonly code:
      | "AI_UNAVAILABLE"
      | "PRIVACY_BOUNDARY_BLOCKED"
      | "PROVIDER_CONSENT_REQUIRED"
      | "VALIDATION_FAILED",
  ) {
    super(code);
    this.name = "TextExtractionError";
  }
}

interface TextExtractionServiceOptions {
  readonly extraction: ExtractionPort;
  readonly now?: () => Date;
  readonly pool: Pool;
  readonly privacy: PrivacyBoundaryPort;
}

function validateInput(input: Readonly<TextExtractionInput>): void {
  if (input.consent !== "SEND_THIS_TEXT_FOR_AI_EXTRACTION") {
    throw new TextExtractionError("PROVIDER_CONSENT_REQUIRED");
  }
  if (input.text.length === 0 || input.text.length > 4_000) {
    throw new TextExtractionError("VALIDATION_FAILED");
  }
  try {
    new Date(input.captureStartedAt).toISOString();
    new Intl.DateTimeFormat("en-US", { timeZone: input.captureTimezone }).format(0);
  } catch {
    throw new TextExtractionError("VALIDATION_FAILED");
  }
}

async function boundedExtract(
  extraction: ExtractionPort,
  input: Readonly<TextExtractionInput>,
): Promise<ExtractionResult> {
  let result: ExtractionResult = { state: "unavailable" };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    result = await extraction.extract({
      attempt,
      captureStartedAt: input.captureStartedAt,
      captureTimezone: input.captureTimezone,
      consent: input.consent,
      deadlineMs: 10_000,
      text: input.text,
    });
    if (result.state !== "timeout" && result.state !== "rate_limit") return result;
  }
  return result;
}

export class TextExtractionService {
  private readonly extraction: ExtractionPort;
  private readonly now: () => Date;
  private readonly pool: Pool;
  private readonly privacy: PrivacyBoundaryPort;

  constructor(options: Readonly<TextExtractionServiceOptions>) {
    this.extraction = options.extraction;
    this.now = options.now ?? (() => new Date());
    this.pool = options.pool;
    this.privacy = options.privacy;
  }

  async extract(
    accountId: string,
    input: Readonly<TextExtractionInput>,
  ): Promise<TextExtractionView> {
    validateInput(input);
    const privacy = await this.privacy.evaluateText({
      boundary: "typed_text_ai_transmission",
      content: input.text,
      ruleSetVersion: "privacy-detector-v1",
    });
    if (privacy.decision !== "allow") throw new TextExtractionError("PRIVACY_BOUNDARY_BLOCKED");
    const persistencePrivacy = await this.privacy.evaluateText({
      boundary: "server_draft_persistence",
      content: input.text,
      ruleSetVersion: "privacy-detector-v1",
    });
    if (persistencePrivacy.decision !== "allow") {
      throw new TextExtractionError("PRIVACY_BOUNDARY_BLOCKED");
    }

    const providerResult = await boundedExtract(this.extraction, input);
    const owned = await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const [categories, spaces] = await Promise.all([
        transaction.query<{ id: string; kind: "expense" | "income" }>(
          `SELECT id, kind FROM categories WHERE user_id = $1 AND status = 'active'`,
          [accountId],
        ),
        transaction.query<{ id: string }>(
          `SELECT id FROM money_spaces WHERE user_id = $1 AND status = 'active'`,
          [accountId],
        ),
      ]);
      return {
        categoryKinds: new Map(categories.rows.map((row) => [row.id, row.kind])),
        moneySpaceIds: new Set(spaces.rows.map((row) => row.id)),
      };
    });

    let state: TextExtractionView["state"] = "failed_recoverable";
    let candidateFields: Record<string, unknown> = {};
    let assessments: readonly unknown[] = [];
    if (providerResult.state === "success" || providerResult.state === "ambiguous") {
      try {
        const validated = validateExtractionOutput(providerResult, {
          ...owned,
          now: this.now().toISOString(),
          timezoneDatabaseVersion: "system-local",
        });
        state = validated.status === "reviewable" ? "draft_review" : "correction_required";
        candidateFields = { ...validated.fields };
        assessments = validated.assessments;
      } catch {
        state = "correction_required";
      }
    }

    const draft = await createDraft(this.pool, accountId, {
      candidateFields,
      captureStartedAt: input.captureStartedAt,
      captureTimezone: input.captureTimezone,
      fieldProvenance: assessments,
      origin: "natural_language",
      sourceCompleteness: "complete",
      sourceText: input.text,
      status:
        state === "draft_review"
          ? "reviewable"
          : state === "correction_required"
            ? "reviewable"
            : "failed_recoverable",
    });
    const captureId = await withAccountTransaction(this.pool, accountId, async (transaction) => {
      const result = await transaction.query<{ id: string }>(
        `INSERT INTO assisted_captures (
           id, user_id, draft_id, mode, state, ai_consent_version, capture_started_at,
           last_error_code, revision
         ) VALUES (
           gen_random_uuid(), $1, $2, 'text', $3, 'text-extraction-v1', $4,
           $5::capture_error_code, 1
         ) RETURNING id`,
        [
          accountId,
          draft.id,
          state,
          input.captureStartedAt,
          state === "failed_recoverable"
            ? "extraction_unavailable"
            : state === "correction_required"
              ? "ambiguous_output"
              : null,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) throw new TextExtractionError("AI_UNAVAILABLE");
      return row.id;
    });
    return Object.freeze({ captureId, draft, state });
  }
}
