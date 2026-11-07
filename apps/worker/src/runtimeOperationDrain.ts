/** Infrastructure lifecycle only: stop admission and await every already-admitted operation. */
export class RuntimeOperationDrain {
  private readonly active = new Set<Promise<unknown>>();
  private closing = false;
  private closedPromise: Promise<void> | undefined;

  get closed() {
    return this.closing;
  }
  get inFlight() {
    return this.active.size > 0;
  }
  assertOpen(): void {
    if (this.closing) throw new Error('runtime-host-shutdown');
  }
  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('runtime-host-shutdown'));
    // Register before invoking user code, including synchronous/reentrant callbacks.
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.active.add(result);
    void result.then(
      () => this.active.delete(result),
      () => this.active.delete(result),
    );
    try {
      void operation().then(resolveResult, rejectResult);
    } catch (error) {
      rejectResult(error);
    }
    return result;
  }
  close(): Promise<void> {
    this.closing = true;
    this.closedPromise ??= Promise.allSettled([...this.active]).then((outcomes) => {
      const failures = outcomes
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason as unknown);
      if (failures.length) throw new AggregateError(failures, 'runtime-host-shutdown-failed');
    });
    return this.closedPromise;
  }
}
