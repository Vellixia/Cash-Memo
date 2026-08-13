import { Client } from "minio";

import { createHash } from "node:crypto";

import type { S3CompatibleExportClient } from "./export-object-store.adapter.js";
import type { S3CompatibleDeletionLedgerClient } from "./deletion-suppression.adapter.js";

export interface RustfsClientOptions {
  readonly accessKey: string;
  readonly endpoint: string;
  readonly region: string;
  readonly secretKey: string;
}

interface ListedVersion {
  readonly DeleteMarker?: boolean | string;
  readonly IsDeleteMarker?: boolean | string;
  readonly VersionId?: string;
  readonly key?: string;
  readonly name?: string;
  readonly versionId?: string;
}

function mappedError(error: unknown): Error {
  const value = error as { code?: unknown; message?: unknown; statusCode?: unknown };
  const code = typeof value.code === "string" ? value.code : "";
  const status = typeof value.statusCode === "number" ? value.statusCode : 0;
  if (["PreconditionFailed", "ConditionalRequestConflict"].includes(code) || status === 412) {
    return new Error("CONDITIONAL_WRITE_EXISTS");
  }
  if (["NoSuchKey", "NotFound", "NoSuchObject"].includes(code) || status === 404) {
    return new Error("S3_COMPATIBLE_NOT_FOUND");
  }
  if (["ETIMEDOUT", "RequestTimeout", "TimeoutError"].includes(code)) {
    return new Error("S3_COMPATIBLE_TIMEOUT");
  }
  if (status === 429 || status >= 500) return new Error("S3_COMPATIBLE_UNAVAILABLE");
  return new Error("S3_COMPATIBLE_OPERATION_FAILED");
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(typeof chunk === "string" ? chunk : (chunk as Uint8Array)),
    );
  }
  return Buffer.concat(chunks);
}

function metadataValue(metadata: Readonly<Record<string, unknown>>, key: string): string {
  const value = metadata[key] ?? metadata[`x-amz-meta-${key}`];
  return typeof value === "string" ? value : "";
}

export class RustfsMinioExportClient implements S3CompatibleExportClient {
  private readonly client: Client;

  constructor(options: Readonly<RustfsClientOptions>) {
    const endpoint = new URL(options.endpoint);
    if (!(["http:", "https:"] as const).includes(endpoint.protocol as "http:" | "https:")) {
      throw new Error("RUSTFS_ENDPOINT_INVALID");
    }
    this.client = new Client({
      accessKey: options.accessKey,
      endPoint: endpoint.hostname,
      pathStyle: true,
      port:
        endpoint.port === "" ? (endpoint.protocol === "https:" ? 443 : 80) : Number(endpoint.port),
      region: options.region,
      secretKey: options.secretKey,
      useSSL: endpoint.protocol === "https:",
    });
  }

  async putObject(input: Parameters<S3CompatibleExportClient["putObject"]>[0]) {
    try {
      const result = await this.client.putObject(
        input.bucket,
        input.key,
        input.body,
        input.body.length,
        {
          "cashmemo-account-scope-hmac": input.metadata["accountScopeHmac"],
          "cashmemo-expires-at": input.metadata["expiresAt"],
          "cashmemo-sha256": input.checksumSha256,
          "Content-Type": input.contentType,
        },
      );
      if (result.versionId === null || result.versionId === "") {
        throw new Error("RUSTFS_VERSIONING_REQUIRED");
      }
      return { versionId: result.versionId };
    } catch (error) {
      if (error instanceof Error && error.message === "RUSTFS_VERSIONING_REQUIRED") throw error;
      const mapped = mappedError(error);
      if (["S3_COMPATIBLE_TIMEOUT", "S3_COMPATIBLE_UNAVAILABLE"].includes(mapped.message)) {
        throw new Error("S3_COMPATIBLE_AMBIGUOUS_RESPONSE", { cause: error });
      }
      throw mapped;
    }
  }

  async headObject(input: Parameters<S3CompatibleExportClient["headObject"]>[0]) {
    try {
      const result = await this.client.statObject(input.bucket, input.key);
      if (result.versionId === null || result.versionId === undefined || result.versionId === "") {
        throw new Error("RUSTFS_VERSIONING_REQUIRED");
      }
      const metadata = result.metaData as Readonly<Record<string, unknown>>;
      return {
        checksumSha256: metadataValue(metadata, "cashmemo-sha256"),
        metadata: {
          accountScopeHmac: metadataValue(metadata, "cashmemo-account-scope-hmac"),
          expiresAt: metadataValue(metadata, "cashmemo-expires-at"),
        },
        versionId: result.versionId,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "RUSTFS_VERSIONING_REQUIRED") throw error;
      const mapped = mappedError(error);
      if (mapped.message === "S3_COMPATIBLE_NOT_FOUND") return null;
      throw mapped;
    }
  }

