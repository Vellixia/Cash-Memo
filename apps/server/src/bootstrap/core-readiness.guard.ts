export type CoreReadinessState =
  | "auth_unavailable"
  | "core_dependency_unavailable"
  | "persistence_unavailable"
  | "ready"
  | "schema_incompatible";

export class CoreReadinessError extends Error {
  readonly retryable: boolean;
  readonly statusCode = 503;

  constructor(readonly state: Exclude<CoreReadinessState, "ready">) {
    super("CORE_OPERATION_UNAVAILABLE");
    this.name = "CoreReadinessError";
    this.retryable = state !== "schema_incompatible";
  }
}

export interface CoreReadinessSnapshot {
  readonly auth: boolean;
  readonly persistence: boolean;
  readonly requiredDependencies: boolean;
  readonly schemaCompatible: boolean;
}

export function coreReadiness(snapshot: CoreReadinessSnapshot): CoreReadinessState {
  if (!snapshot.auth) return "auth_unavailable";
  if (!snapshot.persistence) return "persistence_unavailable";
  if (!snapshot.schemaCompatible) return "schema_incompatible";
  if (!snapshot.requiredDependencies) return "core_dependency_unavailable";
  return "ready";
}

export class CoreReadinessGuard {
  constructor(private readonly probe: () => Promise<CoreReadinessSnapshot>) {}

  async requireAuthority(): Promise<void> {
    const state = coreReadiness(await this.probe());
    if (state !== "ready") throw new CoreReadinessError(state);
  }

  async executeAuthoritative<T>(operation: () => Promise<T>): Promise<T> {
    await this.requireAuthority();
    return operation();
  }
}
