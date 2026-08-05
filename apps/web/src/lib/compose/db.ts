import Dexie, { type Table } from "dexie";

export type ComposeRetryState =
  | "editing"
  | "submitting"
  | "retryable_failure"
  | "conflict";

export type ComposePayload = Readonly<Record<string, string | null>>;

export type ComposeDraft = {
  draftId: string;
  userPartition: string;
  mode: "create";
  creationId: string;
  formPayload: ComposePayload;
  retryState: ComposeRetryState;
  updatedAt: number;
};

const DATABASE_NAME = "cashmemo_local";
const PARTITION_DOMAIN = "cashmemo.local-compose-partition.v1\0";
const PARTITION_KEY_ID = "compose-partition-hmac-v1";
const ACTIVE_CREATE_DRAFT_ID = "active-create";

type ComposeMetadata = { id: string; material: ArrayBuffer };

/** One-way local account partition. It is never sent to the API. */
export async function localPartitionTag(accountId: string): Promise<string> {
  if (accountId.length === 0)
    throw new TypeError("authenticated account required");
  const key = await crypto.subtle.importKey(
    "raw",
    await partitionKeyMaterial(),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const input = new TextEncoder().encode(`${PARTITION_DOMAIN}${accountId}`);
  const tag = await crypto.subtle.sign("HMAC", key, input);
  return Array.from(new Uint8Array(tag), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function partitionKeyMaterial(): Promise<ArrayBuffer> {
  const database = new Dexie(DATABASE_NAME);
  database.version(1).stores({
    composeDrafts: "[userPartition+draftId], userPartition, updatedAt",
  });
  database.version(2).stores({
    composeDrafts: "[userPartition+draftId], userPartition, updatedAt",
    composeMetadata: "id",
  });
  const metadata = database.table<ComposeMetadata, string>("composeMetadata");
  try {
    const existing = await metadata.get(PARTITION_KEY_ID);
    if (existing !== undefined) return existing.material;
    const generated = crypto.getRandomValues(new Uint8Array(32)).buffer;
    try {
      await metadata.add({ id: PARTITION_KEY_ID, material: generated });
      return generated;
    } catch {
      const winner = await metadata.get(PARTITION_KEY_ID);
      if (winner === undefined)
        throw new Error("Compose partition unavailable");
      return winner.material;
    }
  } finally {
    database.close();
  }
}

/** Feature-scoped durable compose storage; never a general synchronization queue. */
export class ComposeDraftDatabase extends Dexie {
  readonly composeDrafts!: Table<ComposeDraft, [string, string]>;
  readonly composeMetadata!: Table<ComposeMetadata, string>;

  constructor() {
    super(DATABASE_NAME);
    this.version(1).stores({
      composeDrafts: "[userPartition+draftId], userPartition, updatedAt",
    });
    this.version(2).stores({
      composeDrafts: "[userPartition+draftId], userPartition, updatedAt",
      composeMetadata: "id",
    });
  }

  static async deleteDatabase(): Promise<void> {
    await Dexie.delete(DATABASE_NAME);
  }

  async openCreate(
    accountId: string,
    payload: ComposePayload,
  ): Promise<ComposeDraft> {
    const userPartition = await localPartitionTag(accountId);
    const draft: ComposeDraft = {
      draftId: ACTIVE_CREATE_DRAFT_ID,
      userPartition,
      mode: "create",
      creationId: crypto.randomUUID(),
      formPayload: { ...payload },
      retryState: "editing",
      updatedAt: Date.now(),
    };
    try {
      await this.composeDrafts.add(draft);
      return draft;
    } catch (error) {
      if (!(error instanceof Dexie.ConstraintError)) throw error;
      const winner = await this.composeDrafts.get([
        userPartition,
        ACTIVE_CREATE_DRAFT_ID,
      ]);
      if (winner === undefined)
        throw new Error("Compose draft unavailable");
      return winner;
    }
  }

  async loadForAccount(
    accountId: string,
    draftId: string,
  ): Promise<ComposeDraft | undefined> {
    return this.composeDrafts.get([
      await localPartitionTag(accountId),
      draftId,
    ]);
  }

  async listForAccount(accountId: string): Promise<ComposeDraft[]> {
    return this.composeDrafts
      .where("userPartition")
      .equals(await localPartitionTag(accountId))
      .toArray();
  }

  async save(
    accountId: string,
    draftId: string,
    formPayload: ComposePayload,
    retryState: ComposeRetryState = "editing",
  ): Promise<void> {
    const key: [string, string] = [await localPartitionTag(accountId), draftId];
    const changed = await this.composeDrafts.update(key, {
      formPayload: { ...formPayload },
      retryState,
      updatedAt: Date.now(),
    });
    if (changed !== 1) throw new Error("Compose draft unavailable");
  }

  async markRetryable(accountId: string, draftId: string): Promise<void> {
    const existing = await this.loadForAccount(accountId, draftId);
    if (existing === undefined) throw new Error("Compose draft unavailable");
    await this.save(
      accountId,
      draftId,
      existing.formPayload,
      "retryable_failure",
    );
  }

  async complete(accountId: string, draftId: string): Promise<void> {
    await this.deleteOwned(accountId, draftId);
  }

  async discard(accountId: string, draftId: string): Promise<void> {
    await this.deleteOwned(accountId, draftId);
  }

  private async deleteOwned(accountId: string, draftId: string): Promise<void> {
    await this.composeDrafts.delete([
      await localPartitionTag(accountId),
      draftId,
    ]);
  }
}
