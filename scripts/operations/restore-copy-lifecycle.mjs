class RestoreCopyLifecycle {
  #state = "new";
  #registered = false;
  #inventoryVisible = false;
  #networkIsolated = false;

  createAndRegister() {
    if (this.#state !== "new") throw new Error("RESTORE_COPY_INVALID_TRANSITION");
    this.#registered = true;
    this.#state = "registered";
  }

  tagAndConfirmInventory() {
    if (!this.#registered || this.#state !== "registered")
      throw new Error("RESTORE_COPY_UNREGISTERED");
    this.#inventoryVisible = true;
    this.#state = "inventory_visible";
  }

  forceNetworkIsolation() {
    if (!this.#inventoryVisible || this.#state !== "inventory_visible")
      throw new Error("RESTORE_COPY_NOT_INVENTORIED");
    this.#networkIsolated = true;
    this.#state = "isolated";
  }

  markReconciled(result) {
    if (!this.#networkIsolated || this.#state !== "isolated")
      throw new Error("RESTORE_COPY_NOT_ISOLATED");
    if (result !== "PASS") throw new Error("RESTORE_COPY_RECONCILIATION_BLOCKED");
    this.#state = "reconciled";
  }

  verify() {
    if (this.#state !== "reconciled") throw new Error("RESTORE_COPY_NOT_RECONCILED");
    this.#state = "verified";
  }

  releaseControlled() {
    if (this.#state !== "verified") throw new Error("RESTORE_COPY_RELEASE_BLOCKED");
    this.#state = "released_controlled";
  }

  destroyAndVerify() {
    if (!this.#registered || this.#state === "destroyed_verified")
      throw new Error("RESTORE_COPY_INVALID_TRANSITION");
    this.#state = "destroyed_verified";
    this.#inventoryVisible = false;
  }

  cleanupBlocker() {
    return this.#state !== "destroyed_verified";
  }

  contentSafeStatus() {
    return Object.freeze({
      cleanupBlocker: this.cleanupBlocker(),
      inventoryVisible: this.#inventoryVisible,
      networkIsolated: this.#networkIsolated,
      registered: this.#registered,
      state: this.#state,
    });
  }
}

export { RestoreCopyLifecycle };
