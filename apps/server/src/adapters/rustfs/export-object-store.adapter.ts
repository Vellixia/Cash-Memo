import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

interface ExportObjectPut {
  readonly accountScopeHmac: string;
  readonly body: Buffer;
  readonly expectedSha256: string;
  readonly expiresAt: Date;
}

interface ExportObjectHandle {
  readonly key: string;
  readonly sha256: string;
  readonly versionId: string;
}

interface ExportObjectVersion {
  readonly deleteMarker: boolean;
  readonly key: string;
  readonly versionId: string;
}

interface ExportObjectDeleteResult {
  readonly deletedVersions: number;
  readonly residualVersions: number;
}

interface ExportObjectStore {
  deleteEveryVersion(accountScopeHmac: string, key: string): Promise<ExportObjectDeleteResult>;
  listVersions(accountScopeHmac: string, key: string): Promise<readonly ExportObjectVersion[]>;
  openPrivateStream(
    accountScopeHmac: string,
    key: string,
    expectedSha256: string,
  ): Promise<Readable>;
  putPrivateExport(input: Readonly<ExportObjectPut>): Promise<ExportObjectHandle>;
}

interface S3CompatibleExportClient {
  deleteObjects(input: {
    readonly bucket: string;
    readonly objects: readonly { readonly key: string; readonly versionId: string }[];
  }): Promise<void>;
  getObject(input: { readonly bucket: string; readonly key: string }): Promise<Readable>;
  headObject(input: { readonly bucket: string; readonly key: string }): Promise<{
    readonly checksumSha256: string;
    readonly metadata: Readonly<Record<string, string>>;
    readonly versionId: string;
  } | null>;
  listObjectVersions(input: {
    readonly bucket: string;
    readonly key: string;
  }): Promise<readonly ExportObjectVersion[]>;
  putObject(input: {
    readonly body: Buffer;
    readonly bucket: string;
    readonly checksumSha256: string;
    readonly contentType: "application/zip";
    readonly key: string;
    readonly metadata: Readonly<Record<string, string>>;
  }): Promise<{ readonly versionId: string }>;
}

interface RustfsExportObjectStoreOptions {
  readonly bucket: string;
  readonly client: S3CompatibleExportClient;
  readonly retryLimit?: number;
}

function assertOpaqueScope(value: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error("INVALID_ACCOUNT_SCOPE_HMAC");
}

function assertOpaqueKey(value: string): void {
  if (!/^exports\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.zip$/u.test(value)) {
    throw new Error("INVALID_EXPORT_OBJECT_KEY");
  }
}

function assertSha256(value: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error("INVALID_EXPORT_SHA256");
}

function createOpaqueKey(): string {
  return `exports/${randomUUID()}/${randomUUID()}.zip`;
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof Error &&
    ["S3_COMPATIBLE_TIMEOUT", "S3_COMPATIBLE_UNAVAILABLE"].includes(error.message)
  );
}

async function retry<T>(limit: number, operation: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || attempt >= limit) throw error;
      attempt += 1;
    }
  }
}

async function digestStream(
  stream: Readable,
): Promise<{ readonly bytes: Buffer; readonly sha256: string }> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  const bytes = Buffer.concat(chunks);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

class RustfsExportObjectStoreAdapter implements ExportObjectStore {
  constructor(private readonly options: Readonly<RustfsExportObjectStoreOptions>) {}

  async putPrivateExport(input: Readonly<ExportObjectPut>): Promise<ExportObjectHandle> {
    assertOpaqueScope(input.accountScopeHmac);
    assertSha256(input.expectedSha256);
    const actual = createHash("sha256").update(input.body).digest("hex");
    if (actual !== input.expectedSha256) throw new Error("EXPORT_INTEGRITY_MISMATCH");
    const key = createOpaqueKey();
    const metadata = Object.freeze({
      accountScopeHmac: input.accountScopeHmac,
      expiresAt: input.expiresAt.toISOString(),
    });
    try {
      const result = await retry(this.options.retryLimit ?? 2, () =>
        this.options.client.putObject({
          body: input.body,
          bucket: this.options.bucket,
          checksumSha256: input.expectedSha256,
          contentType: "application/zip",
          key,
          metadata,
        }),
      );
      return Object.freeze({ key, sha256: input.expectedSha256, versionId: result.versionId });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "S3_COMPATIBLE_AMBIGUOUS_RESPONSE") {
        throw error;
      }
      const verified = await this.options.client.headObject({ bucket: this.options.bucket, key });
      const verifiedScope = verified?.metadata["accountScopeHmac"];
      if (
        verified?.checksumSha256 !== input.expectedSha256 ||
        verifiedScope !== input.accountScopeHmac
      ) {
        throw new Error("EXPORT_STORAGE_OUTCOME_UNVERIFIABLE", { cause: error });
      }
      return Object.freeze({ key, sha256: input.expectedSha256, versionId: verified.versionId });
    }
  }

  async openPrivateStream(
    accountScopeHmac: string,
    key: string,
    expectedSha256: string,
  ): Promise<Readable> {
    assertOpaqueScope(accountScopeHmac);
    assertOpaqueKey(key);
    assertSha256(expectedSha256);
    const head = await this.options.client.headObject({ bucket: this.options.bucket, key });
    const headScope = head?.metadata["accountScopeHmac"];
    if (head?.checksumSha256 !== expectedSha256 || headScope !== accountScopeHmac) {
      throw new Error("EXPORT_OBJECT_NOT_FOUND");
    }
    const stream = await retry(this.options.retryLimit ?? 2, () =>
      this.options.client.getObject({ bucket: this.options.bucket, key }),
    );
    const verified = await digestStream(stream);
    if (verified.sha256 !== expectedSha256) throw new Error("EXPORT_INTEGRITY_MISMATCH");
    return Readable.from(verified.bytes);
  }

  async listVersions(
    accountScopeHmac: string,
    key: string,
  ): Promise<readonly ExportObjectVersion[]> {
    assertOpaqueScope(accountScopeHmac);
    assertOpaqueKey(key);
    return retry(this.options.retryLimit ?? 2, () =>
      this.options.client.listObjectVersions({ bucket: this.options.bucket, key }),
    );
  }

  async deleteEveryVersion(
    accountScopeHmac: string,
    key: string,
  ): Promise<ExportObjectDeleteResult> {
    const versions = await this.listVersions(accountScopeHmac, key);
    if (versions.length > 0) {
      await retry(this.options.retryLimit ?? 2, () =>
        this.options.client.deleteObjects({
          bucket: this.options.bucket,
          objects: versions.map((version) => ({ key: version.key, versionId: version.versionId })),
        }),
      );
    }
    const residual = await this.listVersions(accountScopeHmac, key);
    return Object.freeze({ deletedVersions: versions.length, residualVersions: residual.length });
  }
}

