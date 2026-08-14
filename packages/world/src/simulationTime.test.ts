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
