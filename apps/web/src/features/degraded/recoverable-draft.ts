export interface RecoverableDraft {
  readonly authoritative: false;
  readonly expiresAt: string;
  readonly idempotencyKey: string;
  readonly sourceText: string;
  readonly status: "editing" | "unsaved" | "uncertain";
  readonly updatedAt: string;
}

export interface DraftStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

const DATABASE_NAME = "cashmemo-recoverable-drafts";
const STORE_NAME = "drafts";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener(
      "success",
      () => {
        resolve(request.result);
      },
      { once: true },
    );
    request.addEventListener(
      "error",
      () => {
        reject(new Error("DRAFT_STORAGE_UNAVAILABLE"));
      },
      { once: true },
    );
  });
}

export class IndexedDbDraftStorage implements DraftStorage {
  private database(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") throw new Error("DRAFT_STORAGE_UNAVAILABLE");
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      },
      { once: true },
    );
    return requestResult(request);
  }

  async getItem(key: string): Promise<string | null> {
    const database = await this.database();
    try {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(key) as IDBRequest<unknown>;
      const value = await requestResult(request);
      return typeof value === "string" ? value : null;
    } finally {
      database.close();
    }
  }

  async removeItem(key: string): Promise<void> {
    const database = await this.database();
    try {
      await requestResult(
        database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key),
      );
    } finally {
      database.close();
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const database = await this.database();
    try {
      await requestResult(
        database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(value, key),
      );
    } finally {
      database.close();
    }
  }
}

export class RecoverableDraftStore {
  private readonly key: string;

  constructor(
    private readonly storage: DraftStorage,
    accountScope: string,
  ) {
    this.key = `cashmemo.recoverable-draft.v1.${accountScope}`;
  }

  async load(now = new Date()): Promise<RecoverableDraft | null> {
    try {
      const raw = await this.storage.getItem(this.key);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as Partial<RecoverableDraft>;
      if (
        parsed.authoritative !== false ||
        typeof parsed.expiresAt !== "string" ||
        typeof parsed.idempotencyKey !== "string" ||
        typeof parsed.sourceText !== "string" ||
        !["editing", "uncertain", "unsaved"].includes(String(parsed.status)) ||
        typeof parsed.updatedAt !== "string"
      ) {
        return null;
      }
      const expiresAt = new Date(parsed.expiresAt).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
        await this.storage.removeItem(this.key);
        return null;
      }
      return Object.freeze(parsed as RecoverableDraft);
    } catch {
      return null;
    }
  }

  async save(
    input: {
      readonly idempotencyKey: string;
      readonly sourceText: string;
      readonly status: RecoverableDraft["status"];
    },
    now = new Date(),
  ): Promise<boolean> {
    const draft: RecoverableDraft = Object.freeze({
      authoritative: false,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      idempotencyKey: input.idempotencyKey,
      sourceText: input.sourceText,
      status: input.status,
      updatedAt: now.toISOString(),
    });
    try {
      await this.storage.setItem(this.key, JSON.stringify(draft));
      return true;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.storage.removeItem(this.key);
    } catch {
      // Storage denial leaves no claim of authoritative persistence.
    }
  }
}
