import {
  asAgentId,
  asLocationId,
  asLoanId,
  createCommandEnvelope,
} from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type {
  LifecyclePolicy,
  TownCalendarPolicy,
  WellbeingPolicy,
} from '@aivilization/society';
import {
  applyWorldEvent,
  assertAdvanceSimulationTimePayload,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
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

  test('uses the resolved experiment seed to reproduce and vary stochastic illness outcomes', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-seeded-illness'),
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
      id: 'command-time-seeded-illness',
      simulationId: 'sim-seeded',
      source: 'system',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs: 3_600_000 },
      issuedAt: 1000,
    });
    const dispatchWithSeed = (randomSeed: string) =>
      dispatchWorldCommand({
        command,
        projection,
        policies: {
          ...policies,
          randomSeed,
          stochasticIllness: {
            illnessProbabilityPercentPerHour: 50,
            healthDamage: 12,
            minHealth: 10,
          },
        },
        nextSequence: 7,
      });

    expect(dispatchWithSeed('experiment-seed-0')).toEqual(dispatchWithSeed('experiment-seed-0'));

    const physiologySignatures = Array.from({ length: 16 }, (_, index) =>
      dispatchWithSeed(`experiment-seed-${index}`)
        .filter((event) => event.type === 'PhysiologyChanged')
        .map((event) => JSON.stringify(event.payload)),
    );
    expect(new Set(physiologySignatures.map((signature) => JSON.stringify(signature))).size).toBe(
      2,
    );
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

  test('pays safety net subsidies from the treasury without minting when a treasury exists', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-low-a'),
          locationId: null,
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 10,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-low-b'),
          locationId: null,
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 20,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      moneySupply: 100,
      treasury: 30,
      clock: { now: 1000, tickDurationMs: 60_000 },
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-time-treasury-safety-net',
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

    // agent-low-a draws 25 (the cap); agent-low-b then only finds 5 left in
    // the treasury for this tick.
    expect(events.map((event) => [event.sequence, event.type])).toEqual([
      [7, 'SimulationTimeAdvanced'],
      [8, 'SubsidyPaid'],
      [9, 'SubsidyPaid'],
    ]);
    expect(events[1]).toMatchObject({
      type: 'SubsidyPaid',
      payload: {
        agentId: 'agent-low-a',
        amount: 25,
        previousBalance: 10,
        nextBalance: 35,
        reason: 'safety-net',
        fundingSource: 'treasury',
      },
    });
    expect(events[2]).toMatchObject({
      type: 'SubsidyPaid',
      payload: {
        agentId: 'agent-low-b',
        amount: 5,
        previousBalance: 20,
        nextBalance: 25,
        reason: 'safety-net',
        fundingSource: 'treasury',
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-low-a']?.balance).toBe(35);
    expect(updated.agents['agent-low-b']?.balance).toBe(25);
    // Treasury-funded subsidies are transfers: the supply is unchanged.
    expect(updated.moneySupply).toBe(100);
    expect(updated.treasury).toBe(0);
  });

  test('skips safety net subsidies entirely when the treasury is depleted', () => {
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
      ],
      moneySupply: 100,
      treasury: 0,
      clock: { now: 1000, tickDurationMs: 60_000 },
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-time-depleted-treasury',
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

    expect(events.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-low-balance']?.balance).toBe(10);
    expect(updated.moneySupply).toBe(100);
    expect(updated.treasury).toBe(0);
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

  test('accumulates upkeep arrears and forces a one-tier downgrade at the threshold', () => {
    const upkeepPolicy = {
      costs: [
        { residentialTier: 1, currencyCostPerHour: 0 },
        { residentialTier: 2, currencyCostPerHour: 20 },
        { residentialTier: 3, currencyCostPerHour: 40 },
      ],
      arrearsDowngradeThresholdHours: 2,
    };
    let projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-arrears'),
          locationId: null,
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 10,
          residentialTier: 3,
          job: null,
          inventory: {},
        },
      ],
      moneySupply: 100,
      clock: { now: 0, tickDurationMs: 3_600_000 },
    });

    const advance = (tickIndex: number) =>
      dispatchWorldCommand({
        command: createCommandEnvelope({
          id: `command-time-arrears-${tickIndex}`,
          simulationId: 'sim-1',
          source: 'system',
          type: 'AdvanceSimulationTime',
          payload: { deltaMs: 3_600_000 },
          issuedAt: tickIndex * 3_600_000,
        }),
        projection,
        policies: { ...policies, residentialUpkeep: upkeepPolicy },
        nextSequence: tickIndex * 10,
      });

    // Tick 1: due 40, pays 10, arrears 30 (< 80 threshold) → arrears update only.
    const firstEvents = advance(1);
    expect(firstEvents.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'ResidentialUpkeepCharged',
      'ResidentialUpkeepArrearsUpdated',
    ]);
    projection = firstEvents.reduce(applyWorldEvent, projection);
    expect(projection.agents['agent-arrears']?.upkeepArrears).toBe(30);
    expect(projection.agents['agent-arrears']?.residentialTier).toBe(3);

    // Tick 2: balance 0, due 40 unpaid, arrears 70 (< 80) → still carrying.
    const secondEvents = advance(2);
    expect(secondEvents.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'ResidentialUpkeepCharged',
      'ResidentialUpkeepArrearsUpdated',
    ]);
    projection = secondEvents.reduce(applyWorldEvent, projection);
    expect(projection.agents['agent-arrears']?.upkeepArrears).toBe(70);

    // Tick 3: arrears 110 ≥ 40×2 → forced downgrade to tier 2, arrears cleared.
    const thirdEvents = advance(3);
    expect(thirdEvents.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'ResidentialUpkeepCharged',
      'ResidentialTierDowngraded',
      'ShortTermMemoryRecorded',
    ]);
    expect(thirdEvents[2]).toMatchObject({
      type: 'ResidentialTierDowngraded',
      payload: {
        agentId: 'agent-arrears',
        previousResidentialTier: 3,
        nextResidentialTier: 2,
        arrearsCleared: 110,
        reason: 'upkeep-arrears',
      },
    });
    projection = thirdEvents.reduce(applyWorldEvent, projection);
    expect(projection.agents['agent-arrears']?.residentialTier).toBe(2);
    expect(projection.agents['agent-arrears']?.upkeepArrears).toBe(0);

    // Tick 4: now at tier 2 (20/hour, threshold 40); arrears 20 < 40 → carry.
    const fourthEvents = advance(4);
    expect(fourthEvents.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'ResidentialUpkeepCharged',
      'ResidentialUpkeepArrearsUpdated',
    ]);
  });
});

describe('time settlement amortization', () => {
  // Buckets=2: hashAgentSettlementBucket('agent-a')%2==0, 'agent-b'%2==1.
  const amortizedPolicies: WorldCommandPolicies = {
    ...policies,
    residentialUpkeep: {
      costs: [{ residentialTier: 2, currencyCostPerHour: 3600 }],
    },
    timeSettlementAmortization: { buckets: 2 },
  };

  function createAmortizedProjection() {
    return createWorldProjection({
      agents: ['agent-a', 'agent-b'].map((id) => ({
        agentId: asAgentId(id),
        locationId: null,
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 0,
        balance: 100,
        residentialTier: 2,
        job: null,
        inventory: {},
      })),
      moneySupply: 200,
      clock: { now: 0, tickDurationMs: 1000 },
    });
  }

  test('settles each agent only on its bucket tick, charging elapsed time', () => {
    let projection = createAmortizedProjection();
    const advance = (tickIndex: number) =>
      dispatchWorldCommand({
        command: createCommandEnvelope({
          id: `command-amortized-${tickIndex}`,
          simulationId: 'sim-1',
          source: 'system',
          type: 'AdvanceSimulationTime',
          payload: { deltaMs: 1000 },
          issuedAt: tickIndex * 1000,
        }),
        projection,
        policies: amortizedPolicies,
        nextSequence: tickIndex * 10,
      });

    // Tick 1 (tickIndex 1): bucket 1 → only agent-b settles, 1s elapsed → 1 charged.
    const first = advance(1);
    expect(first.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'ResidentialUpkeepCharged',
      'AgentTimeEffectsSettled',
    ]);
    expect(first[1]).toMatchObject({
      payload: { agentId: 'agent-b', amount: 1, unpaidAmount: 0 },
    });
    projection = first.reduce(applyWorldEvent, projection);
    expect(projection.timeSettlementByAgent).toEqual({ 'agent-b': 1000 });

    // Tick 2: bucket 0 → agent-a catches up both one-second cadences from
    // simulation start, rather than losing the first second.
    const second = advance(2);
    expect(second.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'ResidentialUpkeepCharged',
      'ResidentialUpkeepCharged',
      'AgentTimeEffectsSettled',
    ]);
    expect(second[1]).toMatchObject({
      payload: { agentId: 'agent-a', amount: 1, unpaidAmount: 0 },
    });
    expect(second[2]).toMatchObject({
      payload: { agentId: 'agent-a', amount: 1, unpaidAmount: 0 },
    });
    projection = second.reduce(applyWorldEvent, projection);

    // Tick 3: agent-b catches up two discrete one-second cadences.
    const third = advance(3);
    expect(third[1]).toMatchObject({
      payload: { agentId: 'agent-b', amount: 1, unpaidAmount: 0 },
    });
    expect(third[2]).toMatchObject({
      payload: { agentId: 'agent-b', amount: 1, unpaidAmount: 0 },
    });
    projection = third.reduce(applyWorldEvent, projection);
    expect(projection.timeSettlementByAgent).toEqual({ 'agent-a': 2000, 'agent-b': 3000 });
    expect(projection.agents['agent-a']?.balance).toBe(98);
    expect(projection.agents['agent-b']?.balance).toBe(97);
    expect(projection.moneySupply).toBe(200 - 1 - 2 - 2);
  });

  test('replays stochastic illness and subsidies once per skipped cadence', () => {
    let projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-a'),
          locationId: null,
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      clock: { now: 0, tickDurationMs: 3_600_000 },
    });
    const replayPolicies: WorldCommandPolicies = {
      ...policies,
      stochasticIllness: {
        illnessProbabilityPercentPerHour: 100,
        healthDamage: 10,
        minHealth: 0,
      },
      safetyNetSubsidy: { minimumBalance: 100, maxSubsidy: 10 },
      timeSettlementAmortization: { buckets: 2 },
    };
    const advance = (tickIndex: number) =>
      dispatchWorldCommand({
        command: createCommandEnvelope({
          id: `command-discrete-amortized-${tickIndex}`,
          simulationId: 'sim-1',
          source: 'system',
          type: 'AdvanceSimulationTime',
          payload: { deltaMs: 3_600_000 },
          issuedAt: tickIndex * 3_600_000,
        }),
        projection,
        policies: replayPolicies,
        nextSequence: tickIndex * 10,
      });

    projection = advance(1).reduce(applyWorldEvent, projection);
    const second = advance(2);
    expect(second.filter((event) => event.type === 'PhysiologyChanged')).toHaveLength(2);
    expect(second.filter((event) => event.type === 'SubsidyPaid')).toHaveLength(2);
    projection = second.reduce(applyWorldEvent, projection);
    expect(projection.agents['agent-a']?.physiology.health).toBe(80);
    expect(projection.agents['agent-a']?.balance).toBe(20);
  });

  test('starts a newly registered agent at its registration time', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-a'),
          locationId: null,
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 100,
          residentialTier: 2,
          job: null,
          inventory: {},
          registration: {
            registrationId: 'registration-agent-a',
            policyVersion: 'registration-v1',
            creatorId: 'system',
            source: 'test',
            displayName: 'Agent A',
            registeredAt: 1_000,
            provenance: 'post-bootstrap-command',
          },
        },
      ],
      moneySupply: 100,
      clock: { now: 1_000, tickDurationMs: 1_000 },
    });
    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-registered-amortized',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1_000 },
        issuedAt: 2_000,
      }),
      projection,
      policies: amortizedPolicies,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'ResidentialUpkeepCharged',
      'AgentTimeEffectsSettled',
    ]);
    expect(events[1]).toMatchObject({
      payload: { agentId: 'agent-a', amount: 1, unpaidAmount: 0 },
    });
    expect(events[2]).toMatchObject({
      payload: { previousSettledAt: 1_000, nextSettledAt: 2_000 },
    });
  });
});

