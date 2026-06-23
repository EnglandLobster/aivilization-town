import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyLongTermMemoryPatch,
  applyLongTermMemoryPatches,
  asMemoryRecordId,
  createEmptyLongTermAgentProfile,
  type LongTermMemoryPatch,
} from './index';

describe('long-term agent profile patch application', () => {
  test('creates an empty long-term profile for an agent', () => {
    const agentId = asAgentId('agent-1');

    expect(createEmptyLongTermAgentProfile(agentId)).toEqual({
      agentId,
      beliefs: [],
      habits: [],
      values: [],
      personality: [],
      socialRecords: [],
    });
  });

  test('inserts a new patch into the matching profile section', () => {
    const agentId = asAgentId('agent-1');
    const profile = createEmptyLongTermAgentProfile(agentId);
    const patch: LongTermMemoryPatch = {
      id: 'patch-habit-study',
      agentId,
      section: 'habits',
      key: 'study',
      statement: 'Studies after work.',
      confidence: 0.6,
      provenanceRecordIds: [asMemoryRecordId('memory-1')],
      proposedAt: 10,
    };

    expect(applyLongTermMemoryPatch(profile, patch).habits).toEqual([
      {
        key: 'study',
        statement: 'Studies after work.',
        confidence: 0.6,
        updatedAt: 10,
        provenanceRecordIds: ['memory-1'],
      },
    ]);
  });

  test('replaces same-section entries while merging provenance deterministically', () => {
    const agentId = asAgentId('agent-1');
    const profile = applyLongTermMemoryPatches(createEmptyLongTermAgentProfile(agentId), [
      {
        id: 'patch-habit-old',
        agentId,
        section: 'habits',
        key: 'study',
        statement: 'Studies sometimes.',
        confidence: 0.4,
        provenanceRecordIds: [asMemoryRecordId('memory-1'), asMemoryRecordId('memory-2')],
        proposedAt: 10,
      },
      {
        id: 'patch-habit-new',
        agentId,
        section: 'habits',
        key: 'study',
        statement: 'Consistently studies after work.',
        confidence: 0.8,
        provenanceRecordIds: [asMemoryRecordId('memory-2'), asMemoryRecordId('memory-3')],
        proposedAt: 20,
      },
    ]);

    expect(profile.habits).toEqual([
      {
        key: 'study',
        statement: 'Consistently studies after work.',
        confidence: 0.8,
        updatedAt: 20,
        provenanceRecordIds: ['memory-1', 'memory-2', 'memory-3'],
      },
    ]);
  });

  test('preserves social relation metadata on social record patches', () => {
    const agentId = asAgentId('agent-1');
    const targetAgentId = asAgentId('agent-2');
    const profile = applyLongTermMemoryPatch(createEmptyLongTermAgentProfile(agentId), {
      id: 'patch-social',
      agentId,
      section: 'socialRecords',
      key: targetAgentId,
      statement: 'Shared food after work.',
      confidence: 0.7,
      provenanceRecordIds: [asMemoryRecordId('social-1')],
      proposedAt: 30,
      relationDelta: 0.25,
      attitudeDelta: 0.5,
    });

    expect(profile.socialRecords).toEqual([
      {
        key: 'agent-2',
        statement: 'Shared food after work.',
        confidence: 0.7,
        updatedAt: 30,
        provenanceRecordIds: ['social-1'],
        relationDelta: 0.25,
        attitudeDelta: 0.5,
      },
    ]);
  });

  test('rejects patches for a different agent', () => {
    const profile = createEmptyLongTermAgentProfile(asAgentId('agent-1'));

    expect(() =>
      applyLongTermMemoryPatch(profile, {
        id: 'patch-other-agent',
        agentId: asAgentId('agent-2'),
        section: 'beliefs',
        key: 'caution:work',
        statement: 'Avoid work while exhausted.',
        confidence: 0.8,
        provenanceRecordIds: [asMemoryRecordId('memory-1')],
        proposedAt: 10,
      }),
    ).toThrow(/patch agent agent-2 does not match profile agent agent-1/);
  });
});