interface FakeStoredVersion extends ExportObjectVersion {
  readonly accountScopeHmac: string;
  readonly body: Buffer | null;
  readonly expiresAt: Date;
  readonly sha256: string;
}

class ContractExportObjectStore implements ExportObjectStore {
  private readonly versions = new Map<string, FakeStoredVersion[]>();
  private writeFailure = false;

  setWriteFailureForTest(enabled: boolean): void {
    this.writeFailure = enabled;
  }

  async putPrivateExport(input: Readonly<ExportObjectPut>): Promise<ExportObjectHandle> {
    await Promise.resolve();
    if (this.writeFailure) throw new Error("EXPORT_STORAGE_WRITE_FAILED");
    assertOpaqueScope(input.accountScopeHmac);
    assertSha256(input.expectedSha256);
    const actual = createHash("sha256").update(input.body).digest("hex");
    if (actual !== input.expectedSha256) throw new Error("EXPORT_INTEGRITY_MISMATCH");
    const key = createOpaqueKey();
    const versionId = randomUUID();
    this.versions.set(key, [
      {
        accountScopeHmac: input.accountScopeHmac,
        body: Buffer.from(input.body),
        deleteMarker: false,
        expiresAt: new Date(input.expiresAt),
        key,
        sha256: input.expectedSha256,
        versionId,
      },
    ]);
    return Object.freeze({ key, sha256: input.expectedSha256, versionId });
  }

  async addVersionForTest(
    accountScopeHmac: string,
    key: string,
    body: Buffer | null,
    expiresAt: Date,
  ): Promise<ExportObjectVersion> {
    await Promise.resolve();
    assertOpaqueScope(accountScopeHmac);
    assertOpaqueKey(key);
    const current = this.versions.get(key);
    if (current === undefined || current[0]?.accountScopeHmac !== accountScopeHmac) {
      throw new Error("EXPORT_OBJECT_NOT_FOUND");
    }
    const version: FakeStoredVersion = {
      accountScopeHmac,
      body: body === null ? null : Buffer.from(body),
      deleteMarker: body === null,
      expiresAt: new Date(expiresAt),
      key,
      sha256: body === null ? "0".repeat(64) : createHash("sha256").update(body).digest("hex"),
      versionId: randomUUID(),
    };
    current.push(version);
    return version;
  }

  async openPrivateStream(
    accountScopeHmac: string,
    key: string,
    expectedSha256: string,
  ): Promise<Readable> {
    await Promise.resolve();
    assertOpaqueScope(accountScopeHmac);
    assertOpaqueKey(key);
    assertSha256(expectedSha256);
    const latest = this.versions.get(key)?.at(-1);
    if (
      latest?.accountScopeHmac !== accountScopeHmac ||
      latest.deleteMarker ||
      latest.body === null
    ) {
      throw new Error("EXPORT_OBJECT_NOT_FOUND");
    }
    const actual = createHash("sha256").update(latest.body).digest("hex");
    if (actual !== expectedSha256) throw new Error("EXPORT_INTEGRITY_MISMATCH");
    return Readable.from(Buffer.from(latest.body));
  }

  async listVersions(
    accountScopeHmac: string,
    key: string,
  ): Promise<readonly ExportObjectVersion[]> {
    await Promise.resolve();
    assertOpaqueScope(accountScopeHmac);
    assertOpaqueKey(key);
    const current = this.versions.get(key) ?? [];
    if (current.some((version) => version.accountScopeHmac !== accountScopeHmac)) {
      throw new Error("EXPORT_OBJECT_NOT_FOUND");
    }
    return current.map(({ deleteMarker, key: versionKey, versionId }) => ({
      deleteMarker,
      key: versionKey,
      versionId,
    }));
  }

  async deleteEveryVersion(
    accountScopeHmac: string,
    key: string,
  ): Promise<ExportObjectDeleteResult> {
    const current = await this.listVersions(accountScopeHmac, key);
    this.versions.delete(key);
    return Object.freeze({ deletedVersions: current.length, residualVersions: 0 });
  }
}

export {
  ContractExportObjectStore,
  RustfsExportObjectStoreAdapter,
  createOpaqueKey,
  type ExportObjectDeleteResult,
  type ExportObjectHandle,
  type ExportObjectPut,
  type ExportObjectStore,
  type ExportObjectVersion,
  type RustfsExportObjectStoreOptions,
  type S3CompatibleExportClient,
};
