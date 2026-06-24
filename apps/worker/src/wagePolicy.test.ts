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
});

function createProjectionWithPriceIndices() {
  return createWorldProjection({
    agents: createPopulationAgents(),
    marketPriceIndices: [
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
    ],
  });
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
