interface SuppressionKeyVersion {
  readonly createdAt: Date;
  readonly version: string;
}

interface KeyRetirementProof {
  readonly authoritativeInventoryComplete: boolean;
  readonly lineageDependencies: number;
  readonly suppressionRecords: number;
}

class SuppressionKeyManager {
  private activeVersion: string | null = null;
  private readonly keys = new Map<string, { readonly createdAt: Date; readonly key: Buffer }>();

  createVersion(version: string, key: Buffer, createdAt: Date): SuppressionKeyVersion {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(version)) throw new Error("INVALID_KEY_VERSION");
    if (key.length < 32) throw new Error("SUPPRESSION_KEY_TOO_SHORT");
    if (this.keys.has(version)) throw new Error("SUPPRESSION_KEY_VERSION_EXISTS");
    this.keys.set(version, { createdAt: new Date(createdAt), key: Buffer.from(key) });
    this.activeVersion ??= version;
    return Object.freeze({ createdAt: new Date(createdAt), version });
  }

  rotate(version: string, key: Buffer, createdAt: Date): SuppressionKeyVersion {
    const created = this.createVersion(version, key, createdAt);
    this.activeVersion = version;
    return created;
  }

  getActive(): { readonly key: Buffer; readonly version: string } {
    if (this.activeVersion === null) throw new Error("SUPPRESSION_ACTIVE_KEY_MISSING");
    return { key: this.getKey(this.activeVersion), version: this.activeVersion };
  }

  getKey(version: string): Buffer {
    const found = this.keys.get(version);
    if (found === undefined) throw new Error("SUPPRESSION_KEY_VERSION_MISSING");
    return Buffer.from(found.key);
  }

  retainedVersions(): readonly string[] {
    return [...this.keys.keys()].sort();
  }

  retire(version: string, proof: Readonly<KeyRetirementProof>): void {
    if (version === this.activeVersion)
      throw new Error("ACTIVE_SUPPRESSION_KEY_RETIREMENT_BLOCKED");
    if (
      !proof.authoritativeInventoryComplete ||
      proof.lineageDependencies !== 0 ||
      proof.suppressionRecords !== 0
    ) {
      throw new Error("SUPPRESSION_KEY_RETIREMENT_BLOCKED");
    }
    if (!this.keys.delete(version)) throw new Error("SUPPRESSION_KEY_VERSION_MISSING");
  }
}

export { SuppressionKeyManager, type KeyRetirementProof, type SuppressionKeyVersion };
