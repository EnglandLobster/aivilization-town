import { createAmmPool } from '@aivilization/economy';
import { createShortTermMemoryRecord } from '@aivilization/memory';
import {
  asAgentId,
  asConversationId,
  asLocationId,
  createEventEnvelope,
  replayEvents,
} from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  normalizeLegacyWorldProjectionSnapshot,
  type AgentActivityTimeCommittedPayload,
  type WorldEvent,
} from './index';

describe('world projection', () => {
  test('rejects an invalid bank snapshot at the world hydration boundary', () => {
    expect(() =>
      createWorldProjection({
        agents: [],
        bank: {
          balance: -1,
          deposits: {},
          loans: {},
          creditHistoryByAgent: {},
        },
      }),
    ).toThrow('bank balance must be non-negative finite');
    const valid = createWorldProjection({ agents: [] });
    expect(() =>
      normalizeLegacyWorldProjectionSnapshot({
        ...valid,
        bank: {
          balance: -1,
          deposits: {},
          loans: {},
          creditHistoryByAgent: {},
        },
      }),
    ).toThrow('bank balance must be non-negative finite');
  });

  test('keeps only bounded recent memory records in the non-authoritative projection cache', () => {
    const agentId = asAgentId('agent-1');
    const initial = createWorldProjection({ agents: [] });
    const events: WorldEvent[] = Array.from({ length: 300 }, (_, index) =>
      createEventEnvelope({
        id: `event-memory-${index}`,
        simulationId: 'sim-memory-retention',
        type: 'ShortTermMemoryRecorded',
        payload: {
          record: createShortTermMemoryRecord({
            id: `memory-${index}`,
            agentId,
            kind: 'action',
            status: 'succeeded',
            summary: `memory ${index}`,
            occurredAt: index,
            importanceScore: 0.5,
            source: { eventIds: [] },
          }),
        },
        occurredAt: index,
        sequence: index + 1,
      }),
    );

    const projection = replayEvents(initial, events, applyWorldEvent);

    expect(projection.memoryRecords).toHaveLength(256);
    expect(projection.memoryRecords[0]?.id).toBe('memory-44');
    expect(projection.memoryRecords.at(-1)?.id).toBe('memory-299');
  });

  test('replays exclusive activity time and rejects overlapping commitments', () => {
    const initial = createWorldProjection({
      clock: { now: 1_000, tickDurationMs: 1_000 },
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });
    const commitment: WorldEvent = createEventEnvelope({
      id: 'event-activity-time',
      simulationId: 'sim-1',
      commandId: 'command-study',
      type: 'AgentActivityTimeCommitted',
      payload: {
        agentId: asAgentId('agent-1'),
        activity: 'education',
        commandType: 'AgentStudy',
        policyVersion: 'exclusive-agent-activity-time-v1',
        settlementTiming: 'effects-at-commit',
        startedAt: 1_000,
        durationSeconds: 2,
        availableAt: 3_000,
      } satisfies AgentActivityTimeCommittedPayload,
      occurredAt: 10,
      sequence: 1,
    });

    const committed = applyWorldEvent(initial, commitment);
    expect(committed.activityTimeByAgent['agent-1']).toMatchObject({
      activity: 'education',
      startedAt: 1_000,
      availableAt: 3_000,
      committedAt: 10,
    });

    const overlapping: WorldEvent = createEventEnvelope({
      id: 'event-overlapping-activity-time',
      simulationId: 'sim-1',
      commandId: 'command-work',
      type: 'AgentActivityTimeCommitted',
      payload: {
        agentId: asAgentId('agent-1'),
        activity: 'labor',
        commandType: 'AgentWork',
        policyVersion: 'exclusive-agent-activity-time-v1',
        settlementTiming: 'effects-at-commit',
        startedAt: 1_000,
        durationSeconds: 1,
        availableAt: 2_000,
      } satisfies AgentActivityTimeCommittedPayload,
      occurredAt: 11,
      sequence: 2,
    });
    expect(() => applyWorldEvent(committed, overlapping)).toThrow(
      'agent agent-1 activity overlaps education until 3000',
    );
  });

  test('stores locations and normalizes omitted agent location to null', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
        {
          agentId: asAgentId('agent-2'),
          locationId: asLocationId('school'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 20,
          balance: 60,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
      ],
    });

    expect(projection.locations['school']).toMatchObject({
      name: 'School',
      kind: 'education',
      activityAffinities: ['study', 'socialize'],
    });
    expect(projection.agents['agent-1']?.locationId).toBeNull();
    expect(projection.agents['agent-2']?.locationId).toBe(asLocationId('school'));
  });

  test('rejects agent seed locations that are absent from the projection', () => {
    expect(() =>
      createWorldProjection({
        agents: [
          {
            agentId: asAgentId('agent-1'),
            locationId: asLocationId('missing-location'),
            physiology: { energy: 100, satiety: 40, health: 100 },
            educationScore: 10,
            balance: 50,
            residentialTier: 1,
            job: 'Cleaner',
            inventory: { Bread: 2 },
          },
        ],
        locations: [],
      }),
    ).toThrow('agent agent-1 location missing-location is not in projection locations');
  });

  test('replays agent location changes into projection state', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('residential-block'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
      ],
      locations: [
        {
          locationId: asLocationId('residential-block'),
          name: 'Residential Block',
          kind: 'residence',
          activityAffinities: ['sleep', 'socialize'],
          capacity: null,
        },
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events: WorldEvent[] = [
      createEventEnvelope({
        id: 'event-location',
        simulationId: 'sim-1',
        commandId: 'command-move',
        type: 'AgentLocationChanged',
        payload: {
          agentId: asAgentId('agent-1'),
          previousLocationId: asLocationId('residential-block'),
          nextLocationId: asLocationId('school'),
          reason: 'study',
        },
        occurredAt: 15,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.locationId).toBe(asLocationId('school'));
  });

  test('replays location observations without mutating agent state', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('school'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
      ],
      locations: [
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events = [
      createEventEnvelope({
        id: 'event-observation',
        simulationId: 'sim-1',
        commandId: 'command-observe',
        type: 'LocationObserved',
        payload: {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('school'),
          locationName: 'School',
          observedAgentIds: [asAgentId('agent-2')],
          activityAffinities: ['study', 'socialize'],
          focus: 'classmates',
        },
        occurredAt: 16,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.locationObservations).toEqual([
      {
        agentId: 'agent-1',
        locationId: 'school',
        locationName: 'School',
        observedAgentIds: ['agent-2'],
        activityAffinities: ['study', 'socialize'],
        focus: 'classmates',
        observedAt: 16,
      },
    ]);
    expect(projection.agents['agent-1']).toEqual(initial.agents['agent-1']);
  });

  test('replays conversation records without mutating agent state', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('school'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
        {
          agentId: asAgentId('agent-2'),
          locationId: asLocationId('school'),
          physiology: { energy: 90, satiety: 70, health: 100 },
          educationScore: 20,
          balance: 80,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events = [
      createEventEnvelope({
        id: 'event-conversation',
        simulationId: 'sim-1',
        commandId: 'command-conversation',
        type: 'ConversationRecorded',
        payload: {
          conversationId: asConversationId('conversation-command-conversation'),
          initiatorAgentId: asAgentId('agent-1'),
          participantAgentIds: [asAgentId('agent-1'), asAgentId('agent-2')],
          locationId: asLocationId('school'),
          topic: 'homework',
          turns: [
            {
              turnIndex: 0,
              speakerAgentId: asAgentId('agent-1'),
              utterance: 'Do you want to study together?',
              intent: 'invite-study',
            },
            {
              turnIndex: 1,
              speakerAgentId: asAgentId('agent-2'),
              utterance: 'Yes, let us review after class.',
            },
          ],
        },
        occurredAt: 20,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.conversationRecords).toEqual([
      {
        conversationId: 'conversation-command-conversation',
        initiatorAgentId: 'agent-1',
        participantAgentIds: ['agent-1', 'agent-2'],
        locationId: 'school',
        topic: 'homework',
        turns: [
          {
            turnIndex: 0,
            speakerAgentId: 'agent-1',
            utterance: 'Do you want to study together?',
            intent: 'invite-study',
          },
          {
            turnIndex: 1,
            speakerAgentId: 'agent-2',
            utterance: 'Yes, let us review after class.',
          },
        ],
        recordedAt: 20,
      },
    ]);
    expect(projection.agents['agent-1']).toEqual(initial.agents['agent-1']);
    expect(projection.agents['agent-2']).toEqual(initial.agents['agent-2']);
  });

  test('replays agent state and memory events deterministically', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
      ],
    });

    const events = [
      createEventEnvelope({
        id: 'event-2',
        simulationId: 'sim-1',
        commandId: 'command-1',
        type: 'PhysiologyChanged',
        payload: {
          agentId: asAgentId('agent-1'),
          previous: { energy: 100, satiety: 40, health: 100 },
          next: { energy: 95, satiety: 55, health: 100 },
          reason: 'eat',
        },
        occurredAt: 10,
        sequence: 2,
      }),
      createEventEnvelope({
        id: 'event-1',
        simulationId: 'sim-1',
        commandId: 'command-1',
        type: 'InventoryChanged',
        payload: {
          agentId: asAgentId('agent-1'),
          itemName: 'Bread',
          delta: -1,
          reason: 'eat',
        },
        occurredAt: 10,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.inventory).toEqual({ Bread: 1 });
    expect(projection.agents['agent-1']?.physiology.satiety).toBe(55);
  });
});

describe('world economy projection', () => {
  test('replays commodity production into inventory and physiology state', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = [
      createEventEnvelope({
        id: 'event-produced',
        simulationId: 'sim-1',
        commandId: 'command-produce',
        type: 'CommodityProduced',
        payload: {
          agentId: asAgentId('agent-1'),
          produced: { Apple: 2 },
          consumedInputs: {},
          energyCost: 4,
          satietyCost: 0,
          laborSeconds: 0.2,
        },
        occurredAt: 10,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.inventory).toEqual({ Apple: 2 });
    expect(projection.agents['agent-1']?.physiology.energy).toBe(96);
  });

  test('replays subsidy payments into agent balance and money supply', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 10,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      moneySupply: 100,
    });

    const events = [
      createEventEnvelope({
        id: 'event-subsidy',
        simulationId: 'sim-1',
        commandId: 'command-time',
        type: 'SubsidyPaid',
        payload: {
          agentId: asAgentId('agent-1'),
          amount: 25,
          previousBalance: 10,
          nextBalance: 35,
          reason: 'safety-net',
        },
        occurredAt: 20,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.balance).toBe(35);
    expect(projection.moneySupply).toBe(125);
  });

  test('replays residential upkeep charges into agent balance and money supply', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 100,
          residentialTier: 2,
          job: null,
          inventory: {},
        },
      ],
      moneySupply: 1000,
    });

    const events = [
      createEventEnvelope({
        id: 'event-upkeep',
        simulationId: 'sim-1',
        commandId: 'command-time',
        type: 'ResidentialUpkeepCharged',
        payload: {
          agentId: asAgentId('agent-1'),
          residentialTier: 2,
          amount: 10,
          unpaidAmount: 0,
          previousBalance: 100,
          nextBalance: 90,
          reason: 'residential-upkeep',
        },
        occurredAt: 20,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.balance).toBe(90);
    expect(projection.moneySupply).toBe(990);
  });

  test('replays medical treatment charges into agent balance and money supply', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 40 },
          educationScore: 0,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      moneySupply: 1000,
    });

    const events = [
      createEventEnvelope({
        id: 'event-medical-treatment',
        simulationId: 'sim-1',
        commandId: 'command-see-doctor',
        type: 'MedicalTreatmentCharged',
        payload: {
          agentId: asAgentId('agent-1'),
          amount: 36,
          previousBalance: 100,
          nextBalance: 64,
          reason: 'medical-treatment',
        },
        occurredAt: 20,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.balance).toBe(64);
    expect(projection.moneySupply).toBe(964);
  });

  test('replays AMM trade into agent balance, inventory, pool state, and money supply', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 1000,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
      moneySupply: 1000,
    });

    const events = [
      createEventEnvelope({
        id: 'event-trade',
        simulationId: 'sim-1',
        commandId: 'command-trade',
        type: 'TradeExecuted',
        payload: {
          agentId: asAgentId('agent-1'),
          side: 'buy' as const,
          commodityName: 'Apple',
          commodityQuantity: 10,
          currencyQuantity: 111.1111111111,
          poolAfter: createAmmPool({
            commodity: 'Apple',
            commodityReserve: 90,
            currencyReserve: 1111.1111111111,
          }),
          moneySupplyDelta: -111.1111111111,
        },
        occurredAt: 20,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.inventory).toEqual({ Apple: 10 });
    expect(projection.agents['agent-1']?.balance).toBeCloseTo(888.8888888889);
    expect(projection.marketPools['Apple']?.commodityReserve).toBe(90);
    expect(projection.moneySupply).toBeCloseTo(888.8888888889);
  });

  test('replays market price index records into projection state', () => {
    const initial = createWorldProjection({ agents: [] });
    const events = [
      createEventEnvelope({
        id: 'event-market-index',
        simulationId: 'sim-1',
        type: 'MarketPriceIndexRecorded',
        payload: {
          baselineAt: 0,
          food: 4,
          nonFood: 2,
          overall: 3,
          foodCount: 2,
          nonFoodCount: 2,
          ratios: { Apple: 2, Bread: 8, Wood: 4, Book: 1 },
        },
        occurredAt: 100,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);

    expect(projection.marketPriceIndices).toEqual([
      {
        baselineAt: 0,
        recordedAt: 100,
        food: 4,
        nonFood: 2,
        overall: 3,
        foodCount: 2,
        nonFoodCount: 2,
        ratios: { Apple: 2, Bread: 8, Wood: 4, Book: 1 },
      },
    ]);
  });

  test('replays economic composition records, keeping only the latest bounded observation', () => {
    const initial = createWorldProjection({ agents: [] });
    // Legacy projections carry neither slice until the events exist.
    expect(initial.economicComposition).toBeUndefined();
    expect(initial.bankruptEnterpriseTotal).toBeUndefined();

    const record = (sequence: number, recordedAt: number, moneySupply: number) =>
      createEventEnvelope({
        id: `event-economic-composition-${sequence}`,
        simulationId: 'sim-1',
        type: 'EconomicCompositionRecorded',
        payload: {
          recordedAt,
          moneySupply,
          composition: {
            agents: 100,
            enterprises: 0,
            treasury: 0,
            bank: 0,
            ammPoolCurrency: 1000,
            ammPoolCommodityValue: 1000,
            externalNetInflow: 0,
          },
          enterprises: { total: 0, active: 0, insolvent: 0, bankruptTotal: 0 },
          gini: 0.25,
          deposits: 0,
          loansOutstanding: 0,
        },
        occurredAt: recordedAt,
        sequence,
      });

    const projection = replayEvents(
      initial,
      [record(1, 100, 1000), record(2, 200, 1100)],
      applyWorldEvent,
    );

    expect(projection.economicComposition).toEqual({
      recordedAt: 200,
      moneySupply: 1100,
      composition: {
        agents: 100,
        enterprises: 0,
        treasury: 0,
        bank: 0,
        ammPoolCurrency: 1000,
        ammPoolCommodityValue: 1000,
        externalNetInflow: 0,
      },
      enterprises: { total: 0, active: 0, insolvent: 0, bankruptTotal: 0 },
      gini: 0.25,
      deposits: 0,
      loansOutstanding: 0,
    });
  });

  test('tallies cumulative enterprise bankruptcies from declarations, not closures', () => {
    const owner = asAgentId('agent-owner');
    const enterprise = (enterpriseId: string, status: 'active' | 'insolvent') => ({
      enterpriseId,
      name: `Workshop ${enterpriseId}`,
      ownerAgentId: owner,
      occupationName: 'Baker',
      balance: 10,
      inventory: {},
      maxEmployees: 1,
      employeeAgentIds: [],
      status,
      foundedAt: 0,
      cumulativeSales: 0,
      cumulativePurchases: 0,
      cumulativeWages: 0,
    });
    const initial = createWorldProjection({
      agents: [
        {
          agentId: owner,
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      enterprises: [enterprise('enterprise-1', 'insolvent'), enterprise('enterprise-2', 'active')],
    });
    const close = (enterpriseId: string, reason: 'owner-closed' | 'insolvent', sequence: number) =>
      createEventEnvelope({
        id: `event-close-${sequence}`,
        simulationId: 'sim-1',
        type: 'EnterpriseClosed',
        payload: {
          enterpriseId,
          ownerAgentId: owner,
          returnedBalance: 0,
          returnedInventory: {},
          employeeAgentIds: [],
          reason,
        },
        occurredAt: 100,
        sequence,
      });
    const events: WorldEvent[] = [
      createEventEnvelope({
        id: 'event-bankruptcy',
        simulationId: 'sim-1',
        type: 'EnterpriseBankruptcyDeclared',
        payload: {
          enterpriseId: 'enterprise-1',
          declaredAt: 100,
          balance: 10,
          insolvencyStartedAt: 50,
          policyVersion: 'enterprise-policy-v1',
        },
        occurredAt: 100,
        sequence: 1,
      }),
      close('enterprise-1', 'insolvent', 2),
      // An owner-initiated close is not a bankruptcy and must not move the tally.
      close('enterprise-2', 'owner-closed', 3),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);

    expect(projection.enterprises['enterprise-1']?.status).toBe('closed');
    expect(projection.enterprises['enterprise-2']?.status).toBe('closed');
    expect(projection.bankruptEnterpriseTotal).toBe(1);
  });
});

describe('world job projection', () => {
  test('replays job application, recruitment resolution, and assignment into projection state', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events: WorldEvent[] = [
      createEventEnvelope({
        id: 'event-application',
        simulationId: 'sim-1',
        commandId: 'command-apply',
        type: 'JobApplicationSubmitted',
        payload: {
          applicationId: 'application-1',
          cycleNumber: 0,
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          residentialTier: 1,
          educationScore: 0,
        },
        occurredAt: 70,
        sequence: 1,
      }),
      createEventEnvelope({
        id: 'event-application-resolved',
        simulationId: 'sim-1',
        commandId: 'command-recruitment',
        type: 'JobApplicationResolved',
        payload: {
          applicationId: 'application-1',
          cycleNumber: 0,
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          status: 'accepted' as const,
          reason: 'competitive-match' as const,
        },
        occurredAt: 100,
        sequence: 2,
      }),
      createEventEnvelope({
        id: 'event-assigned',
        simulationId: 'sim-1',
        commandId: 'command-recruitment',
        type: 'JobAssigned',
        payload: {
          applicationId: 'application-1',
          cycleNumber: 0,
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          previousJob: null,
        },
        occurredAt: 100,
        sequence: 3,
      }),
      createEventEnvelope({
        id: 'event-cycle-completed',
        simulationId: 'sim-1',
        commandId: 'command-recruitment',
        type: 'RecruitmentCycleCompleted',
        payload: {
          cycleNumber: 0,
          cycleStartedAt: 0,
          cycleEndedAt: 100,
          policyVersion: 'recruitment-test',
          applicationCount: 1,
          acceptedCount: 1,
          rejectedCount: 0,
        },
        occurredAt: 100,
        sequence: 4,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.jobApplications).toEqual([
      {
        applicationId: 'application-1',
        cycleNumber: 0,
        agentId: 'agent-1',
        occupationName: 'Cleaner',
        residentialTier: 1,
        educationScore: 0,
        submittedAt: 70,
        status: 'accepted',
        resolvedAt: 100,
        resolutionReason: 'competitive-match',
      },
    ]);
    expect(projection.agents['agent-1']?.job).toBe('Cleaner');
    expect(projection.recruitmentCycles).toEqual([
      {
        cycleNumber: 0,
        cycleStartedAt: 0,
        cycleEndedAt: 100,
        completedAt: 100,
        policyVersion: 'recruitment-test',
        applicationCount: 1,
        acceptedCount: 1,
        rejectedCount: 0,
      },
    ]);
  });

  test('rejects recruitment resolutions that do not reference a pending application', () => {
    const projection = createWorldProjection({ agents: [] });
    const event: WorldEvent = createEventEnvelope({
      id: 'event-orphan-resolution',
      simulationId: 'sim-1',
      commandId: 'command-recruitment',
      type: 'JobApplicationResolved',
      payload: {
        applicationId: 'missing-application',
        cycleNumber: 0,
        agentId: asAgentId('agent-1'),
        occupationName: 'Cleaner',
        status: 'rejected' as const,
        reason: 'capacity-exhausted' as const,
      },
      occurredAt: 100,
      sequence: 1,
    });

    expect(() => applyWorldEvent(projection, event)).toThrow(
      'unknown job application missing-application',
    );
  });
});

describe('world physiological safety-net projection', () => {
  test('replays distress, essential inventory grants, and recovery cleanup', () => {
    const agentId = asAgentId('agent-welfare');
    const initial = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 50, satiety: 10, health: 50 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });
    const activeState = {
      policyVersion: 'physiological-safety-net-test',
      distressStartedAt: 0,
      lowAxes: ['satiety'] as const,
      lastGrantedAt: null,
    };
    const events: WorldEvent[] = [
      createEventEnvelope({
        id: 'event-distress-started',
        simulationId: 'sim-1',
        commandId: 'command-time',
        type: 'PhysiologicalDistressChanged',
        payload: {
          agentId,
          status: 'active' as const,
          state: activeState,
          evaluatedAt: 50,
          reason: 'started' as const,
        },
        occurredAt: 10,
        sequence: 1,
      }),
      createEventEnvelope({
        id: 'event-safety-net-granted',
        simulationId: 'sim-1',
        commandId: 'command-time',
        type: 'SafetyNetGranted',
        payload: {
          agentId,
          policyVersion: 'physiological-safety-net-test',
          grantedAt: 100,
          distressDurationMs: 100,
          lowAxes: ['satiety'] as const,
          inventory: { Apple: 2 },
          reason: 'persistent-physiological-distress' as const,
        },
        occurredAt: 20,
        sequence: 2,
      }),
    ];

    const supported = replayEvents(initial, events, applyWorldEvent);
    expect(supported.agents[agentId]?.inventory).toEqual({ Apple: 2 });
    expect(supported.physiologicalDistressByAgent[agentId]).toEqual({
      ...activeState,
      lowAxes: ['satiety'],
      lastGrantedAt: 100,
    });

    const cleared = applyWorldEvent(
      supported,
      createEventEnvelope({
        id: 'event-distress-cleared',
        simulationId: 'sim-1',
        commandId: 'command-time-next',
        type: 'PhysiologicalDistressChanged',
        payload: {
          agentId,
          status: 'cleared' as const,
          previousState: {
            ...activeState,
            lastGrantedAt: 100,
          },
          evaluatedAt: 150,
          reason: 'recovered' as const,
        },
        occurredAt: 30,
        sequence: 3,
      }),
    );
    expect(cleared.physiologicalDistressByAgent).toEqual({});
    expect(cleared.agents[agentId]?.inventory).toEqual({ Apple: 2 });
  });
});

describe('world social projection', () => {
  test('replays social interactions into directed relation state', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const initial = createWorldProjection({
      agents: [
        {
          agentId: agent1,
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: agent2,
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const nextRelation = {
      sourceAgentId: agent1,
      targetAgentId: agent2,
      relationScore: 0.25,
      attitudeScore: 0.5,
      relationLabel: 'acquaintance' as const,
      interactionCount: 1,
      lastInteractionSummary: 'Shared food after work.',
    };
    const events = [
      createEventEnvelope({
        id: 'event-social',
        simulationId: 'sim-1',
        commandId: 'command-social',
        type: 'SocialInteractionCompleted',
        payload: {
          sourceAgentId: agent1,
          targetAgentId: agent2,
          summary: 'Shared food after work.',
          relationDelta: 0.25,
          attitudeDelta: 0.5,
          nextRelation,
        },
        occurredAt: 80,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.socialRelations['agent-1->agent-2']).toEqual(nextRelation);
  });

  test('replays simulation time as deterministic social relation decay', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const initial = createWorldProjection({ agents: [] });
    const relation = {
      sourceAgentId: agent1,
      targetAgentId: agent2,
      relationScore: 0.8,
      attitudeScore: 0.8,
      relationLabel: 'close-friend' as const,
      interactionCount: 2,
      lastInteractionSummary: 'Worked together.',
    };
    const projection = replayEvents(
      initial,
      [
        createEventEnvelope({
          id: 'event-social-decay-source',
          simulationId: 'sim-1',
          commandId: 'command-social-decay-source',
          type: 'SocialInteractionCompleted',
          payload: {
            sourceAgentId: agent1,
            targetAgentId: agent2,
            summary: 'Worked together.',
            relationDelta: 0.8,
            attitudeDelta: 0.8,
            nextRelation: relation,
          },
          occurredAt: 0,
          sequence: 1,
        }),
        createEventEnvelope({
          id: 'event-social-decay-time',
          simulationId: 'sim-1',
          commandId: 'command-social-decay-time',
          type: 'SimulationTimeAdvanced',
          payload: {
            previous: initial.clock,
            next: { ...initial.clock, now: initial.clock.now + 7 * 24 * 60 * 60 * 1_000 },
            deltaMs: 7 * 24 * 60 * 60 * 1_000,
          },
          occurredAt: 1,
          sequence: 2,
        }),
      ],
      applyWorldEvent,
    );

    expect(projection.socialRelations['agent-1->agent-2']).toMatchObject({
      relationScore: 0.4,
      attitudeScore: 0.070710678119,
      relationLabel: 'friend',
      interactionCount: 2,
    });
  });
});
