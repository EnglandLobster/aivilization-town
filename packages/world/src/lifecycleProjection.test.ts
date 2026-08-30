import { asAgentId, asEventId, createEventEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  type AgentActivityTimeCommittedPayload,
  type AgentOwnershipArrivedPayload,
  type WorldEvent,
} from './index';

describe('lifecycle projection facts', () => {
  test('moves circulating balance between ownership shards without changing the aggregate supply', () => {
    const agentId = asAgentId('agent-currency-transfer');
    const base = createWorldProjection({ agents: [], moneySupply: 1_000 });
    const arrived = applyWorldEvent(
      base,
      createEventEnvelope({
        id: asEventId('event-currency-arrival'),
        simulationId: 'sim-1',
        type: 'AgentOwnershipArrived',
        payload: {
          agentId,
          fromPartitionKey: 'partition-a',
          transferOperationId: 'transfer-currency',
          circulatingBalanceTransferred: 120,
          agentState: {
            locationId: null,
            physiology: { energy: 40, satiety: 40, health: 80 },
            educationScore: 30,
            balance: 120,
            residentialTier: 1,
            job: null,
            inventory: {},
          },
        },
        occurredAt: 100,
        sequence: 1,
      }),
    );
    expect(arrived.moneySupply).toBe(1_120);

    const departed = applyWorldEvent(
      arrived,
      createEventEnvelope({
        id: asEventId('event-currency-departure'),
        simulationId: 'sim-1',
        type: 'AgentOwnershipDeparted',
        payload: {
          agentId,
          toPartitionKey: 'partition-b',
          transferOperationId: 'transfer-currency',
          circulatingBalanceTransferred: 120,
        },
        occurredAt: 101,
        sequence: 2,
      }),
    );
    expect(departed.moneySupply).toBe(1_000);
    expect(departed.agents[agentId]).toBeUndefined();

    expect(() =>
      applyWorldEvent(
        base,
        createEventEnvelope({
          id: asEventId('event-invalid-currency-arrival'),
          simulationId: 'sim-1',
          type: 'AgentOwnershipArrived',
          payload: {
            agentId,
            fromPartitionKey: 'partition-a',
            transferOperationId: 'transfer-invalid-currency',
            circulatingBalanceTransferred: 121,
            agentState: {
              locationId: null,
              physiology: { energy: 40, satiety: 40, health: 80 },
              educationScore: 30,
              balance: 120,
              residentialTier: 1,
              job: null,
              inventory: {},
            },
          },
          occurredAt: 102,
          sequence: 3,
        }),
      ),
    ).toThrow('circulating balance must equal the Agent balance');
  });

  test('ownership arrival rebuilds the agent with durable lifecycle facts', () => {
    const projection = createWorldProjection({ agents: [] });
    const arrival: WorldEvent = createEventEnvelope({
      id: asEventId('event-arrival-1'),
      simulationId: 'sim-1',
      commandId: 'command-transfer-1',
      type: 'AgentOwnershipArrived',
      payload: {
        agentId: asAgentId('agent-transferred'),
        fromPartitionKey: 'partition-a',
        transferOperationId: 'transfer-1',
        agentState: {
          locationId: null,
          physiology: { energy: 40, satiety: 40, health: 80 },
          educationScore: 30,
          balance: 120,
          residentialTier: 2,
          job: null,
          inventory: {},
          durableGoods: [
            {
              lotId: 'durable-lot-1',
              commodityName: 'Furniture',
              quantity: 1,
              utilityPoints: 12,
              acquiredAt: 100,
              expiresAt: 1_000_000,
            },
          ],
          upkeepArrears: 45,
          wellbeing: 66,
          lifeStage: 'elderly' as const,
          retiredAtMs: 86_400_000,
          registeredAtMs: 5 * 86_400_000,
          educationLevel: 4 as const,
          educationTrack: 'vocational' as const,
          examAttempts: 2,
          registration: {
            registrationId: 'registration-1',
            policyVersion: 'runtime-agent-registration-v3',
            creatorId: 'participant-1',
            source: 'human',
            displayName: 'Migrating Resident',
            registeredAt: 5 * 86_400_000,
            provenance: 'post-bootstrap-command' as const,
            humanAttribution: {
              principalSubjectId: 'participant-1',
              principalRoles: ['participant'],
              accessPolicyVersion: 'participant-access-v1',
              consentPolicyVersion: 'participant-consent-v1',
            },
          },
        },
        activityTime: {
          agentId: asAgentId('agent-transferred'),
          activity: 'travel',
          commandType: 'AgentMoveTo',
          policyVersion: 'exclusive-agent-activity-time-v1',
          settlementTiming: 'effects-at-commit',
          startedAt: 172_000_000,
          durationSeconds: 900,
          availableAt: 172_900_000,
          committedAt: 172_000_000,
        },
        lastTimeSettledAt: 172_000_000,
        physiologicalDistress: {
          policyVersion: 'physiological-safety-net-test',
          distressStartedAt: 171_000_000,
          lowAxes: ['satiety'],
          lastGrantedAt: null,
        },
        socialRelations: [
          {
            sourceAgentId: asAgentId('agent-transferred'),
            targetAgentId: asAgentId('agent-friend'),
            relationLabel: 'friend',
            relationScore: 70,
            attitudeScore: 60,
            interactionCount: 4,
            lastInteractionSummary: 'They agreed to work together.',
          },
        ],
        socialCommitments: [
          {
            commitmentId: 'commitment-1',
            promisorAgentId: asAgentId('agent-transferred'),
            beneficiaryAgentId: asAgentId('agent-friend'),
            topic: 'shared work',
            statement: 'I will help tomorrow',
            status: 'open',
            createdAt: 160_000_000,
          },
        ],
        conflictRecords: [
          {
            conflictId: 'conflict-1',
            kind: 'confrontation',
            actorAgentId: asAgentId('agent-transferred'),
            targetAgentId: asAgentId('agent-rival'),
            locationId: 'main-square',
            summary: 'A prior confrontation',
            recordedAt: 150_000_000,
          },
        ],
      } satisfies AgentOwnershipArrivedPayload,
      occurredAt: 172_800_000,
      sequence: 5,
    });

    const settled = applyWorldEvent(projection, arrival);
    // The retiree keeps the pension accrual and stage on the receiving
    // partition; nothing silently resets to the adult/unretired defaults.
    expect(settled.agents['agent-transferred']).toMatchObject({
      lifeStage: 'elderly',
      retiredAtMs: 86_400_000,
      job: null,
      wellbeing: 66,
      // The registration anchor survives the migration: lifecycle age keeps
      // counting from the original registration, not from time zero.
      registeredAtMs: 5 * 86_400_000,
      // The education aggregate survives the migration: vocational track,
      // production/job multipliers, and exam-attempt caps do not reset.
      educationLevel: 4,
      educationTrack: 'vocational',
      examAttempts: 2,
      durableGoods: [{ lotId: 'durable-lot-1', commodityName: 'Furniture' }],
      upkeepArrears: 45,
      registration: {
        creatorId: 'participant-1',
        displayName: 'Migrating Resident',
        humanAttribution: { principalRoles: ['participant'] },
      },
    });
    expect(settled.activityTimeByAgent['agent-transferred']).toMatchObject({
      activity: 'travel',
      availableAt: 172_900_000,
    });
    expect(settled.timeSettlementByAgent?.['agent-transferred']).toBe(172_000_000);
    expect(settled.physiologicalDistressByAgent['agent-transferred']).toMatchObject({
      distressStartedAt: 171_000_000,
      lowAxes: ['satiety'],
    });
    expect(Object.values(settled.socialRelations)).toMatchObject([
      { sourceAgentId: 'agent-transferred', targetAgentId: 'agent-friend', relationScore: 70 },
    ]);
    expect(settled.socialCommitments['commitment-1']).toMatchObject({ status: 'open' });
    expect(settled.conflictRecords).toMatchObject([
      { conflictId: 'conflict-1', targetAgentId: 'agent-rival' },
    ]);

    const departed = applyWorldEvent(
      settled,
      createEventEnvelope({
        id: asEventId('event-departure-1'),
        simulationId: 'sim-1',
        type: 'AgentOwnershipDeparted',
        payload: {
          agentId: asAgentId('agent-transferred'),
          toPartitionKey: 'partition-c',
          transferOperationId: 'transfer-3',
        },
        occurredAt: 173_000_000,
        sequence: 7,
      }),
    );
    expect(departed.agents['agent-transferred']).toBeUndefined();
    expect(departed.activityTimeByAgent['agent-transferred']).toBeUndefined();
    expect(departed.timeSettlementByAgent?.['agent-transferred']).toBeUndefined();
    expect(departed.physiologicalDistressByAgent['agent-transferred']).toBeUndefined();

    // Legacy arrivals without lifecycle facts stay byte-for-byte compatible.
    const legacy = applyWorldEvent(
      projection,
      createEventEnvelope({
        id: asEventId('event-arrival-2'),
        simulationId: 'sim-1',
        commandId: 'command-transfer-1',
        type: 'AgentOwnershipArrived',
        payload: {
          agentId: asAgentId('agent-legacy'),
          fromPartitionKey: 'partition-a',
          transferOperationId: 'transfer-2',
          agentState: {
            locationId: null,
            physiology: { energy: 40, satiety: 40, health: 80 },
            educationScore: 30,
            balance: 10,
            residentialTier: 1,
            job: 'Cleaner',
            inventory: {},
          },
        },
        occurredAt: 172_800_000,
        sequence: 6,
      }),
    );
    expect(legacy.agents['agent-legacy']).toMatchObject({ job: 'Cleaner' });
    expect(legacy.agents['agent-legacy']?.lifeStage).toBeUndefined();
    expect(legacy.agents['agent-legacy']?.retiredAtMs).toBeUndefined();
    expect(legacy.agents['agent-legacy']?.educationLevel).toBeUndefined();
    expect(legacy.agents['agent-legacy']?.educationTrack).toBeUndefined();
    expect(legacy.agents['agent-legacy']?.examAttempts).toBeUndefined();
  });

  test('death cancels the deceased pending applications but keeps resolved history', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-dying'),
          locationId: null,
          physiology: { energy: 50, satiety: 50, health: 10 },
          educationScore: 30,
          balance: 25,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      jobApplications: [
        {
          applicationId: 'application-pending',
          cycleNumber: 3,
          agentId: asAgentId('agent-dying'),
          occupationName: 'Cleaner',
          residentialTier: 1,
          educationScore: 30,
          submittedAt: 0,
          status: 'pending',
        },
        {
          applicationId: 'application-resolved',
          cycleNumber: 2,
          agentId: asAgentId('agent-dying'),
          occupationName: 'Waiter',
          residentialTier: 1,
          educationScore: 30,
          submittedAt: 0,
          status: 'rejected',
        },
        {
          applicationId: 'application-other',
          cycleNumber: 3,
          agentId: asAgentId('agent-other'),
          occupationName: 'Cleaner',
          residentialTier: 1,
          educationScore: 30,
          submittedAt: 0,
          status: 'pending',
        },
      ],
      physiologicalDistressByAgent: {
        'agent-dying': {
          policyVersion: 'physiological-safety-net-test',
          distressStartedAt: 0,
          lowAxes: ['health'],
          lastGrantedAt: null,
        },
      },
      clock: { now: 0, tickDurationMs: 1000 },
    });
    const projection = applyWorldEvent(
      initial,
      createEventEnvelope({
        id: asEventId('event-activity-1'),
        simulationId: 'sim-1',
        commandId: 'command-action-1',
        type: 'AgentActivityTimeCommitted',
        payload: {
          agentId: asAgentId('agent-dying'),
          activity: 'labor',
          commandType: 'AgentWork',
          policyVersion: 'exclusive-agent-activity-time-v1',
          settlementTiming: 'effects-at-commit',
          startedAt: 0,
          durationSeconds: 10,
          availableAt: 10_000,
        } satisfies AgentActivityTimeCommittedPayload,
        occurredAt: 0,
        sequence: 1,
      }),
    );

    const settled = applyWorldEvent(
      projection,
      createEventEnvelope({
        id: asEventId('event-death-1'),
        simulationId: 'sim-1',
        commandId: 'command-time-1',
        type: 'AgentDied',
        payload: {
          agentId: asAgentId('agent-dying'),
          cause: 'illness' as const,
          diedAt: 1000,
          ageDays: 95,
          lifespanDays: 120,
          retired: false,
          policyVersion: 'town-lifecycle-v1',
          estate: {
            burnedCurrency: 25,
            inventoryByCommodity: {},
            depositForfeited: 0,
            writtenOffLoanIds: [],
          },
        },
        occurredAt: 1000,
        sequence: 2,
      }),
    );

    expect(settled.agents['agent-dying']).toBeUndefined();
    expect(settled.activityTimeByAgent['agent-dying']).toBeUndefined();
    expect(settled.physiologicalDistressByAgent['agent-dying']).toBeUndefined();
    expect(settled.jobApplications.map((application) => application.applicationId)).toEqual([
      'application-resolved',
      'application-other',
    ]);
    expect(settled.moneySupply).toBe(projection.moneySupply - 25);
  });

  test('hydrates closed enterprise history after its owner permanently departed', () => {
    const enterprise = {
      enterpriseId: 'enterprise-closed',
      name: 'Closed Workshop',
      ownerAgentId: asAgentId('agent-departed'),
      occupationName: 'Cleaner',
      balance: 0,
      inventory: {},
      maxEmployees: 2,
      employeeAgentIds: [],
      status: 'closed' as const,
      foundedAt: 0,
      closedAt: 1000,
      cumulativeSales: 0,
      cumulativePurchases: 0,
      cumulativeWages: 0,
    };

    expect(
      createWorldProjection({ agents: [], enterprises: [enterprise] }).enterprises[
        enterprise.enterpriseId
      ],
    ).toMatchObject({ status: 'closed', ownerAgentId: 'agent-departed' });
    expect(() =>
      createWorldProjection({
        agents: [],
        enterprises: [{ ...enterprise, status: 'active' }],
      }),
    ).toThrow('enterprise enterprise-closed has unknown owner');
    expect(() =>
      createWorldProjection({
        agents: [
          {
            agentId: asAgentId('agent-owner'),
            locationId: null,
            physiology: { energy: 100, satiety: 100, health: 100 },
            educationScore: 0,
            balance: 0,
            residentialTier: 1,
            job: null,
            inventory: {},
          },
        ],
        enterprises: [
          {
            ...enterprise,
            ownerAgentId: asAgentId('agent-owner'),
            balance: -1,
            status: 'active',
          },
        ],
      }),
    ).toThrow('enterprise balance must be non-negative finite');
  });
});
