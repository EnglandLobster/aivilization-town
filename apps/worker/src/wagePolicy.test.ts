import { asAgentId, asSimulationId, createCommandEnvelope } from '@aivilization/sim-core';
import {
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createProjectionBackedWageCalculator,
  createProjectionBackedWorldCommandPolicies,
  createProjectionBackedWorldCommandPolicySource,
} from './index';

const simulationId = asSimulationId('sim-wage-policy');
const educationScores = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450];
const expectedDoctorWage = 1824.3225;

const basePolicies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Bread: 15 },
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
};

describe('projection-backed wage policy', () => {
  test('overlays replayed governance policies onto canonical command policies', () => {
    const projection = {
      ...createProjectionWithPriceIndices(),
      governance: {
        revision: 3,
        tax: {
          policyVersion: 'town-governance-tax-v1',
          neutralRate: 0.2,
          incomeTaxBrackets: [{ upToAmount: null, rate: 0.2 }],
          tradeTaxRate: 0.1,
          source: 'town-governance-command',
        },
        publicBudget: {
          policyVersion: 'town-governance-public-budget-v1',
          cadenceMs: 2_000,
          minimumTreasuryReserve: 75,
          allocations: [{ service: 'education', amountPerCadence: 40 }],
        },
        subsidy: {
          policyVersion: 'town-governance-subsidy-v1',
          minimumBalance: 50,
          maxSubsidy: 25,
          source: 'town-governance-command',
        },
        consumedPetitionIds: ['petition-1'],
        lastChangedAt: 1_000,
        lastChangedBy: { kind: 'operator' as const, subjectId: 'operator-1' },
        lastChangeReason: 'test',
      },
    };
    const resolved = createProjectionBackedWorldCommandPolicies({
      basePolicies: {
        ...basePolicies,
        tax: {
          policyVersion: 'base-tax',
          neutralRate: 0.1,
          incomeTaxBrackets: [],
          tradeTaxRate: 0,
          source: 'base',
        },
      },
      projection,
      knowledgePremium: () => 1,
    });
    expect(resolved.tax).toMatchObject({ neutralRate: 0.2, tradeTaxRate: 0.1 });
    expect(resolved.publicBudget).toMatchObject({
      cadenceMs: 2_000,
      minimumTreasuryReserve: 75,
    });
    expect(resolved.safetyNetSubsidy).toEqual({ minimumBalance: 50, maxSubsidy: 25 });
  });

  test('calculates static and dynamic wages from the latest market price index', () => {
    const projection = createProjectionWithPriceIndices();
    const calculator = createProjectionBackedWageCalculator({
      projection,
      shortTermAdjustment: 0.05,
      maxShortTermAdjustment: 0.1,
      knowledgePremium: (effectiveKnowledgeThreshold) => 1 + effectiveKnowledgeThreshold / 1000,
    });

    expect(calculator('Cleaner')).toBe(750);
    expect(calculator('Doctor')).toBeCloseTo(expectedDoctorWage);
  });

  test('fails fast when projection-backed wages have no market price index', () => {
    const projection = createWorldProjection({
      agents: createPopulationAgents(),
    });

    expect(() =>
      createProjectionBackedWageCalculator({
        projection,
        knowledgePremium: (effectiveKnowledgeThreshold) => 1 + effectiveKnowledgeThreshold / 1000,
      }),
    ).toThrow(/market price index/i);
  });

  test('uses an explicit neutral price-index strategy during canonical cold start', () => {
    const projection = createWorldProjection({
      agents: createPopulationAgents(),
    });
    const calculator = createProjectionBackedWageCalculator({
      projection,
      missingMarketPriceIndexStrategy: 'neutral',
      knowledgePremium: (effectiveKnowledgeThreshold) => 1 + effectiveKnowledgeThreshold / 1000,
    });

    expect(calculator('Cleaner')).toBe(250);
    expect(calculator('Doctor')).toBeCloseTo(579.15);
  });

  test('dispatches AgentWork with projection-derived wages through world policies', () => {
    const projection = createProjectionWithPriceIndices();
    const policies = createProjectionBackedWorldCommandPolicies({
      basePolicies,
      projection,
      shortTermAdjustment: 0.05,
      maxShortTermAdjustment: 0.1,
      knowledgePremium: (effectiveKnowledgeThreshold) => 1 + effectiveKnowledgeThreshold / 1000,
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'agent-work-doctor',
        simulationId,
        actorId: asAgentId('agent-8'),
        source: 'agent-runtime',
        type: 'AgentWork',
        payload: {
          occupationName: 'Doctor',
          laborSeconds: 3600,
        },
        issuedAt: 300,
      }),
      projection,
      policies,
      nextSequence: 1,
    });

    const wagePaid = events.find((event) => event.type === 'WagePaid');
    if (wagePaid?.type !== 'WagePaid') {
      throw new Error('expected WagePaid event');
    }

    expect(wagePaid.payload).toMatchObject({
      agentId: asAgentId('agent-8'),
      occupationName: 'Doctor',
    });
    expect(wagePaid.payload.amount).toBeCloseTo(expectedDoctorWage);
  });

  test('dispatches AgentApplyJob with projection-derived population education thresholds', () => {
    const projection = createJobApplicationProjectionWithPriceIndices();
    const policies = createProjectionBackedWorldCommandPolicies({
      basePolicies: {
        ...basePolicies,
        jobApplication: {
          populationEducationScores: [0],
          quotaByResidentialTier: [1, 1, 1, 1, 1],
        },
      },
      projection,
      knowledgePremium: (effectiveKnowledgeThreshold) => 1 + effectiveKnowledgeThreshold / 1000,
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'agent-apply-doctor',
        simulationId,
        actorId: asAgentId('agent-7'),
        source: 'agent-runtime',
        type: 'AgentApplyJob',
        payload: { occupationName: 'Doctor' },
        issuedAt: 300,
      }),
      projection,
      policies,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]).toMatchObject({
      type: 'ActionRejected',
      payload: {
        commandType: 'AgentApplyJob',
        reason: 'education-too-low: educationScore requires 350, available 300',
      },
    });
  });

  test('creates a reusable policy source that resolves against the supplied projection', () => {
    const policySource = createProjectionBackedWorldCommandPolicySource({
      basePolicies,
      shortTermAdjustment: 0.05,
      maxShortTermAdjustment: 0.1,
      knowledgePremium: (effectiveKnowledgeThreshold) => 1 + effectiveKnowledgeThreshold / 1000,
    });

    const policies = policySource(createProjectionWithPriceIndices());

    expect(policies.wageCalculator('Doctor')).toBeCloseTo(expectedDoctorWage);
  });
});

