import type { BackupLineageInventoryPort } from "../../adapters/aws/backup-lineage-inventory.adapter.js";
import type { DeletionSuppressionCleanupPort } from "../../adapters/aws/deletion-suppression.adapter.js";
import type { SuppressionKeyManager } from "./suppression-key-manager.js";

interface SuppressionCleanupResult {
  readonly alert: boolean;
  readonly blocker:
    "artifact_present" | "floor_not_reached" | "inventory_not_authoritative" | "key_missing" | null;
  readonly removed: boolean;
  readonly retry: boolean;
}

class SuppressionCleanupService {
  constructor(
    private readonly ledger: DeletionSuppressionCleanupPort,
    private readonly inventoryPort: BackupLineageInventoryPort,
    private readonly keyManager: SuppressionKeyManager,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verifyAndRemove(token: Buffer, keyVersion: string): Promise<SuppressionCleanupResult> {
    const loaded = await this.ledger.loadForCleanup(token, keyVersion);
    if (loaded === null)
      return Object.freeze({ alert: false, blocker: null, removed: false, retry: false });
    if (this.now().getTime() < loaded.record.removalNotBeforeAt.getTime()) {
      return Object.freeze({
        alert: false,
        blocker: "floor_not_reached",
        removed: false,
        retry: true,
      });
    }
    const inventory = await this.inventoryPort.inventory();
    if (inventory.state !== "complete_current") {
      return Object.freeze({
        alert: true,
        blocker: "inventory_not_authoritative",
        removed: false,
        retry: true,
      });
    }
    if (
      inventory.artifacts.some(
        (artifact) =>
          artifact.state === "unverifiable" || (artifact.capable && artifact.state === "present"),
      )
    ) {
      return Object.freeze({
        alert: true,
        blocker: "artifact_present",
        removed: false,
        retry: true,
      });
    }
    try {
      this.keyManager.getKey(keyVersion);
    } catch {
      return Object.freeze({ alert: true, blocker: "key_missing", removed: false, retry: true });
    }
    await this.ledger.removeVerified({
      expectedVersionId: loaded.versionId,
      suppressionKeyVersion: keyVersion,
      token,
      verifierDecision: "verified_eligible",
    });
    return Object.freeze({ alert: false, blocker: null, removed: true, retry: false });
  }
}

export { SuppressionCleanupService, type SuppressionCleanupResult };
