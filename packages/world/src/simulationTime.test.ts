import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
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