describe('regional land value and upkeep pricing', () => {
  const DAY_MS = 86_400_000;
  const landValuePolicy = {
    policyVersion: 'land-value-v1',
    updateCadenceMs: DAY_MS,
    baseline: 0,
    populationWeight: 2,
    liquidityWeight: 1,
    smoothingFactor: 0.4,
    minIndex: 0,
    maxIndex: 100,
  };
  const upkeepPolicyV2 = {
    policyVersion: 'residential-upkeep-v2',
    costs: [{ residentialTier: 2, currencyCostPerHour: 20 }],
    landValueCoefficientPerHour: 1,
  };

  const makeAgent = (agentId: string, locationId: ReturnType<typeof asLocationId>) => ({
    agentId: asAgentId(agentId),
    locationId,
    physiology: { energy: 80, satiety: 80, health: 90 },
    educationScore: 0,
    balance: 100_000,
    residentialTier: 2,
    job: null,
    inventory: {},
  });

  const createTwoRegionProjection = () =>
    createWorldProjection({
      locations: [
        {
          locationId: asLocationId('loc-downtown'),
          name: 'Downtown Homes',
          kind: 'residence',
          activityAffinities: [],
          capacity: null,
          regionId: 'downtown',
        },
        {
          locationId: asLocationId('loc-harbor'),
          name: 'Harbor Homes',
          kind: 'residence',
          activityAffinities: [],
          capacity: null,
          regionId: 'harbor',
        },
      ],
      agents: [
        makeAgent('agent-dt-1', asLocationId('loc-downtown')),
        makeAgent('agent-dt-2', asLocationId('loc-downtown')),
        makeAgent('agent-dt-3', asLocationId('loc-downtown')),
        makeAgent('agent-hb-1', asLocationId('loc-harbor')),
      ],
      moneySupply: 1_000_000,
      clock: { now: 0, tickDurationMs: 1000 },
    });

  const advanceCommand = (id: string, deltaMs: number, issuedAt: number) =>
    createCommandEnvelope({
      id,
      simulationId: 'sim-1',
      source: 'system',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs },
      issuedAt,
    });

  test('updates per-region land value indices on cadence and prices upkeep segments with them', () => {
    const projection = createTwoRegionProjection();

    const events = dispatchWorldCommand({
      command: advanceCommand('command-lv-1', 2 * DAY_MS, 0),
      projection,
      policies: { ...policies, residentialUpkeep: upkeepPolicyV2, landValue: landValuePolicy },
      nextSequence: 7,
    });

    const landValueEvents = events.filter((event) => event.type === 'RegionalLandValueUpdated');
    // Two crossed daily boundaries x two regions, downtown before harbor, day 1 before day 2.
    expect(
      landValueEvents.map((event) => [event.payload.regionId, event.payload.settledAt]),
    ).toEqual([
      ['downtown', DAY_MS],
      ['harbor', DAY_MS],
      ['downtown', 2 * DAY_MS],
      ['harbor', 2 * DAY_MS],
    ]);
    // Day 1: raw = 2*sqrt(count); smoothed 0.4 from baseline 0.
    expect(landValueEvents[0]?.payload).toMatchObject({
      previousIndex: 0,
      agentCount: 3,
      marketLiquidity: 0,
      policyVersion: 'land-value-v1',
      reason: 'land-value-cadence',
    });
    expect(landValueEvents[0]?.payload.nextIndex).toBeCloseTo(0.4 * 2 * Math.sqrt(3), 8);
    expect(landValueEvents[1]?.payload.nextIndex).toBeCloseTo(0.8, 8);
    // Day 2 lerps from day 1 values.
    const downtownDay1 = landValueEvents[0]?.payload.nextIndex ?? 0;
    expect(landValueEvents[2]?.payload.previousIndex).toBeCloseTo(downtownDay1, 8);

    // Charges: segment 1 (before the first boundary) is flat v1 pricing;
    // segment 2 prices each region with its day-1 index.
    const charges = events.filter((event) => event.type === 'ResidentialUpkeepCharged');
    expect(charges).toHaveLength(8);
    const downtownDayOneIndex = 0.8 * Math.sqrt(3);
    const expectedDowntownSegmentTwo = (20 + downtownDayOneIndex) * 24;
    const dt1Charges = charges.filter((event) => event.payload.agentId === 'agent-dt-1');
    expect(dt1Charges[0]?.payload.amount).toBeCloseTo(20 * 24, 8);
    expect(dt1Charges[1]?.payload.amount).toBeCloseTo(expectedDowntownSegmentTwo, 8);
    const hb1Charges = charges.filter((event) => event.payload.agentId === 'agent-hb-1');
    expect(hb1Charges[1]?.payload.amount).toBeCloseTo((20 + 0.8) * 24, 8);
    expect(dt1Charges[1]?.payload.amount).toBeGreaterThan(hb1Charges[1]?.payload.amount ?? 0);

    // Replay derives the same slice and every charge stays a money-supply burn.
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.regionalLandValues?.downtown).toBeCloseTo(
      landValueEvents[2]?.payload.nextIndex ?? Number.NaN,
      8,
    );
    expect(updated.regionalLandValues?.harbor).toBeCloseTo(
      landValueEvents[3]?.payload.nextIndex ?? Number.NaN,
      8,
    );
    const totalCharged = charges.reduce((sum, event) => sum + event.payload.amount, 0);
    expect(updated.moneySupply).toBeCloseTo(1_000_000 - totalCharged, 6);
  });

  test('prices upkeep by the region lived in: merged advance equals step-by-step across an in-advance move', () => {
    // Regression: the upkeep block used to price the WHOLE settlement
    // interval at the pre-advance region, so a merged multi-day advance
    // diverged from per-cadence settlement when a travel arrival relocated
    // the agent across regions mid-window.
    const build = () =>
      createWorldProjection({
        locations: [
          {
            locationId: asLocationId('loc-downtown'),
            name: 'Downtown Homes',
            kind: 'residence',
            activityAffinities: [],
            capacity: null,
            regionId: 'downtown',
          },
          {
            locationId: asLocationId('loc-harbor'),
            name: 'Harbor Homes',
            kind: 'residence',
            activityAffinities: [],
            capacity: null,
            regionId: 'harbor',
          },
        ],
        agents: [
          makeAgent('agent-mover', asLocationId('loc-downtown')),
          makeAgent('agent-stay', asLocationId('loc-harbor')),
          // A second harbor resident makes the regions' day-1 indices differ
          // (downtown 0.8 vs harbor 0.8*sqrt(2)), so pricing day 2 at the WRONG
          // region would numerically diverge and the test catches the bug.
          makeAgent('agent-stay-2', asLocationId('loc-harbor')),
        ],
        moneySupply: 1_000_000,
        clock: { now: 0, tickDurationMs: 1000 },
        transitByAgent: {
          'agent-mover': {
            agentId: asAgentId('agent-mover'),
            fromLocationId: asLocationId('loc-downtown'),
            toLocationId: asLocationId('loc-harbor'),
            routeLocationIds: [],
            spatialPolicyVersion: 'spatial-v1',
            baseTravelDurationSeconds: 1,
            congestionMultiplier: 1,
            travelDurationSeconds: 1,
            arrivesAt: DAY_MS,
            departedAt: 0,
            reason: 'travel',
          },
        },
      });
    const pol = { ...policies, residentialUpkeep: upkeepPolicyV2, landValue: landValuePolicy };
    const chargesOf = (events: readonly WorldEvent[], agentId: string) =>
      events
        .filter(
          (event) =>
            event.type === 'ResidentialUpkeepCharged' && event.payload.agentId === agentId,
        )
        .map((event) =>
          event.type === 'ResidentialUpkeepCharged' ? event.payload.amount : Number.NaN,
        );

    // Step-by-step: two one-day advances with the fold between them.
    const stepped = build();
    const day1 = dispatchWorldCommand({
      command: advanceCommand('command-region-step-1', DAY_MS, 0),
      projection: stepped,
      policies: pol,
      nextSequence: 1,
    });
    const afterDay1 = day1.reduce(applyWorldEvent, stepped);
    const day2 = dispatchWorldCommand({
      command: advanceCommand('command-region-step-2', DAY_MS, DAY_MS),
      projection: afterDay1,
      policies: pol,
      nextSequence: 100,
    });

    // Merged: one two-day advance from the identical projection.
    const merged = dispatchWorldCommand({
      command: advanceCommand('command-region-merged', 2 * DAY_MS, 0),
      projection: build(),
      policies: pol,
      nextSequence: 1,
    });

    for (const agentId of ['agent-mover', 'agent-stay']) {
      const stepCharges = [...chargesOf(day1, agentId), ...chargesOf(day2, agentId)];
      const mergedCharges = chargesOf(merged, agentId);
      // Multi-cadence equivalence: identical charge sequences.
      expect(mergedCharges).toEqual(stepCharges);
      expect(stepCharges).toHaveLength(2);
    }
    // The two days genuinely price in different regions for the mover: day 1
    // is flat v1 pricing (no index snapshot exists yet), day 2 prices with
    // the harbor region's day-1 land value index — without the fix the merged
    // advance priced day 2 at downtown and diverged. So the equivalence above
    // is not vacuous.
    const moverCharges = chargesOf(merged, 'agent-mover');
    expect(moverCharges[0]).toBeCloseTo(20 * 24, 6);
    expect(moverCharges[1]).not.toBeCloseTo(moverCharges[0] ?? Number.NaN, 6);
    // Harbor day-1 index: population weight 2 x sqrt(2 residents — the move
    // is not yet visible to the day-1 boundary), smoothed 0.4 from baseline 0
    // = 0.8*sqrt(2). Priced at downtown (0.8) the same segment would yield
    // (20+0.8)*24 — a visible divergence.
    expect(moverCharges[1]).toBeCloseTo((20 + 0.8 * Math.sqrt(2)) * 24, 6);
  });

  test('keeps flat v1 pricing and emits no land value events without a land value policy', () => {
    const projection = createTwoRegionProjection();

    const events = dispatchWorldCommand({
      command: advanceCommand('command-lv-2', DAY_MS, 0),
      projection,
      policies: { ...policies, residentialUpkeep: upkeepPolicyV2 },
      nextSequence: 7,
    });

    expect(events.some((event) => event.type === 'RegionalLandValueUpdated')).toBe(false);
    const charges = events.filter((event) => event.type === 'ResidentialUpkeepCharged');
    expect(charges).toHaveLength(4);
    for (const charge of charges) {
      expect(charge.payload.amount).toBeCloseTo(20 * 24, 8);
    }
  });

  test('ignores the land value index when the upkeep policy has no coefficient', () => {
    const projection = createTwoRegionProjection();

    const events = dispatchWorldCommand({
      command: advanceCommand('command-lv-3', 2 * DAY_MS, 0),
      projection,
      policies: {
        ...policies,
        residentialUpkeep: { costs: [{ residentialTier: 2, currencyCostPerHour: 20 }] },
        landValue: landValuePolicy,
      },
      nextSequence: 7,
    });

    expect(events.filter((event) => event.type === 'RegionalLandValueUpdated')).toHaveLength(4);
    const charges = events.filter((event) => event.type === 'ResidentialUpkeepCharged');
    expect(charges).toHaveLength(8);
    for (const charge of charges) {
      expect(charge.payload.amount).toBeCloseTo(20 * 24, 8);
    }
  });

  test('a merged multi-cadence advance settles identically to step-by-step advances', () => {
    const runAndCollect = (steps: readonly number[]) => {
      let projection = createTwoRegionProjection();
      const collected: { type: string; payload: unknown }[] = [];
      let nextSequence = 7;
      for (const [index, deltaMs] of steps.entries()) {
        const events = dispatchWorldCommand({
          command: advanceCommand(`command-lv-equiv-${index}`, deltaMs, 0),
          projection,
          policies: { ...policies, residentialUpkeep: upkeepPolicyV2, landValue: landValuePolicy },
          nextSequence,
        });
        nextSequence += events.length;
        for (const event of events) {
          if (
            event.type === 'RegionalLandValueUpdated' ||
            event.type === 'ResidentialUpkeepCharged'
          ) {
            collected.push({ type: event.type, payload: event.payload });
          }
        }
        projection = events.reduce(applyWorldEvent, projection);
      }
      return { collected, projection };
    };

    const merged = runAndCollect([2 * DAY_MS]);
    const stepped = runAndCollect([DAY_MS, DAY_MS]);

    // Within one advance all land value events precede the settlement charges,
    // so cross-type ordering differs from stepped runs by construction; and a
    // merged advance settles each agent's segments contiguously while stepped
    // runs interleave agents across steps. The semantic equivalence is the
    // land value payload sequence plus per-agent charge sequence identity.
    const byType = (collected: typeof merged.collected, type: string) =>
      collected.filter((event) => event.type === type);
    const chargesByAgent = (collected: typeof merged.collected) => {
      const grouped = new Map<string, unknown[]>();
      for (const event of byType(collected, 'ResidentialUpkeepCharged')) {
        const agentId = (event.payload as { agentId: string }).agentId;
        grouped.set(agentId, [...(grouped.get(agentId) ?? []), event.payload]);
      }
      return grouped;
    };
    expect(byType(merged.collected, 'RegionalLandValueUpdated')).toEqual(
      byType(stepped.collected, 'RegionalLandValueUpdated'),
    );
    expect(chargesByAgent(merged.collected)).toEqual(chargesByAgent(stepped.collected));
    expect(merged.projection.regionalLandValues).toEqual(stepped.projection.regionalLandValues);
    expect(merged.projection.moneySupply).toBe(stepped.projection.moneySupply);
    for (const agentId of ['agent-dt-1', 'agent-dt-2', 'agent-dt-3', 'agent-hb-1']) {
      expect(merged.projection.agents[agentId]?.balance).toBe(
        stepped.projection.agents[agentId]?.balance,
      );
    }
  });
});

