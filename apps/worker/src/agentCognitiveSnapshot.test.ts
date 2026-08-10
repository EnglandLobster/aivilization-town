import { describe, expect, test } from 'vitest';
import { createBranchPlan } from '@aivilization/agent-runtime';
import { InMemoryBranchPlanProgressRepository } from '@aivilization/agent-runtime';
import { InMemoryBranchPlanRepository } from '@aivilization/agent-runtime';
import {
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  asMemoryRecordId,
  type ShortTermMemoryRecord,
} from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import {
  captureAgentCognitiveSnapshot,
  hydrateAgentCognitiveSnapshot,
} from './agentCognitiveSnapshot';
import type { LocalWorldRuntimeStorage } from './localRuntimeStorage';

const agentId = asAgentId('agent-migrant');
const planId = 'objective-migrant-1';

describe('agent cognitive snapshot', () => {
  test('captures the durable cognitive state and hydrates it idempotently at the destination', async () => {
    const source = createFakeStorage();
    const recordEarly = createMemoryRecord('stm-1', 10);
    const recordLate = createMemoryRecord('stm-2', 20);
    // Append in non-chronological order to prove the snapshot reorders by time.
    await source.shortTermMemoryRepository.appendMany([recordLate, recordEarly]);
    await source.longTermProfileRepository.save({
      agentId,
      beliefs: [],
      habits: [],
      mood: [],
      values: [
        {
          key: 'community-cooperation',
          statement: 'Values cooperative routines.',
          confidence: 0.9,
          updatedAt: 15,
          provenanceRecordIds: [],
        },
      ],
      personality: [],
      socialRecords: [],
    });
    await source.intentionRepository.setObjective(agentId, {
      id: planId,
      agentId,
      statement: 'Keep the town fed.',
      priority: 1,
      source: 'agent',
      affinityTags: ['eat'],
      createdAt: 5,
      updatedAt: 5,
    });
    await source.planRepository.save({
      planId,
      agentId,
      plan: createBranchPlan({
        objective: 'Keep the town fed.',
        branches: [
          {
            id: 'lane-eat',
            objective: 'Secure food.',
            subtasks: [{ id: 'step-eat', description: 'Buy bread.', basePriority: 5 }],
          },
        ],
      }),
      createdAt: 5,
      updatedAt: 5,
    });
    await source.planProgressRepository.save({
      planId,
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 5,
    });

    const snapshot = await captureAgentCognitiveSnapshot({
      storage: source,
      agentId,
      sourcePartitionKey: 'world-main',
      capturedAt: 100,
    });

    expect(snapshot.shortTermMemory.map((record) => record.id)).toEqual([
      asMemoryRecordId('stm-1'),
      asMemoryRecordId('stm-2'),
    ]);
    expect(snapshot.longTermProfile.values).toHaveLength(1);
    expect(snapshot.intention.activeObjective?.id).toBe(planId);
    expect(snapshot.plan?.planId).toBe(planId);
    expect(snapshot.planProgress?.planId).toBe(planId);

    // Fresh destination: hydration transfers everything.
    const destination = createFakeStorage();
    await hydrateAgentCognitiveSnapshot({ storage: destination, snapshot });

    expect(await destination.shortTermMemoryRepository.retrieve({ agentId, limit: 64 })).toHaveLength(2);
    expect((await destination.longTermProfileRepository.getOrCreate(agentId)).values).toHaveLength(1);
    expect((await destination.intentionRepository.getOrCreate(agentId)).activeObjective?.id).toBe(
      planId,
    );
    expect(await destination.planRepository.get({ planId, agentId })).toBeDefined();
    expect(await destination.planProgressRepository.get({ planId, agentId })).toBeDefined();

    // Replaying the same arrival delivery must not duplicate or clobber.
    await hydrateAgentCognitiveSnapshot({ storage: destination, snapshot });
    expect(await destination.shortTermMemoryRepository.retrieve({ agentId, limit: 64 })).toHaveLength(2);
  });

  test('never clobbers a destination where the agent already lived', async () => {
    const source = createFakeStorage();
    await source.intentionRepository.setObjective(agentId, {
      id: planId,
      agentId,
      statement: 'Source objective.',
      priority: 1,
      source: 'agent',
      affinityTags: ['source'],
      createdAt: 5,
      updatedAt: 5,
    });
    const snapshot = await captureAgentCognitiveSnapshot({
      storage: source,
      agentId,
      sourcePartitionKey: 'world-main',
      capturedAt: 100,
    });

    const destination = createFakeStorage();
    await destination.intentionRepository.setObjective(agentId, {
      id: 'objective-local',
      agentId,
      statement: 'Destination objective.',
      priority: 1,
      source: 'agent',
      affinityTags: ['destination'],
      createdAt: 50,
      updatedAt: 50,
    });
    await destination.longTermProfileRepository.save({
      agentId,
      beliefs: [],
      habits: [],
      mood: [],
      values: [
        {
          key: 'local-value',
          statement: 'Learned after arrival.',
          confidence: 0.5,
          updatedAt: 60,
          provenanceRecordIds: [],
        },
      ],
      personality: [],
      socialRecords: [],
    });

    await hydrateAgentCognitiveSnapshot({ storage: destination, snapshot });

    expect((await destination.intentionRepository.getOrCreate(agentId)).activeObjective?.id).toBe(
      'objective-local',
    );
    expect((await destination.longTermProfileRepository.getOrCreate(agentId)).values[0]?.key).toBe(
      'local-value',
    );
  });
});

function createMemoryRecord(id: string, occurredAt: number): ShortTermMemoryRecord {
  return {
    id: asMemoryRecordId(id),
    agentId,
    kind: 'observation',
    status: 'observed',
    summary: `observation ${id}`,
    occurredAt,
    importanceScore: 0.5,
    source: { eventIds: [] },
    tags: [],
  };
}

function createFakeStorage(): LocalWorldRuntimeStorage {
  return {
    shortTermMemoryRepository: new InMemoryShortTermMemoryRepository(),
    longTermProfileRepository: new InMemoryLongTermProfileRepository(),
    intentionRepository: new InMemoryAgentIntentionRepository(),
    planRepository: new InMemoryBranchPlanRepository(),
    planProgressRepository: new InMemoryBranchPlanProgressRepository(),
  } as unknown as LocalWorldRuntimeStorage;
}
