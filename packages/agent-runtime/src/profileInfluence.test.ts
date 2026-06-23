import { asMemoryRecordId } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { scoreProfileInfluence, type ProfileInfluenceEntryMatch } from './index';

describe('profile influence scoring', () => {
  test('scores affinity tags against habit, value, personality, and social profile entries', () => {
    const profile = {
      agentId: asAgentId('agent-1'),
      beliefs: [],
      habits: [
        {
          key: 'study',
          statement: 'Studies after work.',
          confidence: 0.8,
          updatedAt: 10,
          provenanceRecordIds: [asMemoryRecordId('reflection-study-1')],
        },
      ],
      values: [
        {
          key: 'cooperation',
          statement: 'Values win-win cooperation.',
          confidence: 0.6,
          updatedAt: 20,
          provenanceRecordIds: [asMemoryRecordId('reflection-cooperation-1')],
        },
      ],
      personality: [
        {
          key: 'patient',
          statement: 'Patient and long-horizon oriented.',
          confidence: 0.5,
          updatedAt: 30,
          provenanceRecordIds: [asMemoryRecordId('reflection-patient-1')],
        },
      ],
      socialRecords: [
        {
          key: 'agent-2',
          statement: 'Shared food and cooperated after work.',
          confidence: 0.4,
          updatedAt: 40,
          provenanceRecordIds: [asMemoryRecordId('reflection-social-1')],
          relationDelta: 0.25,
          attitudeDelta: 0.5,
        },
      ],
    };

    expect(
      scoreProfileInfluence({
        profile,
        affinityTags: ['study', 'cooperation', 'patient', 'shared food'],
      }),
    ).toEqual({
      score: 4.05,
      matches: [
        {
          section: 'habits',
          key: 'study',
          tag: 'study',
          contribution: 1.6,
          provenanceRecordIds: ['reflection-study-1'],
        },
        {
          section: 'values',
          key: 'cooperation',
          tag: 'cooperation',
          contribution: 1.2,
          provenanceRecordIds: ['reflection-cooperation-1'],
        },
        {
          section: 'personality',
          key: 'patient',
          tag: 'patient',
          contribution: 0.5,
          provenanceRecordIds: ['reflection-patient-1'],
        },
        {
          section: 'socialRecords',
          key: 'agent-2',
          tag: 'shared food',
          contribution: 0.75,
          provenanceRecordIds: ['reflection-social-1'],
        },
      ] satisfies readonly ProfileInfluenceEntryMatch[],
    });
  });

  test('returns zero influence for empty affinity tags', () => {
    expect(
      scoreProfileInfluence({
        profile: {
          agentId: asAgentId('agent-1'),
          beliefs: [],
          habits: [],
          values: [],
          personality: [],
          socialRecords: [],
        },
        affinityTags: [],
      }),
    ).toEqual({ score: 0, matches: [] });
  });

  test('sorts matches deterministically by section, key, and tag', () => {
    const result = scoreProfileInfluence({
      profile: {
        agentId: asAgentId('agent-1'),
        beliefs: [],
        habits: [
          {
            key: 'z-study',
            statement: 'study',
            confidence: 0.5,
            updatedAt: 10,
            provenanceRecordIds: [],
          },
          {
            key: 'a-study',
            statement: 'study',
            confidence: 0.5,
            updatedAt: 10,
            provenanceRecordIds: [],
          },
        ],
        values: [],
        personality: [],
        socialRecords: [],
      },
      affinityTags: ['study'],
    });

    expect(result.matches.map((match) => match.key)).toEqual(['a-study', 'z-study']);
  });
});