describe('regional land value cadence regressions', () => {
  const DAY_MS = 86_400_000;

  const advance = (
    projection: ReturnType<typeof createWorldProjection>,
    id: string,
    deltaMs: number,
    policies: WorldCommandPolicies,
    nextSequence: number,
  ) =>
    dispatchWorldCommand({
      command: createCommandEnvelope({
        id,
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence,
    });

  test('evolves regional inputs at each land value boundary (merged == stepped)', () => {
    const landValuePolicy = {
      policyVersion: 'land-value-v1',
      updateCadenceMs: DAY_MS,
      baseline: 0,
      populationWeight: 0,
      liquidityWeight: 1,
      smoothingFactor: 1,
      minIndex: 0,
      maxIndex: 100,
    };
    const externalMarketPolicy = {
      policyVersion: 'external-market-test-v1',
      cadenceMs: DAY_MS,
      commodityReserveFloor: 1,
      commodityReserveCeiling: 10_000,
      currencyReserveFloor: 1000,
      currencyReserveCeiling: 100_000,
      maxAdjustmentRatioPerCadence: 1,
    };
    const testPolicies: WorldCommandPolicies = {
      ...policies,
      landValue: landValuePolicy,
      externalMarket: externalMarketPolicy,
    };
    const makeProjection = () =>
      createWorldProjection({
        agents: [],
        marketPools: [{ commodity: 'Food', commodityReserve: 10, currencyReserve: 100 }],
        clock: { now: 0, tickDurationMs: 1000 },
      });

    // Merged: one advance crossing two land value and two rebalance boundaries.
    const mergedEvents = advance(
      makeProjection(),
      'command-lv-merged',
      2 * DAY_MS,
      testPolicies,
      1,
    );
    const mergedLiquidity = mergedEvents
      .filter((event) => event.type === 'RegionalLandValueUpdated')
      .map((event) => event.payload.marketLiquidity);

    // Stepped: two daily advances; the second observes the first rebalance.
    let steppedProjection = makeProjection();
    const steppedLiquidity: number[] = [];
    let nextSequence = 1;
    for (const [index] of [0, 1].entries()) {
      const events = advance(
        steppedProjection,
        `command-lv-stepped-${index}`,
        DAY_MS,
        testPolicies,
        nextSequence,
      );
      nextSequence += events.length;
      steppedLiquidity.push(
        ...events
          .filter((event) => event.type === 'RegionalLandValueUpdated')
          .map((event) => event.payload.marketLiquidity),
      );
      steppedProjection = events.reduce(applyWorldEvent, steppedProjection);
    }

    // The first boundary sees the pre-rebalance reserve (100); the second must
    // observe the rebalance that completed at the first boundary (100 -> 200).
    expect(mergedLiquidity).toEqual([100, 200]);
    expect(mergedLiquidity).toEqual(steppedLiquidity);
  });

  test('applies arrears downgrades per priced segment (merged == stepped)', () => {
    const landValuePolicy = {
      policyVersion: 'land-value-v1',
      updateCadenceMs: DAY_MS,
      baseline: 0,
      populationWeight: 2,
      liquidityWeight: 0,
      smoothingFactor: 0.4,
      minIndex: 0,
      maxIndex: 100,
    };
    const upkeepPolicy = {
      policyVersion: 'residential-upkeep-v2',
      costs: [
        { residentialTier: 1, currencyCostPerHour: 0 },
        { residentialTier: 2, currencyCostPerHour: 20 },
        { residentialTier: 3, currencyCostPerHour: 40 },
      ],
      arrearsDowngradeThresholdHours: 2,
      landValueCoefficientPerHour: 1,
    };
    const testPolicies: WorldCommandPolicies = {
      ...policies,
      landValue: landValuePolicy,
      residentialUpkeep: upkeepPolicy,
    };
    const makeProjection = () =>
      createWorldProjection({
        agents: [
          {
            agentId: asAgentId('agent-broke'),
            locationId: null,
            physiology: { energy: 80, satiety: 80, health: 90 },
            educationScore: 0,
            balance: 0,
            residentialTier: 3,
            job: null,
            inventory: {},
          },
        ],
        moneySupply: 1000,
        clock: { now: 0, tickDurationMs: 1000 },
      });
    const collect = (events: ReturnType<typeof advance>) =>
      events
        .filter(
          (event) =>
            event.type === 'ResidentialUpkeepCharged' || event.type === 'ResidentialTierDowngraded',
        )
        .map((event) => ({ type: event.type, payload: event.payload }));

    const mergedEvents = advance(
      makeProjection(),
      'command-arrears-merged',
      2 * DAY_MS,
      testPolicies,
      1,
    );
    const mergedProjection = mergedEvents.reduce(applyWorldEvent, makeProjection());

    let steppedProjection = makeProjection();
    const steppedCollected: ReturnType<typeof collect> = [];
    let nextSequence = 1;
    for (const [index] of [0, 1].entries()) {
      const events = advance(
        steppedProjection,
        `command-arrears-stepped-${index}`,
        DAY_MS,
        testPolicies,
        nextSequence,
      );
      nextSequence += events.length;
      steppedCollected.push(...collect(events));
      steppedProjection = events.reduce(applyWorldEvent, steppedProjection);
    }

    // Segment 1 (flat tier-3 rate) crosses the arrears threshold and must
    // downgrade before segment 2 prices at tier 2 — exactly as stepped runs do.
    expect(collect(mergedEvents)).toEqual(steppedCollected);
    expect(mergedProjection.agents['agent-broke']?.residentialTier).toBe(1);
    expect(steppedProjection.agents['agent-broke']?.residentialTier).toBe(1);
  });
});

describe('town wellbeing settlement', () => {
  const wellbeingPolicy: WellbeingPolicy = {
    policyVersion: 'town-wellbeing-v1',
    initialValue: 50,
    minValue: 0,
    maxValue: 100,
    baseline: 50,
    convergencePerHour: 2,
    coefficients: {
      health: 10,
      energy: 6,
      satiety: 6,
      employed: 4,
      unemployed: -6,
      residentialTier: [0, -4, -2, 0, 2, 4, 6],
      lifestyleTier: [-6, -2, 2, 6],
      upkeepArrearsPerUnit: -0.5,
      distress: -8,
      positiveRelation: 6,
      negativeRelation: -8,
    },
  };
  const wellbeingPolicies: WorldCommandPolicies = { ...policies, wellbeing: wellbeingPolicy };

  function createWellbeingProjection() {
    return createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-wellbeing'),
          locationId: null,
          physiology: { energy: 50, satiety: 50, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 3,
          job: 'Farmer',
          inventory: {},
        },
      ],
      clock: { now: 0, tickDurationMs: 3_600_000 },
    });
  }

  function advanceWellbeing(
    projection: WorldProjection,
    tickIndex: number,
    overridePolicies: WorldCommandPolicies = wellbeingPolicies,
  ) {
    return dispatchWorldCommand({
      command: createCommandEnvelope({
        id: `command-wellbeing-${tickIndex}`,
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 3_600_000 },
        issuedAt: tickIndex * 3_600_000,
      }),
      projection,
      policies: overridePolicies,
      nextSequence: tickIndex * 10,
    });
  }

  function wellbeingChangedPayload(event: WorldEvent | undefined) {
    if (event?.type !== 'WellbeingChanged') {
      throw new Error('expected a WellbeingChanged event');
    }
    return event.payload;
  }

  test('settles the durable value toward the factor target and stops at the fixed point', () => {
    const initial = createWellbeingProjection();
    let projection = initial;
    const allEvents: WorldEvent[] = [];

    // target = 50 + 10 (health 100) + 4 (employed) = 64; convergencePerHour 2.
    const first = advanceWellbeing(projection, 1);
    expect(first.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'WellbeingChanged',
    ]);
    const firstPayload = wellbeingChangedPayload(first[1]);
    expect(firstPayload).toMatchObject({
      agentId: 'agent-wellbeing',
      previous: 50,
      next: 52,
      target: 64,
      policyVersion: 'town-wellbeing-v1',
      settledAt: 3_600_000,
      reason: 'time-settlement',
    });
    expect(firstPayload.factorContributions).toMatchObject({ health: 10, employment: 4 });
    allEvents.push(...first);
    projection = first.reduce(applyWorldEvent, projection);
    expect(projection.agents['agent-wellbeing']?.wellbeing).toBe(52);

    // Ticks 2..7 converge 54, 56, ..., 64; the last step snaps onto the target.
    for (let tick = 2; tick <= 7; tick += 1) {
      const events = advanceWellbeing(projection, tick);
      expect(events.map((event) => event.type)).toEqual([
        'SimulationTimeAdvanced',
        'WellbeingChanged',
      ]);
      allEvents.push(...events);
      projection = events.reduce(applyWorldEvent, projection);
    }
    expect(projection.agents['agent-wellbeing']?.wellbeing).toBe(64);

    // Fixed point reached: further advances emit no more WellbeingChanged.
    const quiet = advanceWellbeing(projection, 8);
    expect(quiet.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
    allEvents.push(...quiet);
    projection = quiet.reduce(applyWorldEvent, projection);
    expect(projection.agents['agent-wellbeing']?.wellbeing).toBe(64);

    // Replaying the recorded event stream from scratch reproduces the same
    // projection state (the projection switch is the only replay defense).
    const replayed = allEvents.reduce(applyWorldEvent, initial);
    expect(replayed.agents['agent-wellbeing']?.wellbeing).toBe(64);
    expect(replayed.agents).toEqual(projection.agents);
  });

  test('is deterministic: redispatching the same command yields identical events', () => {
    const projection = createWellbeingProjection();
    const command = createCommandEnvelope({
      id: 'command-wellbeing-determinism',
      simulationId: 'sim-1',
      source: 'system',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs: 3_600_000 },
      issuedAt: 3_600_000,
    });
    const first = dispatchWorldCommand({
      command,
      projection,
      policies: wellbeingPolicies,
      nextSequence: 7,
    });
    const second = dispatchWorldCommand({
      command,
      projection,
      policies: wellbeingPolicies,
      nextSequence: 7,
    });
    expect(second).toEqual(first);
  });

  test('reads this tick’s post-effect physiology from the running settlement state', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-exhausted'),
          locationId: null,
          physiology: { energy: 10, satiety: 50, health: 90 },
          educationScore: 0,
          balance: 0,
          residentialTier: 3,
          job: null,
          inventory: {},
        },
      ],
      clock: { now: 0, tickDurationMs: 3_600_000 },
    });
    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-wellbeing-physiology',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 3_600_000 },
        issuedAt: 3_600_000,
      }),
      projection,
      policies: {
        ...wellbeingPolicies,
        sleepDeprivation: { energyThreshold: 20, healthDecayPerSecond: 0.5, minHealth: 10 },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'PhysiologyChanged',
      'WellbeingChanged',
    ]);
    // Sleep deprivation settled first: health 90 -> 10 (decay 0.5/s over 1h,
    // floored at minHealth). Wellbeing reads the decayed value this same tick:
    // target = 50 - 8 (health 10) - 4.8 (energy 10) - 6 (unemployed) = 31.2.
    const payload = wellbeingChangedPayload(events[2]);
    expect(payload).toMatchObject({
      agentId: 'agent-exhausted',
      previous: 50,
      next: 48,
      target: 31.2,
    });
    expect(payload.factorContributions).toMatchObject({
      health: -8,
      energy: -4.8,
      employment: -6,
    });
  });

  test('reads a distress transition from this interval immediately, not one interval late', () => {
    // Regression: wellbeing used to read the pre-fold projection state, so a
    // distress started by this interval's safety net only hit the target on
    // the NEXT interval. The batch scan sees it immediately.
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-wellbeing'),
          locationId: null,
          physiology: { energy: 50, satiety: 25, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 3,
          job: 'Farmer',
          inventory: {},
        },
      ],
      clock: { now: 0, tickDurationMs: 3_600_000 },
    });
    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-wellbeing-distress-freshness',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 3_600_000 },
        issuedAt: 0,
      }),
      projection,
      policies: {
        ...wellbeingPolicies,
        calendar: {
          policyVersion: 'town-calendar-v1',
          dayLengthMs: 86_400_000,
          phases: [{ phase: 'day', startFraction: 0 }],
          physiologicalDecay: { energyPerHour: 6.25, satietyPerHour: 12.5 },
        },
        physiologicalSafetyNet: {
          policyVersion: 'physiological-safety-net-v1',
          criticalThresholds: { satiety: 20, energy: 20, health: 20 },
          persistenceDurationMs: 0,
          grantCooldownMs: Number.MAX_SAFE_INTEGER,
          essentialInventoryTargets: { Apple: 1 },
        },
      },
      nextSequence: 1,
    });
    // The passive decay drains satiety to 0 within the tick; the safety net
    // flags distress in the SAME interval and the wellbeing target must
    // include the distress coefficient now instead of one interval late.
    const distressEvent = events.find(
      (event) =>
        event.type === 'PhysiologicalDistressChanged' &&
        event.payload.agentId === 'agent-wellbeing' &&
        event.payload.status === 'active',
    );
    expect(distressEvent).toBeDefined();
    const wellbeingEvent = events.find(
      (event) => event.type === 'WellbeingChanged' && event.payload.agentId === 'agent-wellbeing',
    );
    if (wellbeingEvent?.type !== 'WellbeingChanged') throw new Error('unreachable');
    expect(wellbeingEvent.payload.factorContributions).toMatchObject({ distress: -8 });
  });

  test('factors in only the agent’s own outgoing social relations', () => {
    const relation = (
      sourceAgentId: string,
      targetAgentId: string,
      relationScore: number,
      relationLabel: 'strained' | 'friend' | 'best-friend',
    ) => ({
      sourceAgentId: asAgentId(sourceAgentId),
      targetAgentId: asAgentId(targetAgentId),
      relationScore,
      attitudeScore: 0,
      relationLabel,
      interactionCount: 1,
      lastInteractionSummary: null,
    });
    const projection = createWorldProjection({
      agents: ['agent-a', 'agent-b', 'agent-c'].map((agentId) => ({
        agentId: asAgentId(agentId),
        locationId: null,
        physiology: { energy: 50, satiety: 50, health: 50 },
        educationScore: 0,
        balance: 0,
        residentialTier: 1,
        job: null,
        inventory: {},
      })),
      socialRelations: [
        relation('agent-a', 'agent-b', 0.5, 'friend'),
        relation('agent-a', 'agent-c', -0.25, 'strained'),
        // Incoming relations of agent-a and ties of other agents never count.
        relation('agent-b', 'agent-a', 0.9, 'best-friend'),
      ],
      clock: { now: 0, tickDurationMs: 3_600_000 },
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-wellbeing-relations',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 3_600_000 },
        issuedAt: 3_600_000,
      }),
      projection,
      policies: wellbeingPolicies,
      nextSequence: 1,
    });

    const agentA = wellbeingChangedPayload(
      events.find(
        (event) => event.type === 'WellbeingChanged' && event.payload.agentId === 'agent-a',
      ),
    );
    // target = 50 - 6 (unemployed) - 4 (tier 1) + 6 * 0.5 - 8 * 0.25 = 41.
    expect(agentA).toMatchObject({ previous: 50, next: 48, target: 41 });
    expect(agentA.factorContributions).toMatchObject({
      positiveRelation: 3,
      negativeRelation: -2,
    });
    // agent-b's own outgoing relation (b -> a, 0.9) drives its positive factor:
    // target = 50 - 6 - 4 + 6 * 0.9 = 45.4. Incoming relations of agent-a
    // never leak into agent-a's factors.
    const agentB = wellbeingChangedPayload(
      events.find(
        (event) => event.type === 'WellbeingChanged' && event.payload.agentId === 'agent-b',
      ),
    );
    expect(agentB).toMatchObject({ target: 45.4 });
    expect(agentB.factorContributions).toMatchObject({
      positiveRelation: 5.4,
      negativeRelation: 0,
    });
    // agent-c has no outgoing relations: both relation factors price at 0 and
    // target = 50 - 6 - 4 = 40.
    const agentC = wellbeingChangedPayload(
      events.find(
        (event) => event.type === 'WellbeingChanged' && event.payload.agentId === 'agent-c',
      ),
    );
    expect(agentC).toMatchObject({ target: 40 });
    expect(agentC.factorContributions).toMatchObject({
      positiveRelation: 0,
      negativeRelation: 0,
    });
  });

  test('derives the lifestyle factor with the shared lifestyle policy when present', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-poor'),
          locationId: null,
          physiology: { energy: 50, satiety: 50, health: 50 },
          educationScore: 0,
          balance: 0,
          residentialTier: 3,
          job: 'Farmer',
          inventory: {},
        },
      ],
      clock: { now: 0, tickDurationMs: 3_600_000 },
    });
    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-wellbeing-lifestyle',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 3_600_000 },
        issuedAt: 3_600_000,
      }),
      projection,
      policies: {
        ...wellbeingPolicies,
        lifestyle: {
          policyVersion: 'lifestyle-v1',
          netWorthBoundaries: [100, 1000, 10_000],
          strugglingNonSurvivalSpendCapRatio: 0.3,
          source: 'test',
        },
      },
      nextSequence: 1,
    });

    // Net worth 0 → struggling (-6); target = 50 + 4 (employed) - 6 = 48 and
    // the remaining gap (2) fits the per-hour step, so the value snaps on.
    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'WellbeingChanged',
    ]);
    const payload = wellbeingChangedPayload(events[1]);
    expect(payload).toMatchObject({
      agentId: 'agent-poor',
      previous: 50,
      next: 48,
      target: 48,
    });
    expect(payload.factorContributions).toMatchObject({ lifestyleTier: -6 });
  });

  test('settles identically with single-bucket amortization', () => {
    const amortizedPolicies: WorldCommandPolicies = {
      ...wellbeingPolicies,
      timeSettlementAmortization: { buckets: 1 },
    };
    const collect = (events: ReturnType<typeof advanceWellbeing>) =>
      events
        .filter((event) => event.type === 'WellbeingChanged')
        .map((event) => event.payload);

    let plain = createWellbeingProjection();
    let amortized = createWellbeingProjection();
    const plainPayloads: unknown[] = [];
    const amortizedPayloads: unknown[] = [];
    for (let tick = 1; tick <= 3; tick += 1) {
      const plainEvents = advanceWellbeing(plain, tick);
      plainPayloads.push(...collect(plainEvents));
      plain = plainEvents.reduce(applyWorldEvent, plain);
      const amortizedEvents = advanceWellbeing(amortized, tick, amortizedPolicies);
      amortizedPayloads.push(...collect(amortizedEvents));
      amortized = amortizedEvents.reduce(applyWorldEvent, amortized);
    }

    expect(amortizedPayloads).toEqual(plainPayloads);
    expect(amortized.agents['agent-wellbeing']?.wellbeing).toBe(
      plain.agents['agent-wellbeing']?.wellbeing,
    );
  });
});

