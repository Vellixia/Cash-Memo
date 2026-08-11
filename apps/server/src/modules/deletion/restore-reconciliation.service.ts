import { deriveDeletionToken, type DeletionEntityType } from "./deletion-suppression.port.js";
import type { SuppressionKeyManager } from "./suppression-key-manager.js";

interface RestoredMemo {
  readonly id: string;
  readonly lifecycleState: "active" | "archived" | "deleted";
  readonly purgeAfter: Date | null;
}

interface RestoredDraft {
  readonly expiresAt: Date;
  readonly id: string;
}

interface RestoredSession {
  readonly expiresAt: Date;
  readonly id: string;
}

interface RestoredAccount {
  readonly drafts: readonly RestoredDraft[];
  readonly id: string;
  readonly memos: readonly RestoredMemo[];
  readonly sessions: readonly RestoredSession[];
}

interface RestoreSuppressionLedger {
  hasToken(input: {
    readonly entityType: DeletionEntityType;
    readonly suppressionKeyVersion: string;
    readonly token: Buffer;
  }): Promise<boolean>;
  requiredKeyVersions(): Promise<readonly string[]>;
  status(): Promise<"available" | "unavailable" | "unverifiable">;
}

interface RestoreReconciliationResult {
  readonly accountFirstVerified: boolean;
  readonly blocker:
    | "incomplete_reconciliation"
    | "ledger_unavailable"
    | "missing_key"
    | "verification_failed"
    | null;
  readonly purgedAccounts: number;
  readonly purgedMemos: number;
  readonly remainingAccounts: readonly RestoredAccount[];
  readonly releaseAllowed: boolean;
  readonly revokedSessions: number;
  readonly sweptExpiredDrafts: number;
  readonly sweptExpiredMemos: number;
}

class RestoreReconciliationService {
  constructor(
    private readonly ledger: RestoreSuppressionLedger,
    private readonly keys: SuppressionKeyManager,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(
    accounts: readonly RestoredAccount[],
    verificationComplete = true,
  ): Promise<RestoreReconciliationResult> {
    let ledgerState: Awaited<ReturnType<RestoreSuppressionLedger["status"]>>;
    try {
      ledgerState = await this.ledger.status();
    } catch {
      return this.blocked("ledger_unavailable");
    }
    if (ledgerState === "unavailable") return this.blocked("ledger_unavailable");
    if (ledgerState === "unverifiable") return this.blocked("verification_failed");
    if (!verificationComplete) return this.blocked("incomplete_reconciliation");

    let required: readonly string[];
    try {
      required = await this.ledger.requiredKeyVersions();
      for (const version of required) this.keys.getKey(version);
    } catch {
      return this.blocked("missing_key");
    }

    const versions = this.keys.retainedVersions();
    const remaining: RestoredAccount[] = [];
    let purgedAccounts = 0;
    let purgedMemos = 0;
    let revokedSessions = 0;
    let sweptExpiredDrafts = 0;
    let sweptExpiredMemos = 0;
    const now = this.now().getTime();

    for (const account of accounts) {
      if (await this.matches("account", account.id, versions)) {
        purgedAccounts += 1;
        continue;
      }
      const memos: RestoredMemo[] = [];
      for (const memo of account.memos) {
        if (await this.matches("money_memo", memo.id, versions)) {
          purgedMemos += 1;
        } else if (
          memo.lifecycleState === "deleted" &&
          memo.purgeAfter !== null &&
          memo.purgeAfter.getTime() <= now
        ) {
          sweptExpiredMemos += 1;
        } else {
          memos.push(memo);
        }
      }
      const drafts = account.drafts.filter((draft) => {
        if (draft.expiresAt.getTime() > now) return true;
        sweptExpiredDrafts += 1;
        return false;
      });
      revokedSessions += account.sessions.length;
      remaining.push(
        Object.freeze({
          ...account,
          drafts: Object.freeze(drafts),
          memos: Object.freeze(memos),
          sessions: Object.freeze([]),
        }),
      );
    }
    return Object.freeze({
      accountFirstVerified: true,
      blocker: null,
      purgedAccounts,
      purgedMemos,
      remainingAccounts: Object.freeze(remaining),
      releaseAllowed: true,
      revokedSessions,
      sweptExpiredDrafts,
      sweptExpiredMemos,
    });
  }

  private async matches(
    entityType: DeletionEntityType,
    entityId: string,
    versions: readonly string[],
  ): Promise<boolean> {
    for (const version of versions) {
      const token = deriveDeletionToken({
        entityId,
        entityType,
        suppressionKey: this.keys.getKey(version),
      });
      if (await this.ledger.hasToken({ entityType, suppressionKeyVersion: version, token }))
        return true;
    }
    return false;
  }

  private blocked(
    blocker: NonNullable<RestoreReconciliationResult["blocker"]>,
  ): RestoreReconciliationResult {
    return Object.freeze({
      accountFirstVerified: false,
      blocker,
      purgedAccounts: 0,
      purgedMemos: 0,
      remainingAccounts: Object.freeze([]),
      releaseAllowed: false,
      revokedSessions: 0,
      sweptExpiredDrafts: 0,
      sweptExpiredMemos: 0,
    });
  }
}

export {
  RestoreReconciliationService,
  type RestoredAccount,
  type RestoredDraft,
  type RestoredMemo,
  type RestoredSession,
  type RestoreReconciliationResult,
  type RestoreSuppressionLedger,
};
