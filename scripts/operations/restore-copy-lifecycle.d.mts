export class RestoreCopyLifecycle {
  createAndRegister(): void;
  tagAndConfirmInventory(): void;
  forceNetworkIsolation(): void;
  markReconciled(result: string): void;
  verify(): void;
  releaseControlled(): void;
  destroyAndVerify(): void;
  cleanupBlocker(): boolean;
  contentSafeStatus(): Readonly<Record<string, boolean | string>>;
}
