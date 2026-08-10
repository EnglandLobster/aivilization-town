import type {
  AtomicActionProposal,
  CycleRepairPolicy,
  CycleRepairPolicyInput,
} from '@aivilization/agent-runtime';
import type { WorldCommandPolicies } from '@aivilization/world';

export type CanonicalLocalRepairPolicyConfig = {
  readonly policies: WorldCommandPolicies;
  readonly strategies?: readonly CanonicalLocalRepairStrategy[];
};

export type CanonicalLocalRepairStrategyInput = CycleRepairPolicyInput & {
  readonly policies: WorldCommandPolicies;
};

export type CanonicalLocalRepairStrategy = {
  readonly id: string;
  repair(input: CanonicalLocalRepairStrategyInput): AtomicActionProposal | undefined;
};

export function createCanonicalLocalRepairPolicy(
  config: CanonicalLocalRepairPolicyConfig,
): CycleRepairPolicy {
  const strategies = config.strategies ?? createDefaultCanonicalLocalRepairStrategies();

  return (input) => {
    for (const strategy of strategies) {
      const action = strategy.repair({ ...input, policies: config.policies });
      if (action !== undefined) {
        return action;
      }
    }

    return undefined;
  };
}

export function createDefaultCanonicalLocalRepairStrategies(): readonly CanonicalLocalRepairStrategy[] {
  return [
    createSatietyInventoryRepairStrategy(),
    createMissingInventoryMarketBuyRepairStrategy(),
    createEnergySleepRepairStrategy(),
    createJobApplicationRepairStrategy(),
  ];
}

function createSatietyInventoryRepairStrategy(): CanonicalLocalRepairStrategy {
  return {
    id: 'satiety-inventory-repair',
    repair: (input) => {
      if (!input.reason.toLowerCase().includes('satiety')) {
        return undefined;
      }

      const agent = input.worldDecisionContext?.agent;
      if (agent === undefined) {
        return undefined;
      }

      const food = chooseBestInventoryFood({
        inventory: agent.inventory,
        satietyRecoveryByCommodity: input.policies.satietyRecoveryByCommodity,
      });
      if (food === undefined) {
        return undefined;
      }

      return {
        id: createRepairActionId(input, 'eat', food.commodityName),
        description: `Eat ${food.commodityName} before retrying ${input.rejectedAction.description}.`,
        commandType: 'AgentEat',
        payload: { commodityName: food.commodityName, quantity: 1 },
        priority: repairPriority(input),
        resourceEstimate: { inventoryCosts: { [food.commodityName]: 1 } },
      };
    },
  };
}

function createMissingInventoryMarketBuyRepairStrategy(): CanonicalLocalRepairStrategy {
  return {
    id: 'missing-inventory-market-buy-repair',
    repair: (input) => {
      if (input.rejectedAction.commandType === 'AgentTrade') {
        return undefined;
      }

      const missing = parseMissingInventoryReason(input.reason);
      const agent = input.worldDecisionContext?.agent;
      if (missing === undefined || agent === undefined) {
        return undefined;
      }

      const quantity = missing.requiredQuantity - missing.availableQuantity;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return undefined;
      }

      const spotPrice = input.worldDecisionContext?.market.spotPrices.find(
        (price) => price.commodity === missing.commodityName,
      )?.spotPrice;
      if (spotPrice === undefined || !Number.isFinite(spotPrice) || spotPrice < 0) {
        return undefined;
      }

      const estimatedCost = spotPrice * quantity;
      if (agent.balance < estimatedCost) {
        return undefined;
      }

      return {
        id: createRepairActionId(input, 'buy', missing.commodityName),
        description: `Buy ${formatQuantity(quantity)} ${
          missing.commodityName
        } before retrying ${input.rejectedAction.description}.`,
        commandType: 'AgentTrade',
        payload: {
          side: 'buy',
          commodityName: missing.commodityName,
          quantity,
        },
        priority: repairPriority(input),
        resourceEstimate: { currencyCost: estimatedCost },
      };
    },
  };
}