describe('town out-migration settlement', () => {
  const HOUR_MS = 3_600_000;
  // One 24h window as a single cadence chunk: the CS2 shape peaks near
  // 14%/h at wellbeing 0, so a full day saturates past 100% and the
  // departure becomes test-certain (the cap never binds at 100).
  const DAY_WINDOW_MS = 24 * HOUR_MS;
  const migrationPolicy = {
    policyVersion: 'town-migration-v1',
    maxProbabilityPerHour: 100,
    fallbackWellbeing: 50,
    settlementCadenceMs: DAY_WINDOW_MS,
  };
  const migrationPolicies = { ...policies, migration: migrationPolicy };

  function migrant(overrides: Record<string, unknown> = {}) {
    return {
      agentId: asAgentId('agent-unhappy'),
      locationId: null,
      physiology: { energy: 50, satiety: 50, health: 100 },
      educationScore: 0,
      balance: 120,
      residentialTier: 1,
      job: null,
      inventory: { Bread: 3 },
      wellbeing: 0,
      ...overrides,
    };
  }

  function advanceDay(
    projection: WorldProjection,
    tickIndex: number,
    overridePolicies: WorldCommandPolicies = migrationPolicies,
  ) {
    return dispatchWorldCommand({
      command: createCommandEnvelope({
        id: `command-migration-${tickIndex}`,
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: DAY_WINDOW_MS },
        issuedAt: tickIndex * DAY_WINDOW_MS,
      }),
      projection,
      policies: overridePolicies,
      nextSequence: tickIndex * 10,
    });
  }

  test('a persistently unhappy agent leaves with the full estate liquidation', () => {
    const projection = createWorldProjection({
      agents: [
        migrant(),
        {
          ...migrant({ balance: 10 }),
          agentId: asAgentId('agent-content'),
          wellbeing: 75,
        },
      ],
      bank: {
        balance: 1000,
        deposits: { 'agent-unhappy': 200 },
        loans: {
          'loan-m': {
            loanId: asLoanId('loan-m'),
            borrowerAgentId: asAgentId('agent-unhappy'),
            principal: 150,
            dailyInterestRate: 0.01,
            termDays: 30,
            issuedAt: 0,
            accruedInterest: 5,
            lastAccrualAt: 0,
            missedPayments: 0,
            status: 'active',
          },
        },
        creditHistoryByAgent: {},
      },
      clock: { now: 0, tickDurationMs: HOUR_MS },
    });
    const moneySupplyBefore = projection.moneySupply;

    const events = advanceDay(projection, 1);
    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'LoanWrittenOff',
      'DepositForfeited',
      'AgentEmigrated',
    ]);
    expect(events[3]).toMatchObject({
      type: 'AgentEmigrated',
      payload: {
        agentId: 'agent-unhappy',
        cause: 'dissatisfaction',
        emigratedAt: DAY_WINDOW_MS,
        wellbeing: 0,
        policyVersion: 'town-migration-v1',
        estate: {
          burnedCurrency: 120,
          inventoryByCommodity: { Bread: 3 },
          depositForfeited: 200,
          writtenOffLoanIds: ['loan-m'],
        },
      },
    });

    const settled = events.reduce(applyWorldEvent, projection);
    expect(settled.agents['agent-unhappy']).toBeUndefined();
    expect(settled.agents['agent-content']).toBeDefined();
    // Credit ops are book-only; only the estate burn leaves the economy.
    expect(settled.moneySupply).toBe(moneySupplyBefore - 120);
    expect(settled.bank?.balance).toBe(1000);
    expect(settled.bank?.deposits).toEqual({});

    // The departed stay gone; the content agent never leaves.
    const next = advanceDay(settled, 2);
    expect(next.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
  });

  test('content agents, unset wellbeing, and flag-off runs never migrate', () => {
    const contentProjection = createWorldProjection({
      agents: [migrant({ wellbeing: 75 })],
      clock: { now: 0, tickDurationMs: HOUR_MS },
    });
    expect(
      advanceDay(contentProjection, 1).some((event) => event.type === 'AgentEmigrated'),
    ).toBe(false);

    // Without the settled scalar the policy fallback (50) keeps the town
    // closed — the interlock with town-wellbeing is explicit.
    const noWellbeingProjection = createWorldProjection({
      agents: [migrant({ wellbeing: undefined })],
      clock: { now: 0, tickDurationMs: HOUR_MS },
    });
    expect(
      advanceDay(noWellbeingProjection, 1).some((event) => event.type === 'AgentEmigrated'),
    ).toBe(false);

    // Without the migration policy the advance stays byte-for-byte legacy.
    const flagOff = advanceDay(
      createWorldProjection({
        agents: [migrant()],
        clock: { now: 0, tickDurationMs: HOUR_MS },
      }),
      1,
      policies,
    );
    expect(flagOff.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
  });

  test('is deterministic: redispatching the same command yields identical events', () => {
    const build = () =>
      createWorldProjection({
        agents: [migrant()],
        clock: { now: 0, tickDurationMs: HOUR_MS },
      });
    const command = createCommandEnvelope({
      id: 'command-migration-determinism',
      simulationId: 'sim-1',
      source: 'system',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs: DAY_WINDOW_MS },
      issuedAt: 0,
    });
    const first = dispatchWorldCommand({
      command,
      projection: build(),
      policies: migrationPolicies,
      nextSequence: 7,
    });
    const second = dispatchWorldCommand({
      command,
      projection: build(),
      policies: migrationPolicies,
      nextSequence: 7,
    });
    expect(second).toEqual(first);
    expect(first.some((event) => event.type === 'AgentEmigrated')).toBe(true);
  });
});



