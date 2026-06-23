import type { ActionSynthesisPolicy } from '@aivilization/agent-runtime';
import type { WorldAgentState } from '@aivilization/world';

export type WorldStateActionSynthesisPolicyConfig = {
  readonly maxActions?: number;
  readonly planningWindowSeconds?: number;
  readonly minEnergyReserve?: number;
  readonly minSatietyReserve?: number;
  readonly minBalanceReserve?: number;
};

export function deriveActionSynthesisPolicyFromWorldState(input: {
  readonly agent: WorldAgentState;
  readonly config?: WorldStateActionSynthesisPolicyConfig;
}): ActionSynthesisPolicy {
  const config = normalizeConfig(input.config);
  return {
    ...(config.maxActions === undefined ? {} : { maxActions: config.maxActions }),
    budget: {
      ...(config.planningWindowSeconds === undefined
        ? {}
        : { availableActionSeconds: config.planningWindowSeconds }),
      energyBudget: clampBudget(input.agent.physiology.energy, config.minEnergyReserve),
      satietyBudget: clampBudget(input.agent.physiology.satiety, config.minSatietyReserve),
      currencyBudget: clampBudget(input.agent.balance, config.minBalanceReserve),
      inventoryBudget: copyPositiveInventory(input.agent.inventory),
    },
  };
}

type NormalizedWorldStateActionSynthesisPolicyConfig = {
  readonly maxActions?: number;
  readonly planningWindowSeconds?: number;
  readonly minEnergyReserve: number;
  readonly minSatietyReserve: number;
  readonly minBalanceReserve: number;
};

function normalizeConfig(
  config: WorldStateActionSynthesisPolicyConfig | undefined,
): NormalizedWorldStateActionSynthesisPolicyConfig {
  assertNonNegativeIntegerIfPresent(config?.maxActions, 'actionSynthesis.maxActions');
  assertNonNegativeFiniteIfPresent(
    config?.planningWindowSeconds,
    'actionSynthesis.planningWindowSeconds',
  );
  assertNonNegativeFiniteIfPresent(
    config?.minEnergyReserve,
    'actionSynthesis.minEnergyReserve',
  );
  assertNonNegativeFiniteIfPresent(
    config?.minSatietyReserve,
    'actionSynthesis.minSatietyReserve',
  );
  assertNonNegativeFiniteIfPresent(
    config?.minBalanceReserve,
    'actionSynthesis.minBalanceReserve',
  );

  return {
    ...(config?.maxActions === undefined ? {} : { maxActions: config.maxActions }),
    ...(config?.planningWindowSeconds === undefined
      ? {}
      : { planningWindowSeconds: config.planningWindowSeconds }),
    minEnergyReserve: config?.minEnergyReserve ?? 0,
    minSatietyReserve: config?.minSatietyReserve ?? 0,
    minBalanceReserve: config?.minBalanceReserve ?? 0,
  };
}

function clampBudget(value: number, reserve: number): number {
  assertNonNegativeFinite(value, 'agent state budget source');
  return Math.max(0, value - reserve);
}

function copyPositiveInventory(
  inventory: WorldAgentState['inventory'],
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(inventory)
      .filter(([, quantity]) => quantity > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function assertNonNegativeIntegerIfPresent(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertNonNegativeFiniteIfPresent(value: number | undefined, name: string): void {
  if (value !== undefined) {
    assertNonNegativeFinite(value, name);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative finite`);
  }
}
