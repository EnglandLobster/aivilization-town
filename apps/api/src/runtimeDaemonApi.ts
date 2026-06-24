type MaybePromise<TValue> = TValue | Promise<TValue>;

export type RuntimeDaemonControlPort<TStatus> = {
  readonly getStatus: () => MaybePromise<TStatus>;
};

export type RuntimeDaemonApiService<TStatus> = {
  readonly getRuntimeDaemonStatus: () => Promise<TStatus>;
};

export function createRuntimeDaemonApiService<TStatus>(input: {
  readonly control: RuntimeDaemonControlPort<TStatus>;
}): RuntimeDaemonApiService<TStatus> {
  return {
    getRuntimeDaemonStatus: async () => input.control.getStatus(),
  };
}