describe('town calendar and passive decay', () => {
  const DAY = 86_400_000;
  const calendarPolicy: TownCalendarPolicy = {
    policyVersion: 'town-calendar-v1',
    dayLengthMs: DAY,
    phases: [
      { phase: 'night', startFraction: 0 },
      { phase: 'dawn', startFraction: 0.175 },
      { phase: 'day', startFraction: 0.3 },
      { phase: 'dusk', startFraction: 0.8 },
      { phase: 'evening', startFraction: 0.875 },
    ],
    physiologicalDecay: { energyPerHour: 6.25, satietyPerHour: 12.5 },
  };
  const calendarPolicies: WorldCommandPolicies = { ...policies, calendar: calendarPolicy };

  function advanceCalendar(
    projection: WorldProjection,
    commandId: string,
    deltaMs: number,
    issuedAt: number,
    overridePolicies: WorldCommandPolicies = calendarPolicies,
  ) {
    return dispatchWorldCommand({
      command: createCommandEnvelope({
        id: commandId,
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs },
        issuedAt,
      }),
      projection,
      policies: overridePolicies,
      nextSequence: 1,
    });
  }

  test('emits one TownDayPhaseChanged per crossed phase start, in order, with exact times', () => {
    const projection = createWorldProjection({
      agents: [],
      clock: { now: 0, tickDurationMs: DAY },
    });
    const events = advanceCalendar(projection, 'command-calendar-day', DAY, DAY);

    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'TownDayPhaseChanged',
      'TownDayPhaseChanged',
      'TownDayPhaseChanged',
      'TownDayPhaseChanged',
      'TownDayPhaseChanged',
    ]);
    const transitions = events.slice(1).map((event) => event.payload);
    expect(transitions).toEqual([
      {
        policyVersion: 'town-calendar-v1',
        dayIndex: 0,
        previousPhase: 'night',
        phase: 'dawn',
        startedAtMs: 15_120_000,
        endsAtMs: 25_920_000,
      },
      {
        policyVersion: 'town-calendar-v1',
        dayIndex: 0,
        previousPhase: 'dawn',
        phase: 'day',
        startedAtMs: 25_920_000,
        endsAtMs: 69_120_000,
      },
      {
        policyVersion: 'town-calendar-v1',
        dayIndex: 0,
        previousPhase: 'day',
        phase: 'dusk',
        startedAtMs: 69_120_000,
        endsAtMs: 75_600_000,
      },
      {
        policyVersion: 'town-calendar-v1',
        dayIndex: 0,
        previousPhase: 'dusk',
        phase: 'evening',
        startedAtMs: 75_600_000,
        endsAtMs: 86_400_000,
      },
      {
        policyVersion: 'town-calendar-v1',
        dayIndex: 1,
        previousPhase: 'evening',
        phase: 'night',
        startedAtMs: 86_400_000,
        endsAtMs: 101_520_000,
      },
    ]);

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.calendar).toEqual({ dayIndex: 1, phase: 'night', since: 86_400_000 });

    // Replaying the recorded stream reproduces the slice; redispatching the
    // same command regenerates the identical events (pure clock function).
    const replayed = events.reduce(applyWorldEvent, createWorldProjection({
      agents: [],
      clock: { now: 0, tickDurationMs: DAY },
    }));
    expect(replayed.calendar).toEqual(updated.calendar);
    expect(
      advanceCalendar(
        createWorldProjection({ agents: [], clock: { now: 0, tickDurationMs: DAY } }),
        'command-calendar-day',
        DAY,
        DAY,
      ),
    ).toEqual(events);
  });

  test('treats phase boundaries as half-open: exact-at-to emits, exact-at-from does not', () => {
    const base = () =>
      createWorldProjection({ agents: [], clock: { now: 0, tickDurationMs: 1000 } });

    // Advance exactly onto the dawn boundary: the transition is reached.
    const onto = advanceCalendar(base(), 'command-calendar-boundary', 15_120_000, 15_120_000);
    expect(onto.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'TownDayPhaseChanged',
    ]);

    // Advance one millisecond short of it: nothing yet.
    const short = advanceCalendar(base(), 'command-calendar-short', 15_119_999, 15_119_999);
    expect(short.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);

    // A later advance starting exactly at the boundary does not re-emit it.
    const settled = onto.reduce(applyWorldEvent, base());
    const next = createWorldProjection({
      agents: [],
      clock: { now: 15_120_000, tickDurationMs: 1000 },
      ...(settled.calendar === undefined ? {} : { calendar: settled.calendar }),
    });
    const after = advanceCalendar(next, 'command-calendar-after', 1000, 15_121_000);
    expect(after.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
  });

  test('applies passive decay linearly per tick, floored at zero, health untouched', () => {
    const makeProjection = () =>
      createWorldProjection({
        agents: [
          {
            agentId: asAgentId('agent-decay'),
            locationId: null,
            physiology: { energy: 100, satiety: 5, health: 90 },
            educationScore: 0,
            balance: 0,
            residentialTier: 1,
            job: null,
            inventory: {},
          },
        ],
        clock: { now: 0, tickDurationMs: 3_600_000 },
      });

    const events = advanceCalendar(
      makeProjection(),
      'command-calendar-decay',
      3_600_000,
      3_600_000,
    );
    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'PhysiologyChanged',
    ]);
    expect(events[1]).toMatchObject({
      type: 'PhysiologyChanged',
      payload: {
        agentId: 'agent-decay',
        previous: { energy: 100, satiety: 5, health: 90 },
        next: { energy: 93.75, satiety: 0, health: 90 },
        reason: 'passive-decay',
      },
    });
    const updated = events.reduce(applyWorldEvent, makeProjection());
    expect(updated.agents['agent-decay']?.physiology).toEqual({
      energy: 93.75,
      satiety: 0,
      health: 90,
    });

    // A merged two-hour advance equals two stepped one-hour advances exactly
    // (the decay is strictly additive, including across the zero floor).
    const merged = advanceCalendar(
      makeProjection(),
      'command-calendar-decay-merged',
      7_200_000,
      7_200_000,
    ).reduce(applyWorldEvent, makeProjection());
    let stepped = makeProjection();
    stepped = advanceCalendar(stepped, 'command-calendar-decay-step-1', 3_600_000, 3_600_000).reduce(
      applyWorldEvent,
      stepped,
    );
    stepped = advanceCalendar(stepped, 'command-calendar-decay-step-2', 3_600_000, 7_200_000).reduce(
      applyWorldEvent,
      stepped,
    );
    expect(stepped.agents['agent-decay']?.physiology).toEqual(
      merged.agents['agent-decay']?.physiology,
    );
  });

  test('feeds the decayed axes into the same tick’s wellbeing settlement', () => {
    const wellbeingPolicy: WellbeingPolicy = {
      policyVersion: 'town-wellbeing-v1',
      initialValue: 50,
      minValue: 0,
      maxValue: 100,
      baseline: 50,
      convergencePerHour: 2,
      coefficients: {
        health: 10,
        energy: 6,
        satiety: 6,
        employed: 4,
        unemployed: -6,
        residentialTier: [0, -4, -2, 0, 2, 4, 6],
        lifestyleTier: [-6, -2, 2, 6],
        upkeepArrearsPerUnit: -0.5,
        distress: -8,
        positiveRelation: 6,
        negativeRelation: -8,
      },
    };
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-linked'),
          locationId: null,
          physiology: { energy: 100, satiety: 100, health: 50 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      clock: { now: 0, tickDurationMs: 3_600_000 },
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-calendar-wellbeing',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 3_600_000 },
        issuedAt: 3_600_000,
      }),
      projection,
      policies: { ...calendarPolicies, wellbeing: wellbeingPolicy },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'PhysiologyChanged',
      'WellbeingChanged',
    ]);
    // Decay settled first: energy 100 -> 93.75 (+5.25), satiety 100 -> 87.5
    // (+4.5); target = 50 + 5.25 + 4.5 - 6 (unemployed) - 4 (tier 1) = 49.75,
    // and the 0.25 gap snaps inside the 2-point hourly step.
    const wellbeingEvent = events[2];
    if (wellbeingEvent?.type !== 'WellbeingChanged') {
      throw new Error('expected a WellbeingChanged event');
    }
    expect(wellbeingEvent.payload).toMatchObject({ previous: 50, next: 49.75, target: 49.75 });
    expect(wellbeingEvent.payload.factorContributions).toMatchObject({
      energy: 5.25,
      satiety: 4.5,
    });
  });

  test('settles decay identically across amortization buckets', () => {
    const makeProjection = () =>
      createWorldProjection({
        agents: ['agent-a', 'agent-b'].map((id) => ({
          agentId: asAgentId(id),
          locationId: null,
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        })),
        clock: { now: 0, tickDurationMs: 3_600_000 },
      });

    // Non-amortized reference: both agents settle every hourly tick; capture
    // the physiology after each tick.
    let plain = makeProjection();
    const plainByTick = [];
    for (let tick = 1; tick <= 4; tick += 1) {
      plain = advanceCalendar(
        plain,
        `command-plain-${tick}`,
        3_600_000,
        tick * 3_600_000,
      ).reduce(applyWorldEvent, plain);
      plainByTick.push({
        a: plain.agents['agent-a']?.physiology,
        b: plain.agents['agent-b']?.physiology,
      });
    }

    // Buckets=2 staggers settlement (agent-a on even ticks, agent-b on odd
    // ticks); each settlement replays the missed one-hour intervals one by
    // one, so an agent caught up through hour H must match the plain run at H.
    const amortizedPolicies: WorldCommandPolicies = {
      ...calendarPolicies,
      timeSettlementAmortization: { buckets: 2 },
    };
    let amortized = makeProjection();
    const amortizedByTick = [];
    for (let tick = 1; tick <= 4; tick += 1) {
      amortized = advanceCalendar(
        amortized,
        `command-amortized-${tick}`,
        3_600_000,
        tick * 3_600_000,
        amortizedPolicies,
      ).reduce(applyWorldEvent, amortized);
      amortizedByTick.push({
        a: amortized.agents['agent-a']?.physiology,
        b: amortized.agents['agent-b']?.physiology,
        settledA: amortized.timeSettlementByAgent?.['agent-a'],
        settledB: amortized.timeSettlementByAgent?.['agent-b'],
      });
    }

    // agent-b settled odd ticks: after tick 1 and 2 it is caught up through
    // hour 1, after tick 3 and 4 through hour 3.
    expect(amortizedByTick[0]?.settledB).toBe(3_600_000);
    expect(amortizedByTick[1]?.b).toEqual(plainByTick[0]?.b);
    expect(amortizedByTick[3]?.b).toEqual(plainByTick[2]?.b);
    // agent-a settled even ticks: through hour 2 by tick 2, hour 4 by tick 4.
    expect(amortizedByTick[1]?.a).toEqual(plainByTick[1]?.a);
    expect(amortizedByTick[3]?.a).toEqual(plainByTick[3]?.a);
    expect(plainByTick[3]?.a).toEqual({ energy: 75, satiety: 50, health: 100 });
  });
});

