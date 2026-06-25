type MaybePromise<TValue> = TValue | Promise<TValue>;

export type SocialReflectionObservationLookupRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly observationId: string;
};

export type SocialReflectionObservationQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly observationId?: string;
  readonly agentId?: string;
  readonly targetAgentId?: string;
  readonly fromGeneratedAt?: number;
  readonly toGeneratedAt?: number;
  readonly limit?: number;
};

export type SocialReflectionObservationQueryPort<TObservation> = {
  readonly getObservation: (
    request: SocialReflectionObservationLookupRequest,
  ) => MaybePromise<TObservation | undefined>;
  readonly queryObservations: (
    request: SocialReflectionObservationQueryRequest,
  ) => MaybePromise<readonly TObservation[]>;
};

export type SocialReflectionObservationApiService<TObservation> = {
  readonly getSocialReflectionObservation: (
    request: SocialReflectionObservationLookupRequest,
  ) => Promise<TObservation | undefined>;
  readonly querySocialReflectionObservations: (
    request: SocialReflectionObservationQueryRequest,
  ) => Promise<readonly TObservation[]>;
};

export function createSocialReflectionObservationApiService<TObservation>(input: {
  readonly observations: SocialReflectionObservationQueryPort<TObservation>;
}): SocialReflectionObservationApiService<TObservation> {
  return {
    getSocialReflectionObservation: async (request) =>
      input.observations.getObservation(normalizeLookup(request)),
    querySocialReflectionObservations: async (request) =>
      input.observations.queryObservations(normalizeQuery(request)),
  };
}

function normalizeLookup(
  request: SocialReflectionObservationLookupRequest,
): SocialReflectionObservationLookupRequest {
  return {
    simulationId: normalizeNonEmpty(request.simulationId, 'simulationId'),
    partitionKey: normalizeNonEmpty(request.partitionKey, 'partitionKey'),
    observationId: normalizeNonEmpty(request.observationId, 'observationId'),
  };
}

function normalizeQuery(
  request: SocialReflectionObservationQueryRequest,
): SocialReflectionObservationQueryRequest {
  if (request.fromGeneratedAt !== undefined) {
    assertFinite(request.fromGeneratedAt, 'fromGeneratedAt');
  }
  if (request.toGeneratedAt !== undefined) {
    assertFinite(request.toGeneratedAt, 'toGeneratedAt');
  }
  if (request.limit !== undefined) {
    assertPositiveInteger(request.limit, 'limit');
  }

  return {
    simulationId: normalizeNonEmpty(request.simulationId, 'simulationId'),
    partitionKey: normalizeNonEmpty(request.partitionKey, 'partitionKey'),
    ...(request.observationId === undefined
      ? {}
      : { observationId: normalizeNonEmpty(request.observationId, 'observationId') }),
    ...(request.agentId === undefined
      ? {}
      : { agentId: normalizeNonEmpty(request.agentId, 'agentId') }),
    ...(request.targetAgentId === undefined
      ? {}
      : { targetAgentId: normalizeNonEmpty(request.targetAgentId, 'targetAgentId') }),
    ...(request.fromGeneratedAt === undefined ? {} : { fromGeneratedAt: request.fromGeneratedAt }),
    ...(request.toGeneratedAt === undefined ? {} : { toGeneratedAt: request.toGeneratedAt }),
    ...(request.limit === undefined ? {} : { limit: request.limit }),
  };
}

function normalizeNonEmpty(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return value;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
