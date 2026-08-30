import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import type { ServiceQualityPolicy } from '@aivilization/society';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldAgentState,
  type WorldCommandPolicies,
  type WorldEvent,
} from './index';

const serviceQuality: ServiceQualityPolicy = {
  policyVersion: 'town-service-quality-v1',
  cadenceMs: 1_000,
  services: {
    education: {
      requiredFundingPerCadence: 10,
      pressureStartsAtOccupancyRatio: 0.5,
      qualityAtFullOccupancy: 0.5,
    },
    healthcare: {
      requiredFundingPerCadence: 10,
      pressureStartsAtOccupancyRatio: 0.5,
      qualityAtFullOccupancy: 0.5,
    },
  },
  landValueWeight: 8,
  wellbeingPenaltyAtZeroQuality: 8,
};

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  publicBudget: {
    policyVersion: 'public-budget-v1',
    cadenceMs: 1_000,
    minimumTreasuryReserve: 0,
    allocations: [
      { service: 'education', amountPerCadence: 10 },
      { service: 'healthcare', amountPerCadence: 10 },
    ],
  },
  serviceQuality,
};

describe('regional service quality settlement', () => {
  test('records funded occupancy pressure and replays the final regional facts', () => {
    const projection = createServiceProjection(100);
    const events = advance(projection, 1_000, 'quality-one');
    const qualityEvents = events.filter(
      (event): event is Extract<WorldEvent, { readonly type: 'RegionalServiceQualityUpdated' }> =>
        event.type === 'RegionalServiceQualityUpdated',
    );

    expect(qualityEvents).toHaveLength(4);
    expect(
      qualityEvents.find(
        (event) => event.payload.regionId === 'downtown' && event.payload.service === 'education',
      )?.payload,
    ).toMatchObject({
      previousQuality: null,
      fundedAmount: 10,
      occupancy: 4,
      capacity: 4,
      budgetEfficiency: 1,
      capacityEfficiency: 0.5,
      quality: 0.5,
      landValueContribution: 4,
      wellbeingContribution: -4,
      settledAt: 1_000,
    });
    expect(
      qualityEvents.find(
        (event) => event.payload.regionId === 'harbor' && event.payload.service === 'healthcare',
      )?.payload,
    ).toMatchObject({ capacity: 0, quality: 0 });

    const replayed = events.reduce(applyWorldEvent, projection);
    expect(replayed.regionalServiceQualities?.downtown?.education).toMatchObject({
      quality: 0.5,
      occupancy: 4,
      policyVersion: 'town-service-quality-v1',
      settledAt: 1_000,
    });
    expect(replayed.regionalServiceQualities?.harbor?.healthcare?.quality).toBe(0);
  });

  test('evaluates every crossed cadence and carries previous quality within a merged advance', () => {
    const projection = createServiceProjection(100);
    const events = advance(projection, 2_000, 'quality-merged');
    const education = events.filter(
      (event): event is Extract<WorldEvent, { readonly type: 'RegionalServiceQualityUpdated' }> =>
        event.type === 'RegionalServiceQualityUpdated' &&
        event.payload.regionId === 'downtown' &&
        event.payload.service === 'education',
    );
    expect(education).toHaveLength(2);
    expect(education.map((event) => event.payload.previousQuality)).toEqual([null, 0.5]);
    expect(education.map((event) => event.payload.settledAt)).toEqual([1_000, 2_000]);
  });

  test('applies the settled regional quality to study and treatment effects', () => {
    const projection = createServiceProjection(100);
    const settled = advance(projection, 1_000, 'quality-effects').reduce(
      applyWorldEvent,
      projection,
    );
    const studied = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'quality-study',
        simulationId: 'service-quality-sim',
        actorId: 'student-0',
        source: 'agent-runtime',
        type: 'AgentStudy',
        payload: { durationSeconds: 10, educationRatePerSecond: 1 },
        issuedAt: 1_000,
      }),
      projection: settled,
      policies,
      nextSequence: 20,
    });
    expect(studied.find((event) => event.type === 'EducationChanged')?.payload).toMatchObject({
      previousEducationScore: 0,
      nextEducationScore: 5,
    });

    const treated = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'quality-treatment',
        simulationId: 'service-quality-sim',
        actorId: 'patient-0',
        source: 'agent-runtime',
        type: 'AgentSeeDoctor',
        payload: { durationSeconds: 10 },
        issuedAt: 1_000,
      }),
      projection: settled,
      policies: {
        ...policies,
        seeDoctor: { healthRecoveryPerSecond: 1, maxHealth: 100 },
      },
      nextSequence: 30,
    });
    expect(treated.find((event) => event.type === 'PhysiologyChanged')?.payload).toMatchObject({
      previous: { health: 50 },
      next: { health: 55 },
    });
  });

  test('feeds the same settled quality into wellbeing and land value', () => {
    const projection = createServiceProjection(100);
    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'quality-feedback',
        simulationId: 'service-quality-sim',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1_000 },
        issuedAt: 0,
      }),
      projection,
      policies: {
        ...policies,
        landValue: {
          policyVersion: 'land-value-v1',
          updateCadenceMs: 1_000,
          baseline: 0,
          populationWeight: 0,
          liquidityWeight: 0,
          smoothingFactor: 1,
          minIndex: 0,
          maxIndex: 100,
        },
        wellbeing: {
          policyVersion: 'town-wellbeing-v1',
          initialValue: 50,
          minValue: 0,
          maxValue: 100,
          baseline: 50,
          convergencePerHour: 100,
          coefficients: {
            health: 0,
            energy: 0,
            satiety: 0,
            employed: 0,
            unemployed: 0,
            residentialTier: [0, 0],
            lifestyleTier: [0, 0, 0, 0],
            upkeepArrearsPerUnit: 0,
            distress: 0,
            positiveRelation: 0,
            negativeRelation: 0,
          },
        },
      },
      nextSequence: 1,
    });
    const downtownLand = events.find(
      (event) => event.type === 'RegionalLandValueUpdated' && event.payload.regionId === 'downtown',
    );
    expect(downtownLand?.payload).toMatchObject({
      rawIndex: 4,
      serviceQualityContribution: 4,
    });
    const wellbeing = events.find(
      (event) => event.type === 'WellbeingChanged' && event.payload.agentId === 'student-0',
    );
    expect(wellbeing?.payload).toMatchObject({
      target: 46,
      factorContributions: { serviceQuality: -4 },
    });
  });
});