function createEnergySleepRepairStrategy(): CanonicalLocalRepairStrategy {
  return {
    id: 'energy-sleep-repair',
    repair: (input) => {
      const reason = input.reason.toLowerCase();
      if (!reason.includes('energy') && reason !== 'agent is incapacitated') {
        return undefined;
      }

      const agent = input.worldDecisionContext?.agent;
      if (
        agent === undefined ||
        agent.physiology.health <= input.policies.criticalThresholds.health
      ) {
        return undefined;
      }
      const sleepPolicy = input.policies.sleep;
      if (sleepPolicy === undefined || sleepPolicy.energyRecoveryPerSecond <= 0) {
        return undefined;
      }

      const missingEnergy = sleepPolicy.maxEnergy - agent.physiology.energy;
      if (missingEnergy <= 0) {
        return undefined;
      }

      const durationSeconds = Math.max(
        1,
        Math.ceil(missingEnergy / sleepPolicy.energyRecoveryPerSecond),
      );
      return {
        id: createRepairActionId(input, 'sleep', 'energy'),
        description: `Sleep before retrying ${input.rejectedAction.description}.`,
        commandType: 'AgentSleep',
        payload: { durationSeconds },
        priority: repairPriority(input),
        resourceEstimate: { actionSeconds: durationSeconds },
      };
    },
  };
}

function createJobApplicationRepairStrategy(): CanonicalLocalRepairStrategy {
  return {
    id: 'job-application-repair',
    repair: (input) => {
      const occupationName = parseJobMismatchReason(input.reason);
      if (occupationName === undefined || input.rejectedAction.commandType !== 'AgentWork') {
        return undefined;
      }

      return {
        id: createRepairActionId(input, 'apply-job', occupationName),
        description: `Apply for ${occupationName} before retrying ${input.rejectedAction.description}.`,
        commandType: 'AgentApplyJob',
        payload: { occupationName },
        priority: repairPriority(input),
      };
    },
  };
}

function chooseBestInventoryFood(input: {
  readonly inventory: Readonly<Record<string, number>>;
  readonly satietyRecoveryByCommodity: Readonly<Record<string, number>>;
}): { readonly commodityName: string; readonly recovery: number } | undefined {
  return Object.entries(input.inventory)
    .flatMap(([commodityName, quantity]) => {
      const recovery = input.satietyRecoveryByCommodity[commodityName];
      if (quantity <= 0 || recovery === undefined || !Number.isFinite(recovery) || recovery <= 0) {
        return [];
      }
      return [{ commodityName, recovery }];
    })
    .sort((left, right) => {
      if (right.recovery !== left.recovery) {
        return right.recovery - left.recovery;
      }
      return left.commodityName.localeCompare(right.commodityName);
    })[0];
}

function parseMissingInventoryReason(
  reason: string,
):
  | {
      readonly commodityName: string;
      readonly requiredQuantity: number;
      readonly availableQuantity: number;
    }
  | undefined {
  const insufficientMatch = /^insufficient ([^:]+): required ([0-9.]+), available ([0-9.]+)$/u.exec(
    reason,
  );
  if (insufficientMatch !== null) {
    return createMissingInventoryReason({
      commodityName: insufficientMatch[1],
      requiredQuantity: insufficientMatch[2],
      availableQuantity: insufficientMatch[3],
    });
  }

  const inputMatch = /^insufficient-input: (.+) requires ([0-9.]+), available ([0-9.]+)$/u.exec(
    reason,
  );
  if (inputMatch === null) {
    return undefined;
  }

  return createMissingInventoryReason({
    commodityName: inputMatch[1],
    requiredQuantity: inputMatch[2],
    availableQuantity: inputMatch[3],
  });
}

function createMissingInventoryReason(input: {
  readonly commodityName: string | undefined;
  readonly requiredQuantity: string | undefined;
  readonly availableQuantity: string | undefined;
}):
  | {
      readonly commodityName: string;
      readonly requiredQuantity: number;
      readonly availableQuantity: number;
    }
  | undefined {
  if (
    input.commodityName === undefined ||
    input.requiredQuantity === undefined ||
    input.availableQuantity === undefined
  ) {
    return undefined;
  }

  const requiredQuantity = Number(input.requiredQuantity);
  const availableQuantity = Number(input.availableQuantity);
  if (!Number.isFinite(requiredQuantity) || !Number.isFinite(availableQuantity)) {
    return undefined;
  }

  return {
    commodityName: input.commodityName,
    requiredQuantity,
    availableQuantity,
  };
}

function parseJobMismatchReason(reason: string): string | undefined {
  return /^agent job .+ does not match (.+)$/u.exec(reason)?.[1];
}

function repairPriority(input: CycleRepairPolicyInput): number {
  return (input.rejectedAction.priority ?? input.selectedSubtask.score) + 1;
}

function createRepairActionId(
  input: CycleRepairPolicyInput,
  action: string,
  target: string,
): string {
  return `local-repair-${sanitizeIdPart(input.rejectedAction.id)}-${sanitizeIdPart(
    action,
  )}-${sanitizeIdPart(target)}`;
}

function sanitizeIdPart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9]+/gu, '-') || 'unknown';
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}
