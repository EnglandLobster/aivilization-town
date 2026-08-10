type MaybePromise<TValue> = TValue | Promise<TValue>;

export type SocietyDirectoryQueryRequest = {
  readonly simulationId: string;
};

export type SocietyAgentLookupRequest = SocietyDirectoryQueryRequest & {
  readonly agentId: string;
};

export type SocietyDirectoryPort<TDirectory, TAgent> = {
  readonly getDirectory: (request: SocietyDirectoryQueryRequest) => MaybePromise<TDirectory>;
  readonly getAgent: (request: SocietyAgentLookupRequest) => MaybePromise<TAgent | undefined>;
};

export type SocietyDirectoryApiService<TDirectory, TAgent> = {
  readonly getSocietyDirectory: (request: SocietyDirectoryQueryRequest) => Promise<TDirectory>;
  readonly getSocietyAgent: (request: SocietyAgentLookupRequest) => Promise<TAgent | undefined>;
};

export function createSocietyDirectoryApiService<TDirectory, TAgent>(input: {
  readonly directory: SocietyDirectoryPort<TDirectory, TAgent>;
}): SocietyDirectoryApiService<TDirectory, TAgent> {
  return {
    getSocietyDirectory: async (request) =>
      input.directory.getDirectory({
        simulationId: normalizeId(request.simulationId, 'simulationId'),
      }),
    getSocietyAgent: async (request) =>
      input.directory.getAgent({
        simulationId: normalizeId(request.simulationId, 'simulationId'),
        agentId: normalizeId(request.agentId, 'agentId'),
      }),
  };
}

function normalizeId(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty`);
  return normalized;
}
