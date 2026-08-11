import type { Pool } from "pg";

import type { PrivacyBoundaryPort } from "@cashmemo/privacy-rules";

import { withAccountTransaction } from "../../adapters/postgres/transaction-context.js";
import { getDraft, type ComposeDraftView } from "../draft/draft.service.js";
import { requireProviderConsent } from "./consent-policy.js";
import { validateExtractionOutput } from "./extraction-validation.js";
import type { ExtractionPort, ExtractionResult } from "./provider-ports.js";

export class TranscriptBoundaryError extends Error {
  constructor(readonly code: "AI_UNAVAILABLE" | "PRIVACY_BOUNDARY_BLOCKED") {
    super(code);
    this.name = "TranscriptBoundaryError";
  }
}

export interface TranscriptProcessResult {
  readonly draft: ComposeDraftView;
  readonly state: "correction_required" | "draft_review" | "failed_recoverable";
}

export class TranscriptService {
  constructor(
    private readonly options: {
      readonly extraction: ExtractionPort;
      readonly now?: () => Date;
      readonly pool: Pool;
      readonly privacy: PrivacyBoundaryPort;
    },
  ) {}

  async process(
    accountId: string,
    input: {
      readonly captureStartedAt: string;
      readonly captureTimezone: string;
      readonly completeness: "complete" | "incomplete";
      readonly consent: "SEND_THE_TRANSCRIPT_FOR_AI_EXTRACTION";
      readonly draftId: string;
      readonly transcript: string;
    },
  ): Promise<TranscriptProcessResult> {
    requireProviderConsent("transcriptExtraction", input.consent);
    const persistence = await this.options.privacy.evaluateText({
      boundary: "transcript_persistence",
      content: input.transcript,
      ruleSetVersion: "privacy-detector-v1",
    });
    if (persistence.decision !== "allow") {
      throw new TranscriptBoundaryError("PRIVACY_BOUNDARY_BLOCKED");
    }
    await withAccountTransaction(this.options.pool, accountId, async (transaction) => {
      const result = await transaction.query(
        `UPDATE compose_drafts
            SET source_text = $3, source_completeness = $4, status = 'processing',
                last_activity_at = now(), expires_at = now() + interval '7 days',
                revision = revision + 1
          WHERE id = $1 AND user_id = $2`,
        [input.draftId, accountId, input.transcript, input.completeness],
      );
      if (result.rowCount === 0) throw new Error("DRAFT_NOT_FOUND");
    });
    const transmission = await this.options.privacy.evaluateText({
      boundary: "transcript_ai_transmission",
      content: input.transcript,
      ruleSetVersion: "privacy-detector-v1",
    });
    if (transmission.decision !== "allow") {
      throw new TranscriptBoundaryError("PRIVACY_BOUNDARY_BLOCKED");
    }

    let providerResult: ExtractionResult = { state: "unavailable" };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      providerResult = await this.options.extraction.extract({
        attempt,
        captureStartedAt: input.captureStartedAt,
        captureTimezone: input.captureTimezone,
        consent: input.consent,
        deadlineMs: 10_000,
        text: input.transcript,
      });
      if (providerResult.state !== "timeout" && providerResult.state !== "rate_limit") break;
    }
    const owned = await withAccountTransaction(
      this.options.pool,
      accountId,
      async (transaction) => {
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
      },
    );

    let fields: Record<string, unknown> = {};
    let assessments: readonly unknown[] = [];
    let state: TranscriptProcessResult["state"] = "failed_recoverable";
    if (providerResult.state === "success" || providerResult.state === "ambiguous") {
      try {
        const validated = validateExtractionOutput(providerResult, {
          ...owned,
          now: (this.options.now ?? (() => new Date()))().toISOString(),
          timezoneDatabaseVersion: "system-local",
        });
        fields = { ...validated.fields };
        assessments = validated.assessments;
        state =
          input.completeness === "incomplete" || validated.status === "correction_required"
            ? "correction_required"
            : "draft_review";
      } catch {
        state = "correction_required";
      }
    }
    await withAccountTransaction(this.options.pool, accountId, async (transaction) => {
      await transaction.query(
        `UPDATE compose_drafts
            SET candidate_fields = $3::jsonb, field_provenance = $4::jsonb,
                status = $5::compose_draft_status, last_activity_at = now(),
                expires_at = now() + interval '7 days', revision = revision + 1
          WHERE id = $1 AND user_id = $2`,
        [
          input.draftId,
          accountId,
          JSON.stringify(fields),
          JSON.stringify(assessments),
          state === "failed_recoverable" ? "failed_recoverable" : "reviewable",
        ],
      );
    });
    return Object.freeze({
      draft: await getDraft(this.options.pool, accountId, input.draftId),
      state,
    });
  }
}
