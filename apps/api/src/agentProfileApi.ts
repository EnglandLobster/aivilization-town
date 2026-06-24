type MaybePromise<TValue> = TValue | Promise<TValue>;

export type AgentProfileLookupRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly agentId: string;
};

export type AgentProfileQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly agentId?: string;
  readonly limit?: number;
};

export type AgentProfileQueryPort<TProfile> = {
  readonly getProfile: (request: AgentProfileLookupRequest) => MaybePromise<TProfile | undefined>;
  readonly queryProfiles: (request: AgentProfileQueryRequest) => MaybePromise<readonly TProfile[]>;
};

export type AgentProfileApiService<TProfile> = {
  readonly getAgentProfile: (request: AgentProfileLookupRequest) => Promise<TProfile | undefined>;
  readonly queryAgentProfiles: (request: AgentProfileQueryRequest) => Promise<readonly TProfile[]>;
};

export function createAgentProfileApiService<TProfile>(input: {
  readonly profiles: AgentProfileQueryPort<TProfile>;
}): AgentProfileApiService<TProfile> {
  return {
    getAgentProfile: async (request) => input.profiles.getProfile(normalizeLookup(request)),
    queryAgentProfiles: async (request) => input.profiles.queryProfiles(normalizeQuery(request)),
  };
}

function normalizeLookup(request: AgentProfileLookupRequest): AgentProfileLookupRequest {
  return {
    simulationId: normalizeNonEmpty(request.simulationId, 'simulationId'),
    partitionKey: normalizeNonEmpty(request.partitionKey, 'partitionKey'),
    agentId: normalizeNonEmpty(request.agentId, 'agentId'),
  };
}

function normalizeQuery(request: AgentProfileQueryRequest): AgentProfileQueryRequest {
  if (request.limit !== undefined) {
    assertPositiveInteger(request.limit, 'limit');
  }

  return {
    simulationId: normalizeNonEmpty(request.simulationId, 'simulationId'),
    partitionKey: normalizeNonEmpty(request.partitionKey, 'partitionKey'),
    ...(request.agentId === undefined
      ? {}
      : { agentId: normalizeNonEmpty(request.agentId, 'agentId') }),
    ...(request.limit === undefined ? {} : { limit: request.limit }),
  };
}

function normalizeNonEmpty(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return value;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
