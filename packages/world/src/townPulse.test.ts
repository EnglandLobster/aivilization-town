import { asAgentId, asSimulationId, createEventEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type { WorldEvent } from './events';
import type { WorldTownPulseRecord } from './index';
import { appendWorldTownPulseRecord, WORLD_TOWN_PULSE_RING_CAPACITY } from './townPulse';
import { applyWorldEvent, createWorldProjection } from './projection';

const agentId = asAgentId('agent-dying');
const simulationId = asSimulationId('sim-1');

describe('world town pulse ring', () => {
  test('maps each town-wide event kind onto a pulse record', () => {
    const cases: readonly {
      readonly event: WorldEvent;
      readonly expected: Omit<WorldTownPulseRecord, 'sequence' | 'occurredAt'>;
    }[] = [
      {
        event: createEventEnvelope({
          id: 'event-1',
          simulationId,
          type: 'AgentRegistered',
          occurredAt: 100,
          sequence: 1,
          payload: {
            registrationId: 'register-1',
            policyVersion: 'runtime-agent-registration-v3' as const,
            creatorId: 'participant-1',
            source: 'human' as const,
            displayName: 'Zhang Wei',
            agentId: asAgentId('agent-new'),
            initialState: {
              locationId: null,
              physiology: { energy: 100, satiety: 100, health: 100 },
              educationScore: 0,
              balance: 0,
              residentialTier: 1,
              job: null,
              inventory: {},
            },
            moneySupplyDelta: 0,
          },
        }) satisfies WorldEvent,
        expected: {
          kind: 'arrival',
          subjectAgentId: asAgentId('agent-new'),
          subjectDisplayName: 'Zhang Wei',
        },
      },
      {
        event: createEventEnvelope({
          id: 'event-2',
          simulationId,
          type: 'PetitionThresholdReached',
          occurredAt: 200,
          sequence: 2,
          payload: {
            petitionId: 'petition-1',
            topic: 'town-welfare',
            signatureCount: 3,
            threshold: 3,
            reachedAt: 500,
            policyVersion: 'collective-action-v1',
          },
        }) satisfies WorldEvent,
        expected: { kind: 'petition-threshold', detail: 'town-welfare' },
      },
      {
        event: createEventEnvelope({
          id: 'event-3',
          simulationId,
          type: 'WeatherChanged',
          occurredAt: 300,
          sequence: 3,
          payload: {
            policyVersion: 'town-weather-v1',
            from: 'sunny' as const,
            to: 'rainy' as const,
            transitionedAt: 600,
          },
        }) satisfies WorldEvent,
        expected: { kind: 'weather-change', detail: 'sunny->rainy' },
      },
      {
        event: createEventEnvelope({
          id: 'event-4',
          simulationId,
          type: 'EnterpriseFounded',
          occurredAt: 400,
          sequence: 4,
          payload: {
            enterpriseId: 'enterprise-1',
            name: 'Town Bakery',
            ownerAgentId: agentId,
            occupationName: 'baker',
            initialCapital: 100,
            ownerPreviousBalance: 200,
            ownerNextBalance: 100,
            maxEmployees: 2,
            policyVersion: 'enterprise-v1',
          },
        }) satisfies WorldEvent,
        expected: {
          kind: 'enterprise-founded',
          subjectAgentId: agentId,
          subjectEnterpriseName: 'Town Bakery',
          detail: 'baker',
        },
      },
    ];

    for (const { event, expected } of cases) {
      const records = appendWorldTownPulseRecord({
        records: [],
        event,
        resolveAgentDisplayName: () => undefined,
        resolveEnterpriseName: () => undefined,
      });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ ...expected, sequence: event.sequence });
    }
  });

  test('captures the dying and emigrating agents names from the pre-event state', () => {
    const death = appendWorldTownPulseRecord({
      records: [],
      event: createEventEnvelope({
        id: 'event-death',
        simulationId,
        type: 'AgentDied',
        occurredAt: 1_000,
        sequence: 1,
        payload: {
          agentId,
          cause: 'old-age' as const,
          diedAt: 1_000,
          ageDays: 30_000,
          lifespanDays: 30_000,
          retired: true,
          policyVersion: 'town-lifecycle-v1',
          estate: {
            burnedCurrency: 0,
            inventoryByCommodity: {},
            depositForfeited: 0,
            writtenOffLoanIds: [],
          },
        },
      }) satisfies WorldEvent,
      resolveAgentDisplayName: (subject) => (subject === agentId ? 'Li Na' : undefined),
      resolveEnterpriseName: () => undefined,
    });
    const emigration = appendWorldTownPulseRecord({
      records: [],
      event: createEventEnvelope({
        id: 'event-emigration',
        simulationId,
        type: 'AgentEmigrated',
        occurredAt: 2_000,
        sequence: 2,
        payload: {
          agentId,
          cause: 'dissatisfaction' as const,
          emigratedAt: 2_000,
          wellbeing: 8,
          policyVersion: 'town-migration-v1',
          estate: {
            burnedCurrency: 0,
            inventoryByCommodity: {},
            depositForfeited: 0,
            writtenOffLoanIds: [],
          },
        },
      }) satisfies WorldEvent,
      resolveAgentDisplayName: () => undefined,
      resolveEnterpriseName: () => undefined,
    });

    expect(death[0]).toMatchObject({
      kind: 'death',
      subjectAgentId: agentId,
      subjectDisplayName: 'Li Na',
      detail: 'old-age',
    });
    expect(emigration[0]).toMatchObject({ kind: 'emigration', detail: 'dissatisfaction' });
    expect(emigration[0]?.subjectDisplayName).toBeUndefined();
  });

  test('leaves the ring untouched (same reference) for non-pulse events', () => {
    const records: readonly WorldTownPulseRecord[] = [];
    const next = appendWorldTownPulseRecord({
      records,
      event: createEventEnvelope({
        id: 'event-phase',
        simulationId,
        type: 'TownDayPhaseChanged',
        occurredAt: 100,
        sequence: 1,
        payload: {
          policyVersion: 'town-calendar-v1',
          dayIndex: 1,
          previousPhase: 'day',
          phase: 'evening',
          startedAtMs: 1_000,
          endsAtMs: 2_000,
        },
      }) satisfies WorldEvent,
      resolveAgentDisplayName: () => undefined,
      resolveEnterpriseName: () => undefined,
    });

    expect(next).toBe(records);
  });

  test('caps the ring at its capacity, dropping the oldest records', () => {
    let records: readonly WorldTownPulseRecord[] = [];
    for (let index = 0; index < WORLD_TOWN_PULSE_RING_CAPACITY + 5; index += 1) {
      records = appendWorldTownPulseRecord({
        records,
        event: createEventEnvelope({
          id: `event-petition-${index}`,
          simulationId,
          type: 'PetitionThresholdReached',
          occurredAt: (index + 1) * 100,
          sequence: index + 1,
          payload: {
            petitionId: `petition-${index}`,
            topic: `topic-${index}`,
            signatureCount: 3,
            threshold: 3,
            reachedAt: index * 100,
            policyVersion: 'collective-action-v1',
          },
        }) satisfies WorldEvent,
        resolveAgentDisplayName: () => undefined,
        resolveEnterpriseName: () => undefined,
      });
    }

    expect(records).toHaveLength(WORLD_TOWN_PULSE_RING_CAPACITY);
    expect(records[0]?.detail).toBe('topic-5');
    expect(records[records.length - 1]?.detail).toBe(
      `topic-${WORLD_TOWN_PULSE_RING_CAPACITY + 4}`,
    );
  });

  test('applyWorldEvent snapshots the name before the departure reducer removes the agent', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          locationId: null,
          physiology: { energy: 60, satiety: 50, health: 10 },
          educationScore: 20,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
          registration: {
            registrationId: 'register-1',
            policyVersion: 'runtime-agent-registration-v3',
            creatorId: 'participant-1',
            source: 'human',
            displayName: 'Li Na',
            registeredAt: 0,
            provenance: 'post-bootstrap-command',
          },
        },
      ],
    });

    const next = applyWorldEvent(
      projection,
      createEventEnvelope({
        id: 'event-integration-death',
        simulationId,
        type: 'AgentDied',
        occurredAt: 3_000,
        sequence: 1,
        payload: {
          agentId,
          cause: 'illness' as const,
          diedAt: 3_000,
          ageDays: 12_000,
          lifespanDays: 30_000,
          retired: false,
          policyVersion: 'town-lifecycle-v1',
          estate: {
            burnedCurrency: 0,
            inventoryByCommodity: {},
            depositForfeited: 0,
            writtenOffLoanIds: [],
          },
        },
      }) satisfies WorldEvent,
    );

    expect(next.agents[agentId]).toBeUndefined();
    expect(next.townPulse).toHaveLength(1);
    expect(next.townPulse[0]).toMatchObject({
      kind: 'death',
      subjectAgentId: agentId,
      subjectDisplayName: 'Li Na',
      detail: 'illness',
    });
  });
});