  async getObject(input: Parameters<S3CompatibleExportClient["getObject"]>[0]) {
    try {
      return await this.client.getObject(input.bucket, input.key);
    } catch (error) {
      throw mappedError(error);
    }
  }

  async listObjectVersions(input: Parameters<S3CompatibleExportClient["listObjectVersions"]>[0]) {
    const stream = this.client.listObjects(input.bucket, input.key, true, { IncludeVersion: true });
    const versions: { deleteMarker: boolean; key: string; versionId: string }[] = [];
    return new Promise<readonly { deleteMarker: boolean; key: string; versionId: string }[]>(
      (resolve, reject) => {
        stream.on("data", (raw) => {
          const value = raw as ListedVersion;
          const key = value.name ?? value.key;
          const versionId = value.versionId ?? value.VersionId;
          if (key === input.key && versionId !== undefined && versionId !== "") {
            versions.push({
              deleteMarker:
                value.DeleteMarker === true ||
                value.DeleteMarker === "true" ||
                value.IsDeleteMarker === true ||
                value.IsDeleteMarker === "true",
              key,
              versionId,
            });
          }
        });
        stream.on("error", (error) => {
          reject(mappedError(error));
        });
        stream.on("end", () => {
          resolve(Object.freeze(versions));
        });
      },
    );
  }

  async deleteObjects(input: Parameters<S3CompatibleExportClient["deleteObjects"]>[0]) {
    try {
      const results = await this.client.removeObjects(
        input.bucket,
        input.objects.map((item) => ({ name: item.key, versionId: item.versionId })),
      );
      if (results.some((result) => result?.Error !== undefined)) {
        throw new Error("S3_COMPATIBLE_DELETE_INCOMPLETE");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "S3_COMPATIBLE_DELETE_INCOMPLETE") {
        throw error;
      }
      throw mappedError(error);
    }
  }
}

export class RustfsMinioDeletionLedgerClient implements S3CompatibleDeletionLedgerClient {
  private readonly client: Client;

  constructor(
    options: Readonly<RustfsClientOptions> & { readonly encryptedStoragePolicyVerified: boolean },
  ) {
    if (!options.encryptedStoragePolicyVerified) {
      throw new Error("RUSTFS_ENCRYPTED_STORAGE_POLICY_REQUIRED");
    }
    const endpoint = new URL(options.endpoint);
    this.client = new Client({
      accessKey: options.accessKey,
      endPoint: endpoint.hostname,
      pathStyle: true,
      port:
        endpoint.port === "" ? (endpoint.protocol === "https:" ? 443 : 80) : Number(endpoint.port),
      region: options.region,
      secretKey: options.secretKey,
      useSSL: endpoint.protocol === "https:",
    });
  }

  async putObject(input: Parameters<S3CompatibleDeletionLedgerClient["putObject"]>[0]) {
    try {
      const result = await this.client.putObject(
        input.bucket,
        input.key,
        input.body,
        input.body.length,
        {
          "cashmemo-sha256": input.checksumSha256,
          "Content-Type": input.contentType,
          "If-None-Match": input.ifNoneMatch,
        },
      );
      if (result.versionId === null || result.versionId === "") {
        throw new Error("RUSTFS_VERSIONING_REQUIRED");
      }
      return { versionId: result.versionId };
    } catch (error) {
      if (error instanceof Error && error.message === "RUSTFS_VERSIONING_REQUIRED") throw error;
      const mapped = mappedError(error);
      if (["S3_COMPATIBLE_TIMEOUT", "S3_COMPATIBLE_UNAVAILABLE"].includes(mapped.message)) {
        throw new Error("S3_COMPATIBLE_AMBIGUOUS_RESPONSE", { cause: error });
      }
      throw mapped;
    }
  }

  async getObject(input: Parameters<S3CompatibleDeletionLedgerClient["getObject"]>[0]) {
    try {
      const stat = await this.client.statObject(input.bucket, input.key);
      if (stat.versionId === null || stat.versionId === undefined || stat.versionId === "") {
        throw new Error("RUSTFS_VERSIONING_REQUIRED");
      }
      const body = await readAll(await this.client.getObject(input.bucket, input.key));
      const metadata = stat.metaData as Readonly<Record<string, unknown>>;
      return {
        body,
        checksumSha256: metadataValue(metadata, "cashmemo-sha256"),
        encryptedAtRest: true,
        etag: stat.etag || createHash("sha256").update(body).digest("hex"),
        versionId: stat.versionId,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "RUSTFS_VERSIONING_REQUIRED") throw error;
      const mapped = mappedError(error);
      if (mapped.message === "S3_COMPATIBLE_NOT_FOUND") return null;
      throw mapped;
    }
  }

  async deleteObject(input: Parameters<S3CompatibleDeletionLedgerClient["deleteObject"]>[0]) {
    try {
      await this.client.removeObject(input.bucket, input.key, {
        versionId: input.expectedVersionId,
      });
    } catch (error) {
      throw mappedError(error);
    }
  }
}
