type MaybePromise<TValue> = TValue | Promise<TValue>;

export type BranchPlanQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly planId?: string;
  readonly agentId?: string;
  readonly fromCreatedAt?: number;
  readonly toCreatedAt?: number;
  readonly fromUpdatedAt?: number;
  readonly toUpdatedAt?: number;
  readonly limit?: number;
};

export type BranchPlanQueryPort<TPlan> = {
  readonly queryPlans: (request: BranchPlanQueryRequest) => MaybePromise<readonly TPlan[]>;
};

export type BranchPlanApiService<TPlan> = {
  readonly queryBranchPlans: (request: BranchPlanQueryRequest) => Promise<readonly TPlan[]>;
};

export function createBranchPlanApiService<TPlan>(input: {
  readonly plans: BranchPlanQueryPort<TPlan>;
}): BranchPlanApiService<TPlan> {
  return {
    queryBranchPlans: async (request) => input.plans.queryPlans(normalizeQuery(request)),
  };
}

function normalizeQuery(request: BranchPlanQueryRequest): BranchPlanQueryRequest {
  for (const [name, value] of [
    ['fromCreatedAt', request.fromCreatedAt],
    ['toCreatedAt', request.toCreatedAt],
    ['fromUpdatedAt', request.fromUpdatedAt],
    ['toUpdatedAt', request.toUpdatedAt],
  ] as const) {
    if (value !== undefined) {
      assertFinite(value, name);
    }
  }
  if (request.limit !== undefined) {
    assertPositiveInteger(request.limit, 'limit');
  }

  return {
    simulationId: normalizeNonEmpty(request.simulationId, 'simulationId'),
    partitionKey: normalizeNonEmpty(request.partitionKey, 'partitionKey'),
    ...(request.planId === undefined
      ? {}
      : { planId: normalizeNonEmpty(request.planId, 'planId') }),
    ...(request.agentId === undefined
      ? {}
      : { agentId: normalizeNonEmpty(request.agentId, 'agentId') }),
    ...(request.fromCreatedAt === undefined ? {} : { fromCreatedAt: request.fromCreatedAt }),
    ...(request.toCreatedAt === undefined ? {} : { toCreatedAt: request.toCreatedAt }),
    ...(request.fromUpdatedAt === undefined ? {} : { fromUpdatedAt: request.fromUpdatedAt }),
    ...(request.toUpdatedAt === undefined ? {} : { toUpdatedAt: request.toUpdatedAt }),
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
