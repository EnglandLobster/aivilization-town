import { asAgentId, asEventId, createEventEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { applyWorldEvent, createWorldProjection, type WorldEvent } from './index';

describe('lifecycle projection facts', () => {
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
          wellbeing: 66,
          lifeStage: 'elderly' as const,
          retiredAtMs: 86_400_000,
          registeredAtMs: 5 * 86_400_000,
          educationLevel: 4 as const,
          educationTrack: 'vocational' as const,
          examAttempts: 2,
        },
      },
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
    });

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
    const projection = createWorldProjection({
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
      clock: { now: 0, tickDurationMs: 1000 },
    });

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
    expect(settled.jobApplications.map((application) => application.applicationId)).toEqual([
      'application-resolved',
      'application-other',
    ]);
    expect(settled.moneySupply).toBe(projection.moneySupply - 25);
  });
});
