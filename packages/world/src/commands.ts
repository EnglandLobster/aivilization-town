export type AgentEatPayload = {
  readonly commodityName: string;
  readonly quantity: number;
};

export type AgentStudyPayload = {
  readonly durationSeconds: number;
  readonly educationRatePerSecond: number;
};

export type AgentWorkPayload = {
  readonly occupationName: string;
  readonly laborSeconds: number;
};

export function assertAgentEatPayload(payload: unknown): AgentEatPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentEat payload must be an object');
  }
  const commodityName = payload['commodityName'];
  const quantity = payload['quantity'];
  if (typeof commodityName !== 'string' || commodityName.trim().length === 0) {
    throw new Error('AgentEat commodityName must not be empty');
  }
  assertPositiveFinite(quantity, 'AgentEat quantity');

  return {
    commodityName,
    quantity,
  };
}

export function assertAgentStudyPayload(payload: unknown): AgentStudyPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentStudy payload must be an object');
  }
  const durationSeconds = payload['durationSeconds'];
  const educationRatePerSecond = payload['educationRatePerSecond'];
  assertNonNegativeFinite(durationSeconds, 'AgentStudy durationSeconds');
  assertNonNegativeFinite(educationRatePerSecond, 'AgentStudy educationRatePerSecond');

  return {
    durationSeconds,
    educationRatePerSecond,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPositiveFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}

function assertNonNegativeFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}
