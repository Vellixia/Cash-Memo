const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const SAFE_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u;

export class TestHarnessInvariantError extends Error {
  constructor(readonly reason: string) {
    super(`Test harness invariant failed: ${reason}`);
    this.name = "TestHarnessInvariantError";
  }
}

export interface TwoAccountFixture {
  readonly otherAccountId: string;
  readonly ownerAccountId: string;
  readonly resourceId: string;
}

export interface IsolationAttemptAllowed {
  readonly outcome: "allowed";
}

export interface IsolationAttemptDenied {
  readonly code: "NOT_FOUND" | "FORBIDDEN";
  readonly outcome: "denied";
}

export type IsolationAttemptResult = IsolationAttemptAllowed | IsolationAttemptDenied;

export interface IsolationOperation {
  readonly execute: (actorAccountId: string, resourceId: string) => Promise<IsolationAttemptResult>;
  readonly name: string;
}

export interface IsolationVerification {
  readonly operation: string;
  readonly otherOutcome: "denied";
  readonly ownerOutcome: "allowed";
}

export async function verifyTwoAccountIsolation(
  fixture: TwoAccountFixture,
  operations: readonly IsolationOperation[],
): Promise<readonly IsolationVerification[]> {
  for (const value of [fixture.ownerAccountId, fixture.otherAccountId, fixture.resourceId]) {
    if (!UUID_PATTERN.test(value)) throw new TestHarnessInvariantError("fixture_uuid_invalid");
  }
  if (fixture.ownerAccountId === fixture.otherAccountId) {
    throw new TestHarnessInvariantError("accounts_not_distinct");
  }
  if (operations.length === 0) throw new TestHarnessInvariantError("operations_empty");

  const results: IsolationVerification[] = [];
  for (const operation of operations) {
    if (!SAFE_NAME_PATTERN.test(operation.name)) {
      throw new TestHarnessInvariantError("operation_name_invalid");
    }
    const owner = await operation.execute(fixture.ownerAccountId, fixture.resourceId);
    if (owner.outcome !== "allowed") {
      throw new TestHarnessInvariantError("owner_denied");
    }
    const other = await operation.execute(fixture.otherAccountId, fixture.resourceId);
    if (other.outcome !== "denied") {
      throw new TestHarnessInvariantError("cross_account_allowed");
    }
    results.push({ operation: operation.name, otherOutcome: "denied", ownerOutcome: "allowed" });
  }
  return Object.freeze(results);
}

export type FaultAction =
  | { readonly kind: "pass" }
  | { readonly code: string; readonly kind: "fail_before" }
  | { readonly code: string; readonly kind: "lose_response" };

export class InjectedFaultError extends Error {
  constructor(readonly code: string) {
    super(`Injected fault: ${code}`);
    this.name = "InjectedFaultError";
  }
}

export class LostResponseError extends Error {
  constructor(readonly code: string) {
    super(`Injected response loss: ${code}`);
    this.name = "LostResponseError";
  }
}

export interface FaultCallRecord {
  readonly action: FaultAction["kind"];
  readonly callNumber: number;
  readonly targetCompleted: boolean;
}

export class FaultInjectingProxy<TRequest, TResponse> {
  readonly calls: FaultCallRecord[] = [];
  private callNumber = 0;
  private readonly plan: FaultAction[];
  private readonly target: (request: TRequest) => Promise<TResponse>;

  constructor(target: (request: TRequest) => Promise<TResponse>, plan: readonly FaultAction[]) {
    this.target = target;
    this.plan = [...plan];
  }

  async invoke(request: TRequest): Promise<TResponse> {
    this.callNumber += 1;
    const action = this.plan.shift() ?? { kind: "pass" };
    if (action.kind !== "pass" && !SAFE_CODE_PATTERN.test(action.code)) {
      throw new TestHarnessInvariantError("fault_code_invalid");
    }
    if (action.kind === "fail_before") {
      this.calls.push({ action: action.kind, callNumber: this.callNumber, targetCompleted: false });
      throw new InjectedFaultError(action.code);
    }

    const response = await this.target(request);
    this.calls.push({ action: action.kind, callNumber: this.callNumber, targetCompleted: true });
    if (action.kind === "lose_response") throw new LostResponseError(action.code);
    return response;
  }
}

export interface DuplicateDeliveryOptions<TRequest, TResponse> {
  readonly deliveries: number;
  readonly handler: (request: TRequest, deliveryNumber: number) => Promise<TResponse>;
  readonly mode: "concurrent" | "sequential";
  readonly request: TRequest;
}

export async function deliverDuplicates<TRequest, TResponse>(
  options: DuplicateDeliveryOptions<TRequest, TResponse>,
): Promise<readonly TResponse[]> {
  if (
    !Number.isSafeInteger(options.deliveries) ||
    options.deliveries < 2 ||
    options.deliveries > 100
  ) {
    throw new TestHarnessInvariantError("delivery_count_invalid");
  }
  const deliveryNumbers = Array.from({ length: options.deliveries }, (_, index) => index + 1);
  if (options.mode === "concurrent") {
    return Promise.all(
      deliveryNumbers.map((deliveryNumber) => options.handler(options.request, deliveryNumber)),
    );
  }
  const results: TResponse[] = [];
  for (const deliveryNumber of deliveryNumbers) {
    results.push(await options.handler(options.request, deliveryNumber));
  }
  return results;
}

export class ProviderCaptureHarness<TRequest extends object> {
  private readonly allowedKeys: ReadonlySet<keyof TRequest>;
  private captures: TRequest[] = [];

  constructor(allowedKeys: readonly (keyof TRequest)[]) {
    if (allowedKeys.length === 0) throw new TestHarnessInvariantError("capture_allowlist_empty");
    this.allowedKeys = new Set(allowedKeys);
  }

  capture(request: TRequest): void {
    if (Object.getPrototypeOf(request) !== Object.prototype || Array.isArray(request)) {
      throw new TestHarnessInvariantError("capture_request_not_plain");
    }
    const ownKeys = Reflect.ownKeys(request);
    if (
      ownKeys.some(
        (key) => typeof key !== "string" || !this.allowedKeys.has(key as keyof TRequest),
      ) ||
      Object.keys(request).length !== ownKeys.length
    ) {
      throw new TestHarnessInvariantError("capture_non_allowlisted_key");
    }
    this.captures.push(structuredClone(request));
  }

  snapshot(): readonly TRequest[] {
    return Object.freeze(structuredClone(this.captures));
  }

  drain(): readonly TRequest[] {
    const captured = this.snapshot();
    this.captures = [];
    return captured;
  }
}
