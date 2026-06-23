import { asAgentId, type AgentId } from '@aivilization/sim-core';

export type AgentEatPayload = {
  readonly commodityName: string;
  readonly quantity: number;
};

export type AgentStudyPayload = {
  readonly durationSeconds: number;
  readonly educationRatePerSecond: number;
};

export type AgentSleepPayload = {
  readonly durationSeconds: number;
};

export type AgentWorkPayload = {
  readonly occupationName: string;
  readonly laborSeconds: number;
};

export type AgentProducePayload = {
  readonly commodityName: string;
  readonly quantity: number;
  readonly availableLaborSeconds: number;
};

export type AgentTradePayload = {
  readonly side: 'buy' | 'sell';
  readonly commodityName: string;
  readonly quantity: number;
};

export type AgentApplyJobPayload = {
  readonly occupationName: string;
};

export type AgentSocializePayload = {
  readonly targetAgentId: AgentId;
  readonly summary: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
};

export type AdvanceSimulationTimePayload = {
  readonly deltaMs: number;
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

export function assertAgentSleepPayload(payload: unknown): AgentSleepPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentSleep payload must be an object');
  }
  const durationSeconds = payload['durationSeconds'];
  assertNonNegativeFinite(durationSeconds, 'AgentSleep durationSeconds');

  return {
    durationSeconds,
  };
}

export function assertAgentWorkPayload(payload: unknown): AgentWorkPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentWork payload must be an object');
  }
  const occupationName = payload['occupationName'];
  const laborSeconds = payload['laborSeconds'];
  if (typeof occupationName !== 'string' || occupationName.trim().length === 0) {
    throw new Error('AgentWork occupationName must not be empty');
  }
  assertPositiveFinite(laborSeconds, 'AgentWork laborSeconds');

  return {
    occupationName,
    laborSeconds,
  };
}

export function assertAgentProducePayload(payload: unknown): AgentProducePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentProduce payload must be an object');
  }
  const commodityName = payload['commodityName'];
  const quantity = payload['quantity'];
  const availableLaborSeconds = payload['availableLaborSeconds'];
  if (typeof commodityName !== 'string' || commodityName.trim().length === 0) {
    throw new Error('AgentProduce commodityName must not be empty');
  }
  assertPositiveInteger(quantity, 'AgentProduce quantity');
  assertNonNegativeFinite(availableLaborSeconds, 'AgentProduce availableLaborSeconds');

  return {
    commodityName,
    quantity,
    availableLaborSeconds,
  };
}

export function assertAgentTradePayload(payload: unknown): AgentTradePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentTrade payload must be an object');
  }
  const side = payload['side'];
  const commodityName = payload['commodityName'];
  const quantity = payload['quantity'];
  if (side !== 'buy' && side !== 'sell') {
    throw new Error('AgentTrade side must be buy or sell');
  }
  if (typeof commodityName !== 'string' || commodityName.trim().length === 0) {
    throw new Error('AgentTrade commodityName must not be empty');
  }
  assertPositiveFinite(quantity, 'AgentTrade quantity');

  return {
    side,
    commodityName,
    quantity,
  };
}

export function assertAgentApplyJobPayload(payload: unknown): AgentApplyJobPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentApplyJob payload must be an object');
  }
  const occupationName = payload['occupationName'];
  if (typeof occupationName !== 'string' || occupationName.trim().length === 0) {
    throw new Error('AgentApplyJob occupationName must not be empty');
  }

  return {
    occupationName,
  };
}

export function assertAgentSocializePayload(payload: unknown): AgentSocializePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentSocialize payload must be an object');
  }
  const targetAgentId = payload['targetAgentId'];
  const summary = payload['summary'];
  const relationDelta = payload['relationDelta'];
  const attitudeDelta = payload['attitudeDelta'];

  if (typeof targetAgentId !== 'string') {
    throw new Error('AgentSocialize targetAgentId must be a string');
  }
  if (typeof summary !== 'string' || summary.trim().length === 0) {
    throw new Error('AgentSocialize summary must not be empty');
  }
  assertFinite(relationDelta, 'AgentSocialize relationDelta');
  assertFinite(attitudeDelta, 'AgentSocialize attitudeDelta');

  return {
    targetAgentId: asAgentId(targetAgentId),
    summary,
    relationDelta,
    attitudeDelta,
  };
}

export function assertAdvanceSimulationTimePayload(
  payload: unknown,
): AdvanceSimulationTimePayload {
  if (!isRecord(payload)) {
    throw new Error('AdvanceSimulationTime payload must be an object');
  }
  const deltaMs = payload['deltaMs'];
  assertNonNegativeFinite(deltaMs, 'AdvanceSimulationTime deltaMs');

  return {
    deltaMs,
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

function assertPositiveInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}

function assertFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
