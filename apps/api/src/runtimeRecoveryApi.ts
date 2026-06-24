type MaybePromise<TValue> = TValue | Promise<TValue>;

export type RuntimeRecoveryControlPort<TStatus, TReport> = {
  readonly getStatus: () => MaybePromise<TStatus>;
  readonly start: () => MaybePromise<TStatus>;
  readonly stop: () => MaybePromise<TStatus>;
  readonly runOnce: () => MaybePromise<TReport>;
};

export type RuntimeRecoveryApiService<TStatus, TReport> = {
  readonly getRuntimeRecoveryStatus: () => Promise<TStatus>;
  readonly startRuntimeRecovery: () => Promise<TStatus>;
  readonly stopRuntimeRecovery: () => Promise<TStatus>;
  readonly runRuntimeRecoveryOnce: () => Promise<TReport>;
};

export function createRuntimeRecoveryApiService<TStatus, TReport>(input: {
  readonly control: RuntimeRecoveryControlPort<TStatus, TReport>;
}): RuntimeRecoveryApiService<TStatus, TReport> {
  return {
    getRuntimeRecoveryStatus: async () => input.control.getStatus(),
    startRuntimeRecovery: async () => input.control.start(),
    stopRuntimeRecovery: async () => input.control.stop(),
    runRuntimeRecoveryOnce: async () => input.control.runOnce(),
  };
}
