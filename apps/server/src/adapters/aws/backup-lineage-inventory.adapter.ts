type BackupArtifactClass =
  | "automated_pitr_window"
  | "retained_automated_backup"
  | "manual_snapshot"
  | "final_snapshot"
  | "copied_snapshot"
  | "shared_snapshot"
  | "aws_backup_recovery_point"
  | "replica"
  | "cross_region_copy"
  | "temporary_restore_copy";

const REQUIRED_ARTIFACT_CLASSES: readonly BackupArtifactClass[] = Object.freeze([
  "automated_pitr_window",
  "retained_automated_backup",
  "manual_snapshot",
  "final_snapshot",
  "copied_snapshot",
  "shared_snapshot",
  "aws_backup_recovery_point",
  "replica",
  "cross_region_copy",
  "temporary_restore_copy",
]);

interface BackupArtifact {
  readonly artifactClass: BackupArtifactClass;
  readonly capable: boolean;
  readonly registered: boolean;
  readonly requiresKeyVersions: readonly string[];
  readonly state: "absent" | "destroyed" | "present" | "unverifiable";
}

interface InventoryPage {
  readonly artifacts: readonly BackupArtifact[];
  readonly nextToken: string | null;
  readonly source: BackupArtifactClass;
  readonly sourceCurrent: boolean;
}

interface BackupLineageSource {
  list(input: {
    readonly artifactClass: BackupArtifactClass;
    readonly nextToken: string | null;
  }): Promise<InventoryPage>;
}

interface BackupLineageInventory {
  readonly artifacts: readonly BackupArtifact[];
  readonly checkedClasses: readonly BackupArtifactClass[];
  readonly state: "complete_current" | "stale_incomplete" | "unavailable";
}

interface BackupLineageInventoryPort {
  inventory(): Promise<BackupLineageInventory>;
}

class AwsBackupLineageInventoryAdapter implements BackupLineageInventoryPort {
  constructor(private readonly source: BackupLineageSource) {}

  async inventory(): Promise<BackupLineageInventory> {
    const artifacts: BackupArtifact[] = [];
    const checked: BackupArtifactClass[] = [];
    try {
      for (const artifactClass of REQUIRED_ARTIFACT_CLASSES) {
        let nextToken: string | null = null;
        const seen = new Set<string>();
        do {
          if (nextToken !== null && seen.has(nextToken)) {
            return Object.freeze({
              artifacts: Object.freeze(artifacts),
              checkedClasses: Object.freeze(checked),
              state: "stale_incomplete",
            });
          }
          if (nextToken !== null) seen.add(nextToken);
          const page = await this.source.list({ artifactClass, nextToken });
          if (page.source !== artifactClass || !page.sourceCurrent) {
            return Object.freeze({
              artifacts: Object.freeze(artifacts),
              checkedClasses: Object.freeze(checked),
              state: "stale_incomplete",
            });
          }
          artifacts.push(...page.artifacts);
          nextToken = page.nextToken;
        } while (nextToken !== null);
        checked.push(artifactClass);
      }
    } catch {
      return Object.freeze({
        artifacts: Object.freeze(artifacts),
        checkedClasses: Object.freeze(checked),
        state: "unavailable",
      });
    }
    return Object.freeze({
      artifacts: Object.freeze(
        [...artifacts].sort((a, b) => a.artifactClass.localeCompare(b.artifactClass)),
      ),
      checkedClasses: Object.freeze([...checked]),
      state: "complete_current",
    });
  }
}

class ContractBackupLineageSource implements BackupLineageSource {
  private readonly pages = new Map<BackupArtifactClass, readonly InventoryPage[]>();
  private unavailable = false;

  setUnavailableForTest(value: boolean): void {
    this.unavailable = value;
  }
  setPagesForTest(artifactClass: BackupArtifactClass, pages: readonly InventoryPage[]): void {
    this.pages.set(artifactClass, pages);
  }
  async list(input: {
    readonly artifactClass: BackupArtifactClass;
    readonly nextToken: string | null;
  }): Promise<InventoryPage> {
    await Promise.resolve();
    if (this.unavailable) throw new Error("BACKUP_INVENTORY_UNAVAILABLE");
    const pages = this.pages.get(input.artifactClass) ?? [
      { artifacts: [], nextToken: null, source: input.artifactClass, sourceCurrent: true },
    ];
    const index = input.nextToken === null ? 0 : Number(input.nextToken);
    return (
      pages[index] ?? {
        artifacts: [],
        nextToken: null,
        source: input.artifactClass,
        sourceCurrent: false,
      }
    );
  }
}

export {
  AwsBackupLineageInventoryAdapter,
  ContractBackupLineageSource,
  REQUIRED_ARTIFACT_CLASSES,
  type BackupArtifact,
  type BackupArtifactClass,
  type BackupLineageInventory,
  type BackupLineageInventoryPort,
  type BackupLineageSource,
  type InventoryPage,
};