function createServiceProjection(treasury: number) {
  return createWorldProjection({
    treasury,
    moneySupply: treasury,
    agents: [
      ...Array.from({ length: 4 }, (_, index) => agent(`student-${index}`, asLocationId('school'))),
      ...Array.from({ length: 2 }, (_, index) => agent(`patient-${index}`, asLocationId('clinic'))),
    ],
    locations: [
      {
        locationId: asLocationId('school'),
        name: 'School',
        kind: 'education',
        activityAffinities: ['study'],
        capacity: 4,
        regionId: 'downtown',
      },
      {
        locationId: asLocationId('clinic'),
        name: 'Clinic',
        kind: 'healthcare',
        activityAffinities: ['health'],
        capacity: 2,
        regionId: 'downtown',
      },
      {
        locationId: asLocationId('market'),
        name: 'Market',
        kind: 'market',
        activityAffinities: ['trade'],
        capacity: 10,
        regionId: 'harbor',
      },
    ],
  });
}

function agent(id: string, locationId: ReturnType<typeof asLocationId>): WorldAgentState {
  return {
    agentId: asAgentId(id),
    locationId,
    physiology: { energy: 50, satiety: 50, health: 50 },
    educationScore: 0,
    balance: 0,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}

function advance(
  projection: ReturnType<typeof createServiceProjection>,
  deltaMs: number,
  id: string,
) {
  return dispatchWorldCommand({
    command: createCommandEnvelope({
      id,
      simulationId: 'service-quality-sim',
      source: 'system',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs },
      issuedAt: projection.clock.now,
    }),
    projection,
    policies,
    nextSequence: 1,
  });
}