function createProjectionWithPriceIndices() {
  return createWorldProjection({
    agents: createPopulationAgents(),
    marketPriceIndices: createMarketPriceIndices(),
  });
}

function createJobApplicationProjectionWithPriceIndices() {
  return createWorldProjection({
    agents: createPopulationAgents().map((agent) =>
      agent.agentId === asAgentId('agent-7')
        ? { ...agent, inventory: { Transistor: 1 }, job: null }
        : agent,
    ),
    marketPriceIndices: createMarketPriceIndices(),
  });
}

function createMarketPriceIndices() {
  return [
    {
      baselineAt: 0,
      recordedAt: 100,
      food: 2,
      nonFood: 2,
      overall: 2,
      foodCount: 1,
      nonFoodCount: 1,
      ratios: { Bread: 2, Book: 2 },
    },
    {
      baselineAt: 0,
      recordedAt: 200,
      food: 4,
      nonFood: 2,
      overall: 3,
      foodCount: 1,
      nonFoodCount: 1,
      ratios: { Bread: 4, Book: 2 },
    },
  ];
}

function createPopulationAgents() {
  return educationScores.map((educationScore, index) => ({
    agentId: asAgentId(`agent-${index + 1}`),
    physiology: { energy: 90, satiety: 80, health: 100 },
    educationScore,
    balance: 100,
    residentialTier: 5,
    job: index === 7 ? 'Doctor' : null,
    inventory: {},
  }));
}