describe('town lifecycle settlement', () => {
  const DAY_MS = 3_600_000; // one tick = one simulation day
  const lifecyclePolicy: LifecyclePolicy = {
    policyVersion: 'town-lifecycle-v1',
    dayLengthMs: DAY_MS,
    stageThresholdsDays: { teen: 15, adult: 21, elderly: 22 },
    minLifespanDays: 90,
    maxLifespanDays: 130,
    illnessDeathHealthThreshold: 30,
    illnessDeathProbabilityPerSettlementScale: 20,
    pensionPerHour: 1,
    // Test grid: one tick = one cadence chunk, so single-tick advances are
    // already per-cadence; the equivalence test below uses a finer grid.
    settlementCadenceMs: DAY_MS,
  };
  const lifecyclePolicies: WorldCommandPolicies = {
    ...policies,
    lifecycle: lifecyclePolicy,
  };

  function lifecycleAgent(overrides: Partial<Parameters<typeof createWorldProjection>[0]['agents'][number]> = {}) {
    return {
      agentId: asAgentId('agent-citizen'),
      locationId: null,
      physiology: { energy: 50, satiety: 50, health: 100 },
      educationScore: 0,
      balance: 0,
      residentialTier: 1,
      job: null,
      inventory: {},
      ...overrides,
    };
  }

  function advance(
    projection: WorldProjection,
    tickIndex: number,
    overridePolicies: WorldCommandPolicies = lifecyclePolicies,
  ) {
    return dispatchWorldCommand({
      command: createCommandEnvelope({
        id: `command-lifecycle-${tickIndex}`,
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: DAY_MS },
        issuedAt: tickIndex * DAY_MS,
      }),
      projection,
      policies: overridePolicies,
      nextSequence: tickIndex * 10,
    });
  }

  test('ages into elderly, forces retirement, and pays the treasury pension', () => {
    // Registered agents count age from the adult threshold; with no
    // registration fact the agent counts from simulation time 0, so one tick
    // in makes them 22 days old — elderly.
    let projection = createWorldProjection({
      agents: [lifecycleAgent({ job: 'Farmer', balance: 100 })],
      treasury: 1000,
      clock: { now: 0, tickDurationMs: DAY_MS },
    });
    const moneySupplyBefore = projection.moneySupply;

    const first = advance(projection, 1);
    expect(first.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'AgentAged',
      'AgentRetired',
    ]);
    expect(first[1]).toMatchObject({
      type: 'AgentAged',
      payload: {
        agentId: 'agent-citizen',
        previousStage: 'adult',
        nextStage: 'elderly',
        ageDays: 22,
        changedAt: DAY_MS,
        policyVersion: 'town-lifecycle-v1',
        reason: 'aging',
      },
    });
    expect(first[2]).toMatchObject({
      type: 'AgentRetired',
      payload: {
        agentId: 'agent-citizen',
        previousJob: 'Farmer',
        retiredAtMs: DAY_MS,
        reason: 'forced-retirement',
      },
    });
    projection = first.reduce(applyWorldEvent, projection);
    expect(projection.agents['agent-citizen']).toMatchObject({
      lifeStage: 'elderly',
      job: null,
      retiredAtMs: DAY_MS,
    });

    // Pension accrues from the interval AFTER the retirement interval; a
    // treasury-funded pension is a transfer (supply unchanged).
    const second = advance(projection, 2);
    expect(second.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'PensionPaid',
    ]);
    expect(second[1]).toMatchObject({
      type: 'PensionPaid',
      payload: {
        agentId: 'agent-citizen',
        amount: 1,
        previousBalance: 100,
        nextBalance: 101,
        fundingSource: 'treasury',
        pensionPerHour: 1,
        reason: 'retirement-pension',
      },
    });
    projection = second.reduce(applyWorldEvent, projection);
    expect(projection.agents['agent-citizen']?.balance).toBe(101);
    expect(projection.treasury).toBe(999);
    expect(projection.moneySupply).toBe(moneySupplyBefore);
  });

  test('clamps the pension to the remaining treasury balance', () => {
    let projection = createWorldProjection({
      agents: [
        lifecycleAgent({
          job: null,
          retiredAtMs: 0,
          lifeStage: 'elderly',
          balance: 10,
        }),
      ],
      treasury: 0.5,
      clock: { now: 0, tickDurationMs: DAY_MS },
    });
    const first = advance(projection, 1);
    expect(first.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'PensionPaid',
    ]);
    expect(first[1]).toMatchObject({
      payload: { amount: 0.5, previousBalance: 10, nextBalance: 10.5 },
    });
    projection = first.reduce(applyWorldEvent, projection);
    expect(projection.treasury).toBe(0);
    // Treasury exhausted: no further pension until it refills.
    const second = advance(projection, 2);
    expect(second.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
  });

  test('mints the pension when the projection carries no treasury slice', () => {
    let projection = createWorldProjection({
      agents: [
        lifecycleAgent({
          job: null,
          retiredAtMs: 0,
          lifeStage: 'elderly',
          balance: 10,
        }),
      ],
      clock: { now: 0, tickDurationMs: DAY_MS },
    });
    const moneySupplyBefore = projection.moneySupply;
    const first = advance(projection, 1);
    expect(first[1]).toMatchObject({
      type: 'PensionPaid',
      payload: { amount: 1, fundingSource: 'mint', nextBalance: 11 },
    });
    projection = first.reduce(applyWorldEvent, projection);
    expect(projection.moneySupply).toBe(moneySupplyBefore + 1);
  });

  test('retirement releases every enterprise membership', () => {
    const enterprise = {
      enterpriseId: 'ent-1',
      name: 'Town Farm',
      ownerAgentId: asAgentId('agent-owner'),
      occupationName: 'Farmer',
      balance: 500,
      inventory: {},
      maxEmployees: 4,
      employeeAgentIds: [asAgentId('agent-owner'), asAgentId('agent-citizen')],
      status: 'active' as const,
      foundedAt: 0,
      cumulativeSales: 0,
      cumulativePurchases: 0,
      cumulativeWages: 0,
    };
    const projection = createWorldProjection({
      agents: [
        lifecycleAgent({ job: 'Farmer' }),
        lifecycleAgent({ agentId: asAgentId('agent-owner'), job: 'Farmer' }),
      ],
      enterprises: [enterprise],
      clock: { now: 0, tickDurationMs: DAY_MS },
    });
    // Both members cross the elderly threshold this tick and retire in
    // agentId order; each retirement first releases the enterprise membership.
    const events = advance(projection, 1);
    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'AgentAged',
      'EnterpriseEmployeeLeft',
      'AgentRetired',
      'AgentAged',
      'EnterpriseEmployeeLeft',
      'AgentRetired',
    ]);
    expect(events[2]).toMatchObject({
      type: 'EnterpriseEmployeeLeft',
      payload: {
        enterpriseId: 'ent-1',
        agentId: 'agent-citizen',
        occupationName: 'Farmer',
        previousJob: 'Farmer',
      },
    });
    const settled = events.reduce(applyWorldEvent, projection);
    expect(settled.enterprises['ent-1']?.employeeAgentIds).toEqual([]);
    expect(settled.agents['agent-citizen']?.job).toBeNull();
  });

  test('old-age death burns the estate out of circulation and stops settlement', () => {
    // Fixed 24-day lifespan: adult at 21, elderly at 22, dead at 24.
    const deathPolicy: LifecyclePolicy = {
      ...lifecyclePolicy,
      minLifespanDays: 24,
      maxLifespanDays: 24,
    };
    let projection = createWorldProjection({
      agents: [
        lifecycleAgent({ job: 'Farmer', balance: 50, inventory: { Bread: 2 } }),
      ],
      treasury: 100,
      clock: { now: 0, tickDurationMs: DAY_MS },
    });
    const moneySupplyBefore = projection.moneySupply;

    // Ticks 1–2 age and retire; tick 3 pays the final pension then dies at
    // the interval end (the agent was alive during the interval).
    projection = advance(projection, 1, { ...policies, lifecycle: deathPolicy }).reduce(
      applyWorldEvent,
      projection,
    );
    projection = advance(projection, 2, { ...policies, lifecycle: deathPolicy }).reduce(
      applyWorldEvent,
      projection,
    );
    const deathTick = advance(projection, 3, { ...policies, lifecycle: deathPolicy });
    expect(deathTick.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'PensionPaid',
      'AgentDied',
    ]);
    const died = deathTick[2];
    if (died === undefined || died.type !== 'AgentDied') {
      throw new Error('expected AgentDied');
    }
    expect(died.payload).toMatchObject({
      agentId: 'agent-citizen',
      cause: 'old-age',
      diedAt: 3 * DAY_MS,
      ageDays: 24,
      lifespanDays: 24,
      retired: true,
      policyVersion: 'town-lifecycle-v1',
    });
    // Balance 50 + one treasury pension per post-retirement interval (ticks 2
    // and 3) = 52 burned; inventory perishes with the holder. Pensions are
    // transfers, so the supply only moves on the burn.
    expect(died.payload.estate).toEqual({
      burnedCurrency: 52,
      inventoryByCommodity: { Bread: 2 },
      depositForfeited: 0,
      writtenOffLoanIds: [],
    });
    projection = deathTick.reduce(applyWorldEvent, projection);
    expect(projection.agents['agent-citizen']).toBeUndefined();
    expect(projection.moneySupply).toBe(moneySupplyBefore - 52);

    // The dead stay dead: no further settlement events for the agent.
    const after = advance(projection, 4, { ...policies, lifecycle: deathPolicy });
    expect(after.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
    const replayed = after.reduce(applyWorldEvent, projection);
    expect(replayed.moneySupply).toBe(moneySupplyBefore - 52);
  });

  test('illness death fires at low health with a seeded roll', () => {
    const illnessPolicy: LifecyclePolicy = {
      ...lifecyclePolicy,
      illnessDeathHealthThreshold: 30,
      illnessDeathProbabilityPerSettlementScale: 100,
    };
    const projection = createWorldProjection({
      agents: [lifecycleAgent({ physiology: { energy: 50, satiety: 50, health: 0 } })],
      clock: { now: 0, tickDurationMs: DAY_MS },
    });
    // Health 0 with scale 100 → probability capped at 100%/h → certain death
    // (after aging into elderly at the same interval end).
    const first = advance(projection, 1, { ...policies, lifecycle: illnessPolicy });
    expect(first.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'AgentAged',
      'AgentDied',
    ]);
    expect(first[2]).toMatchObject({
      payload: { cause: 'illness', ageDays: 22, retired: false },
    });

    // Healthy agents survive the same policy deterministically.
    const healthy = createWorldProjection({
      agents: [lifecycleAgent({ physiology: { energy: 50, satiety: 50, health: 90 } })],
      clock: { now: 0, tickDurationMs: DAY_MS },
    });
    const healthyFirst = advance(healthy, 1, { ...policies, lifecycle: illnessPolicy });
    expect(healthyFirst.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'AgentAged',
    ]);
  });

  test('death liquidates bank positions through write-off and forfeiture', () => {
    const deathPolicy: LifecyclePolicy = {
      ...lifecyclePolicy,
      stageThresholdsDays: { teen: 15, adult: 21, elderly: 40 },
      minLifespanDays: 22,
      maxLifespanDays: 22,
    };
    const projection = createWorldProjection({
      agents: [lifecycleAgent({ balance: 80 })],
      bank: {
        balance: 1000,
        deposits: { 'agent-citizen': 200 },
        loans: {
          'loan-1': {
            loanId: asLoanId('loan-1'),
            borrowerAgentId: asAgentId('agent-citizen'),
            principal: 300,
            dailyInterestRate: 0.01,
            termDays: 30,
            issuedAt: 0,
            accruedInterest: 10,
            lastAccrualAt: 0,
            missedPayments: 0,
            status: 'active',
          },
        },
        creditHistoryByAgent: {},
      },
      clock: { now: 0, tickDurationMs: DAY_MS },
    });
    const moneySupplyBefore = projection.moneySupply;

    const events = advance(projection, 1, { ...policies, lifecycle: deathPolicy });
    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'LoanWrittenOff',
      'DepositForfeited',
      'AgentDied',
    ]);
    expect(events[1]).toMatchObject({
      type: 'LoanWrittenOff',
      payload: {
        loanId: 'loan-1',
        borrowerAgentId: 'agent-citizen',
        outstandingPrincipal: 300,
        outstandingInterest: 10,
        reason: 'borrower-deceased',
      },
    });
    expect(events[2]).toMatchObject({
      type: 'DepositForfeited',
      payload: { forfeitedAmount: 200, reason: 'depositor-deceased' },
    });
    expect(events[3]).toMatchObject({
      type: 'AgentDied',
      payload: {
        estate: {
          burnedCurrency: 80,
          depositForfeited: 200,
          writtenOffLoanIds: ['loan-1'],
        },
      },
    });

    const settled = events.reduce(applyWorldEvent, projection);
    // Pure book operations leave bank cash untouched; only the circulating
    // balance leaves the money supply.
    expect(settled.bank?.balance).toBe(1000);
    expect(settled.bank?.deposits).toEqual({});
    expect(settled.bank?.loans['loan-1']).toMatchObject({ status: 'written-off' });
    expect(settled.moneySupply).toBe(moneySupplyBefore - 80);
  });

  test("a matter expiring in the same advance as its assignee's death closes exactly once", () => {
    // Regression: the pre-loop expiry settlement and the death voiding both
    // targeted the matter from the stale projection; the reducer rejects the
    // second close and the whole batch stopped replaying.
    const deathPolicy: LifecyclePolicy = {
      ...lifecyclePolicy,
      stageThresholdsDays: { teen: 15, adult: 21, elderly: 40 },
      minLifespanDays: 22,
      maxLifespanDays: 22,
    };
    const projection = createWorldProjection({
      agents: [lifecycleAgent({ balance: 10 })],
      socialMatters: [
        {
          matterId: 'matter-dying',
          kind: 'help-request',
          status: 'open',
          initiatorAgentId: asAgentId('agent-citizen'),
          topic: 'firewood',
          statement: 'Needs firewood before winter.',
          responses: [],
          createdAt: 0,
          // Expires inside this very advance — the expiry settlement fires
          // first, the death voiding must skip the already-closed matter.
          expiresAt: Math.floor(DAY_MS / 2),
        },
      ],
      clock: { now: 0, tickDurationMs: DAY_MS },
    });

    const events = advance(projection, 1, { ...policies, lifecycle: deathPolicy });
    const matterClosures = events.filter((event) => event.type === 'MatterClosed');
    expect(events.some((event) => event.type === 'AgentDied')).toBe(true);
    expect(matterClosures).toHaveLength(1);
    expect(matterClosures[0]).toMatchObject({
      payload: { matterId: 'matter-dying', closure: 'expired' },
    });
    // The whole batch replays cleanly onto the original projection.
    expect(() => events.reduce(applyWorldEvent, projection)).not.toThrow();
  });

  test('a merged multi-cadence advance settles lifecycle per cadence, matching step-by-step', () => {
    // Retirement at day 1, pension for days 2 and 3, old-age death at day 3:
    // one three-day advance must emit the same lifecycle event sequence as
    // three one-day advances (probabilistic + stateful effects never merge).
    const cadencePolicy: LifecyclePolicy = {
      ...lifecyclePolicy,
      settlementCadenceMs: DAY_MS,
      minLifespanDays: 24,
      maxLifespanDays: 24,
    };
    const pol = { ...policies, lifecycle: cadencePolicy };
    const build = () =>
      createWorldProjection({
        agents: [lifecycleAgent({ job: 'Farmer', balance: 50 })],
        treasury: 100,
        clock: { now: 0, tickDurationMs: DAY_MS },
      });

    let stepped = build();
    const stepEvents: WorldEvent[] = [];
    for (let tick = 1; tick <= 3; tick += 1) {
      const events = advance(stepped, tick, pol);
      stepEvents.push(...events);
      stepped = events.reduce(applyWorldEvent, stepped);
    }

    // advance() sends one-day deltas; the merged run needs a single command
    // spanning the whole window — dispatch directly.
    const merged = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-lifecycle-merged-3d',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 3 * DAY_MS },
        issuedAt: 0,
      }),
      projection: build(),
      policies: pol,
      nextSequence: 10,
    });

    const lifecycleTypes = (events: readonly WorldEvent[]) =>
      events
        .filter((event) =>
          ['AgentAged', 'AgentRetired', 'PensionPaid', 'AgentDied'].includes(event.type),
        )
        .map((event) => event.type);
    expect(lifecycleTypes(merged)).toEqual(['AgentAged', 'AgentRetired', 'PensionPaid', 'PensionPaid', 'AgentDied']);
    expect(lifecycleTypes(stepEvents)).toEqual(lifecycleTypes(merged));

    const burn = (events: readonly WorldEvent[]) => {
      const died = events.find((event) => event.type === 'AgentDied');
      return died?.type === 'AgentDied' ? died.payload.estate.burnedCurrency : undefined;
    };
    expect(burn(merged)).toBe(burn(stepEvents));
    expect(burn(merged)).toBe(52);
  });

  test('is deterministic: redispatching the same command yields identical events', () => {
    const projection = createWorldProjection({
      agents: [
        lifecycleAgent({
          job: 'Farmer',
          physiology: { energy: 50, satiety: 50, health: 20 },
        }),
      ],
      clock: { now: 0, tickDurationMs: DAY_MS },
    });
    const command = createCommandEnvelope({
      id: 'command-lifecycle-determinism',
      simulationId: 'sim-1',
      source: 'system',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs: DAY_MS },
      issuedAt: DAY_MS,
    });
    const first = dispatchWorldCommand({
      command,
      projection,
      policies: lifecyclePolicies,
      nextSequence: 7,
    });
    const second = dispatchWorldCommand({
      command,
      projection,
      policies: lifecyclePolicies,
      nextSequence: 7,
    });
    expect(second).toEqual(first);
  });

  test('keeps runs lifecycle-free without the policy, byte-for-byte', () => {
    const projection = createWorldProjection({
      agents: [lifecycleAgent({ job: 'Farmer', balance: 50 })],
      clock: { now: 0, tickDurationMs: DAY_MS },
    });
    const events = advance(projection, 1, policies);
    expect(events.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
    const settled = events.reduce(applyWorldEvent, projection);
    expect(settled.agents['agent-citizen']?.job).toBe('Farmer');
    expect(settled.agents['agent-citizen']?.lifeStage).toBeUndefined();
  });

  test('deaths cancel pending job applications of the same advance', () => {
    const deathPolicy: LifecyclePolicy = {
      ...lifecyclePolicy,
      stageThresholdsDays: { teen: 15, adult: 21, elderly: 40 },
      minLifespanDays: 22,
      maxLifespanDays: 22,
    };
    const projection = createWorldProjection({
      agents: [lifecycleAgent({ job: null, balance: 10 })],
      jobApplications: [
        {
          applicationId: 'application-1',
          cycleNumber: 0,
          agentId: asAgentId('agent-citizen'),
          occupationName: 'Cleaner',
          residentialTier: 1,
          educationScore: 50,
          submittedAt: 0,
          status: 'pending',
        },
      ],
      clock: { now: 0, tickDurationMs: DAY_MS },
    });
    const events = advance(projection, 1, {
      ...policies,
      lifecycle: deathPolicy,
      jobApplication: {
        populationEducationScores: [50],
        quotaByResidentialTier: [1, 1, 1, 1, 1, 1, 1],
        recruitmentCycle: {
          policyVersion: 'recruitment-v1',
          cycleDurationMs: DAY_MS,
          defaultOccupationCapacity: 5,
          occupationCapacityOverrides: {},
        },
      },
    });
    const types = events.map((event) => event.type);
    expect(types).toContain('AgentDied');
    // The dead applicant's pending application resolves for nobody: only the
    // cycle summary fires, no JobApplicationResolved/JobAssigned.
    expect(types).not.toContain('JobApplicationResolved');
    expect(types).not.toContain('JobAssigned');
    expect(types).toContain('RecruitmentCycleCompleted');
  });
});
