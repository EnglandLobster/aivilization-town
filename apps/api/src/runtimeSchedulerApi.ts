type MaybePromise<TValue> = TValue | Promise<TValue>;

export type RuntimeSchedulerControlPort<TStatus, TDecision> = {
  readonly getStatus: () => MaybePromise<TStatus>;
  readonly start: () => MaybePromise<TStatus>;
  readonly stop: () => MaybePromise<TStatus>;
  readonly runOnce: () => MaybePromise<TDecision>;
};

export type RuntimeSchedulerApiService<TStatus, TDecision> = {
  readonly getRuntimeSchedulerStatus: () => Promise<TStatus>;
  readonly startRuntimeScheduler: () => Promise<TStatus>;
  readonly stopRuntimeScheduler: () => Promise<TStatus>;
  readonly runRuntimeSchedulerOnce: () => Promise<TDecision>;
};

export function createRuntimeSchedulerApiService<TStatus, TDecision>(input: {
  readonly control: RuntimeSchedulerControlPort<TStatus, TDecision>;
}): RuntimeSchedulerApiService<TStatus, TDecision> {
  return {
    getRuntimeSchedulerStatus: async () => input.control.getStatus(),
    startRuntimeScheduler: async () => input.control.start(),
    stopRuntimeScheduler: async () => input.control.stop(),
    runRuntimeSchedulerOnce: async () => input.control.runOnce(),
  };
}
