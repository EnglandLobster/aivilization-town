import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  asMemoryRecordId,
  createEmptyLongTermAgentProfile,
  InMemoryLongTermProfileRepository,
} from './index';

describe('in-memory long-term profile repository', () => {
  test('returns an empty profile when no profile has been saved', async () => {
    const repository = new InMemoryLongTermProfileRepository();
    const agentId = asAgentId('agent-1');

    await expect(repository.getOrCreate(agentId)).resolves.toEqual(
      createEmptyLongTermAgentProfile(agentId),
    );
  });

  test('isolates saved profile snapshots from caller mutation', async () => {
    const repository = new InMemoryLongTermProfileRepository();
    const agentId = asAgentId('agent-1');
    const profile = {
      ...createEmptyLongTermAgentProfile(agentId),
      habits: [
        {
          key: 'study',
          statement: 'Studies after work.',
          confidence: 0.6,
          updatedAt: 10,
          provenanceRecordIds: [asMemoryRecordId('memory-1')],
        },
      ],
      mood: [
        {
          key: 'cooperative-composure',
          statement: 'Maintains cooperative composure.',
          confidence: 0.75,
          updatedAt: 12,
          provenanceRecordIds: [asMemoryRecordId('mood-memory-1')],
        },
      ],
    };

    await repository.save(profile);
    profile.habits[0]!.provenanceRecordIds.push(asMemoryRecordId('mutated'));
    profile.mood[0]!.provenanceRecordIds.push(asMemoryRecordId('mutated-mood'));

    await expect(repository.getOrCreate(agentId)).resolves.toEqual({
      ...createEmptyLongTermAgentProfile(agentId),
      habits: [
        {
          key: 'study',
          statement: 'Studies after work.',
          confidence: 0.6,
          updatedAt: 10,
          provenanceRecordIds: ['memory-1'],
        },
      ],
      mood: [
        {
          key: 'cooperative-composure',
          statement: 'Maintains cooperative composure.',
          confidence: 0.75,
          updatedAt: 12,
          provenanceRecordIds: ['mood-memory-1'],
        },
      ],
    });
  });

  test('applies patches through the repository and stores the updated profile', async () => {
    const repository = new InMemoryLongTermProfileRepository();
    const agentId = asAgentId('agent-1');

    const updated = await repository.applyPatches(agentId, [
      {
        id: 'patch-belief',
        agentId,
        section: 'beliefs',
        key: 'caution:work',
        statement: 'Avoid work while exhausted.',
        confidence: 0.8,
        provenanceRecordIds: [asMemoryRecordId('memory-1')],
        proposedAt: 20,
      },
    ]);

    expect(updated.beliefs).toEqual([
      {
        key: 'caution:work',
        statement: 'Avoid work while exhausted.',
        confidence: 0.8,
        updatedAt: 20,
        provenanceRecordIds: ['memory-1'],
      },
    ]);
    await expect(repository.getOrCreate(agentId)).resolves.toEqual(updated);
  });
});
