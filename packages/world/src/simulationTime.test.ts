import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  assertAdvanceSimulationTimePayload,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
} from './index';

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
};

describe('world simulation time', () => {
  test('creates a server-authoritative default clock on the world projection', () => {
    const projection = createWorldProjection({ agents: [] });

    expect(projection.clock).toEqual({ now: 0, tickDurationMs: 1000 });
  });

  test('allows simulations to seed the world projection clock', () => {
    const projection = createWorldProjection({
      agents: [],
      clock: { now: 1000, tickDurationMs: 250 },
    });

    expect(projection.clock).toEqual({ now: 1000, tickDurationMs: 250 });
  });

  test('dispatches AdvanceSimulationTime into a replayable SimulationTimeAdvanced event', () => {
    const projection = createWorldProjection({
      agents: [],
      clock: { now: 1000, tickDurationMs: 250 },
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-time-1',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 250 },
        issuedAt: 1000,
      }),
      projection,
      policies,
      nextSequence: 7,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'command-time-1:event:0',
      commandId: 'command-time-1',
      type: 'SimulationTimeAdvanced',
      payload: {
        previous: { now: 1000, tickDurationMs: 250 },
        next: { now: 1250, tickDurationMs: 250 },
        deltaMs: 250,
      },
      occurredAt: 1000,
      sequence: 7,
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.clock).toEqual({ now: 1250, tickDurationMs: 250 });
    expect(updated.agents).toEqual(projection.agents);
    expect(updated.rejectedActions).toEqual([]);
  });

  test('applies sleep deprivation health decay as a deterministic time effect', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-tired'),
          locationId: null,
          physiology: { energy: 10, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-rested'),
          locationId: null,
          physiology: { energy: 30, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      clock: { now: 1000, tickDurationMs: 60_000 },
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-time-sleep-deprivation',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 60_000 },
        issuedAt: 1000,
      }),
      projection,
      policies: {
        ...policies,
        sleepDeprivation: {
          energyThreshold: 20,
          healthDecayPerSecond: 0.5,
          minHealth: 10,
        },
      },
      nextSequence: 7,
    });

    expect(events.map((event) => [event.sequence, event.type])).toEqual([
      [7, 'SimulationTimeAdvanced'],
      [8, 'PhysiologyChanged'],
    ]);
    expect(events[1]).toMatchObject({
      type: 'PhysiologyChanged',
      payload: {
        agentId: 'agent-tired',
        previous: { energy: 10, satiety: 80, health: 90 },
        next: { energy: 10, satiety: 80, health: 60 },
        reason: 'sleep-deprivation',
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.clock).toEqual({ now: 61_000, tickDurationMs: 60_000 });
    expect(updated.agents['agent-tired']?.physiology).toEqual({
      energy: 10,
      satiety: 80,
      health: 60,
    });
    expect(updated.agents['agent-rested']?.physiology).toEqual({
      energy: 30,
      satiety: 80,
      health: 90,
    });
  });

  test('applies stochastic illness health decay as a deterministic time effect', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-illness'),
          locationId: null,
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      clock: { now: 1000, tickDurationMs: 3_600_000 },
    });

    const command = createCommandEnvelope({
      id: 'command-time-stochastic-illness',
      simulationId: 'sim-1',
      source: 'system',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs: 3_600_000 },
      issuedAt: 1000,
    });
    const policy = {
      ...policies,
      stochasticIllness: {
        illnessProbabilityPercentPerHour: 100,
        healthDamage: 12,
        minHealth: 10,
      },
    };

    const events = dispatchWorldCommand({
      command,
      projection,
      policies: policy,
      nextSequence: 7,
    });
    const replayedEvents = dispatchWorldCommand({
      command,
      projection,
      policies: policy,
      nextSequence: 7,
    });

    expect(replayedEvents).toEqual(events);
    expect(events.map((event) => [event.sequence, event.type])).toEqual([
      [7, 'SimulationTimeAdvanced'],
      [8, 'PhysiologyChanged'],
    ]);
    expect(events[1]).toMatchObject({
      type: 'PhysiologyChanged',
      payload: {
        agentId: 'agent-illness',
        previous: { energy: 80, satiety: 80, health: 90 },
        next: { energy: 80, satiety: 80, health: 78 },
        reason: 'stochastic-illness',
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-illness']?.physiology).toEqual({
      energy: 80,
      satiety: 80,
      health: 78,
    });
  });

  test('composes sleep deprivation before stochastic illness in one time tick', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-tired-and-ill'),
          locationId: null,
          physiology: { energy: 10, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      clock: { now: 1000, tickDurationMs: 3_600_000 },
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-time-composed-health-decay',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 3_600_000 },
        issuedAt: 1000,
      }),
      projection,
      policies: {
        ...policies,
        sleepDeprivation: {
          energyThreshold: 20,
          healthDecayPerSecond: 0.005,
          minHealth: 10,
        },
        stochasticIllness: {
          illnessProbabilityPercentPerHour: 100,
          healthDamage: 12,
          minHealth: 10,
        },
      },
      nextSequence: 7,
    });

    expect(events.map((event) => [event.sequence, event.type])).toEqual([
      [7, 'SimulationTimeAdvanced'],
      [8, 'PhysiologyChanged'],
      [9, 'PhysiologyChanged'],
    ]);
    expect(events[1]).toMatchObject({
      payload: {
        agentId: 'agent-tired-and-ill',
        previous: { energy: 10, satiety: 80, health: 90 },
        next: { energy: 10, satiety: 80, health: 72 },
        reason: 'sleep-deprivation',
      },
    });
    expect(events[2]).toMatchObject({
      payload: {
        agentId: 'agent-tired-and-ill',
        previous: { energy: 10, satiety: 80, health: 72 },
        next: { energy: 10, satiety: 80, health: 60 },
        reason: 'stochastic-illness',
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-tired-and-ill']?.physiology).toEqual({
      energy: 10,
      satiety: 80,
      health: 60,
    });
  });

  test('applies safety net subsidies as deterministic time effects', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-low-balance'),
          locationId: null,
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 10,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-stable-balance'),
          locationId: null,
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 50,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      moneySupply: 100,
      clock: { now: 1000, tickDurationMs: 60_000 },
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-time-safety-net',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 60_000 },
        issuedAt: 1000,
      }),
      projection,
      policies: {
        ...policies,
        safetyNetSubsidy: {
          minimumBalance: 50,
          maxSubsidy: 25,
        },
      },
      nextSequence: 7,
    });

    expect(events.map((event) => [event.sequence, event.type])).toEqual([
      [7, 'SimulationTimeAdvanced'],
      [8, 'SubsidyPaid'],
    ]);
    expect(events[1]).toMatchObject({
      type: 'SubsidyPaid',
      payload: {
        agentId: 'agent-low-balance',
        amount: 25,
        previousBalance: 10,
        nextBalance: 35,
        reason: 'safety-net',
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-low-balance']?.balance).toBe(35);
    expect(updated.agents['agent-stable-balance']?.balance).toBe(50);
    expect(updated.moneySupply).toBe(125);
  });

  test('charges residential upkeep before applying safety net subsidies', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-residential-pressure'),
          locationId: null,
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 55,
          residentialTier: 2,
          job: null,
          inventory: {},
        },
      ],
      moneySupply: 100,
      clock: { now: 1000, tickDurationMs: 1800_000 },
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-time-residential-upkeep',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1800_000 },
        issuedAt: 1000,
      }),
      projection,
      policies: {
        ...policies,
        residentialUpkeep: {
          costs: [{ residentialTier: 2, currencyCostPerHour: 20 }],
        },
        safetyNetSubsidy: {
          minimumBalance: 50,
          maxSubsidy: 25,
        },
      },
      nextSequence: 7,
    });

    expect(events.map((event) => [event.sequence, event.type])).toEqual([
      [7, 'SimulationTimeAdvanced'],
      [8, 'ResidentialUpkeepCharged'],
      [9, 'SubsidyPaid'],
    ]);
    expect(events[1]).toMatchObject({
      type: 'ResidentialUpkeepCharged',
      payload: {
        agentId: 'agent-residential-pressure',
        residentialTier: 2,
        amount: 10,
        unpaidAmount: 0,
        previousBalance: 55,
        nextBalance: 45,
        reason: 'residential-upkeep',
      },
    });
    expect(events[2]).toMatchObject({
      type: 'SubsidyPaid',
      payload: {
        agentId: 'agent-residential-pressure',
        amount: 5,
        previousBalance: 45,
        nextBalance: 50,
        reason: 'safety-net',
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-residential-pressure']?.balance).toBe(50);
    expect(updated.moneySupply).toBe(95);
  });

  test('rejects invalid AdvanceSimulationTime payloads before mutating projection time', () => {
    expect(() => assertAdvanceSimulationTimePayload({ deltaMs: -1 })).toThrow(
      /AdvanceSimulationTime deltaMs/,
    );

    const projection = createWorldProjection({ agents: [] });
    expect(() =>
      dispatchWorldCommand({
        command: createCommandEnvelope({
          id: 'command-time-invalid',
          simulationId: 'sim-1',
          source: 'system',
          type: 'AdvanceSimulationTime',
          payload: { deltaMs: Number.POSITIVE_INFINITY },
          issuedAt: 0,
        }),
        projection,
        policies,
        nextSequence: 1,
      }),
    ).toThrow(/AdvanceSimulationTime deltaMs/);
    expect(projection.clock).toEqual({ now: 0, tickDurationMs: 1000 });
  });
});
