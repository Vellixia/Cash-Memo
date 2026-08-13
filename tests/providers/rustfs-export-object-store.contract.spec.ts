import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  RustfsExportObjectStoreAdapter,
  type ExportObjectVersion,
  type S3CompatibleExportClient,
} from "../../apps/server/src/adapters/rustfs/export-object-store.adapter.js";

class Client implements S3CompatibleExportClient {
  body = Buffer.alloc(0);
  checksum = "";
  key = "";
  metadata: Readonly<Record<string, string>> = {};
  versions: ExportObjectVersion[] = [];
  putAttempts = 0;
  putFault: "ambiguous_after_write" | "none" | "timeout_once" = "none";

  async putObject(input: Parameters<S3CompatibleExportClient["putObject"]>[0]) {
    await Promise.resolve();
    this.putAttempts += 1;
    if (this.putFault === "timeout_once" && this.putAttempts === 1) {
      throw new Error("S3_COMPATIBLE_TIMEOUT");
    }
    this.body = Buffer.from(input.body);
    this.checksum = input.checksumSha256;
    this.key = input.key;
    this.metadata = input.metadata;
    this.versions = [{ deleteMarker: false, key: input.key, versionId: "version-1" }];
    if (this.putFault === "ambiguous_after_write") {
      throw new Error("S3_COMPATIBLE_AMBIGUOUS_RESPONSE");
    }
    return { versionId: "version-1" };
  }

  async headObject(input: Parameters<S3CompatibleExportClient["headObject"]>[0]) {
    await Promise.resolve();
    if (input.key !== this.key) return null;
    return { checksumSha256: this.checksum, metadata: this.metadata, versionId: "version-1" };
  }

  async getObject() {
    await Promise.resolve();
    return Readable.from(this.body);
  }

  async listObjectVersions() {
    await Promise.resolve();
    return [...this.versions];
  }

  async deleteObjects(input: Parameters<S3CompatibleExportClient["deleteObjects"]>[0]) {
    await Promise.resolve();
    const deleted = new Set(input.objects.map((item) => item.versionId));
    this.versions = this.versions.filter((item) => !deleted.has(item.versionId));
  }
}

const scope = createHash("sha256").update("synthetic-account").digest("hex");
const body = Buffer.from("synthetic-export-body", "utf8");
const sha256 = createHash("sha256").update(body).digest("hex");

function fixture(client = new Client()) {
  return {
    client,
    store: new RustfsExportObjectStoreAdapter({ bucket: "synthetic-exports", client }),
  };
}

describe("RustFS Primary export adapter contract", () => {
  it("writes opaque private metadata, heads, reads, and verifies checksum", async () => {
    const { client, store } = fixture();
    const handle = await store.putPrivateExport({
      accountScopeHmac: scope,
      body,
      expectedSha256: sha256,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(handle.key).toMatch(/^exports\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.zip$/u);
    expect(client.metadata).toEqual({
      accountScopeHmac: scope,
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const stream = await store.openPrivateStream(scope, handle.key, sha256);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    expect(Buffer.concat(chunks)).toEqual(body);
  });

  it("retries bounded transient failures", async () => {
    const client = new Client();
    client.putFault = "timeout_once";
    await expect(
      fixture(client).store.putPrivateExport({
        accountScopeHmac: scope,
        body,
        expectedSha256: sha256,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ versionId: "version-1" });
    expect(client.putAttempts).toBe(2);
  });

  it("reconciles a lost successful response only through matching head state", async () => {
    const client = new Client();
    client.putFault = "ambiguous_after_write";
    await expect(
      fixture(client).store.putPrivateExport({
        accountScopeHmac: scope,
        body,
        expectedSha256: sha256,
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ versionId: "version-1" });
  });

  it("deletes every version and verifies zero residual versions", async () => {
    const { client, store } = fixture();
    const handle = await store.putPrivateExport({
      accountScopeHmac: scope,
      body,
      expectedSha256: sha256,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    client.versions.push({ deleteMarker: true, key: handle.key, versionId: "marker-2" });
    await expect(store.deleteEveryVersion(scope, handle.key)).resolves.toEqual({
      deletedVersions: 2,
      residualVersions: 0,
    });
  });
});
