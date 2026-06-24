import { asAgentId, type AgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  convertReflectiveInsightsToLongTermMemoryPatches,
  asMemoryRecordId,
  createShortTermMemoryRecord,
  proposeReflectiveInsights,
  type ReflectiveInsightRecord,
} from './index';

const agentId = asAgentId('agent-1');
const otherAgentId = asAgentId('agent-2');

describe('reflective memory insights', () => {
  test('synthesizes repeated successful study memories into a habit insight', () => {
    const records = [
      createMemory({ id: 'study-1', status: 'succeeded', summary: 'Completed study session.' }),
      createMemory({ id: 'study-2', status: 'succeeded', summary: 'Studied in the town library.' }),
      createMemory({ id: 'study-3', status: 'succeeded', summary: 'Finished school practice.' }),
      createMemory({
        id: 'other-agent-study',
        agentId: otherAgentId,
        status: 'succeeded',
        summary: 'Completed study session.',
      }),
    ];

    expect(
      proposeReflectiveInsights({
        agentId,
        records,
        minEvidenceCount: 3,
        generatedAt: 100,
      }),
    ).toEqual([
      {
        id: 'reflection-agent-1-habit-study-routine-100',
        agentId,
        kind: 'habit',
        topicKey: 'study-routine',
        statement: 'Repeated successful study sessions suggest a reliable study routine.',
        confidence: 0.7,
        evidenceRecordIds: [
          asMemoryRecordId('study-1'),
          asMemoryRecordId('study-2'),
          asMemoryRecordId('study-3'),
        ],
        generatedAt: 100,
        tags: ['study', 'education', 'routine'],
      },
    ]);
  });

  test('synthesizes repeated failed work and energy memories into a caution insight', () => {
    const records = [
      createMemory({
        id: 'work-failure-1',
        status: 'failed',
        summary: 'Work failed because energy was depleted.',
        tags: ['work', 'energy'],
        importanceScore: 0.8,
      }),
      createMemory({
        id: 'work-failure-2',
        status: 'failed',
        summary: 'Could not work while tired.',
        tags: ['job', 'tired'],
        importanceScore: 0.6,
      }),
      createMemory({
        id: 'study-success',
        status: 'succeeded',
        summary: 'Studied successfully.',
      }),
    ];

    expect(
      proposeReflectiveInsights({
        agentId,
        records,
        minEvidenceCount: 2,
        generatedAt: 200,
      }),
    ).toEqual([
      {
        id: 'reflection-agent-1-caution-work-energy-risk-200',
        agentId,
        kind: 'caution',
        topicKey: 'work-energy-risk',
        statement: 'Repeated failed work attempts suggest avoiding work when energy is low.',
        confidence: 0.7,
        evidenceRecordIds: [
          asMemoryRecordId('work-failure-1'),
          asMemoryRecordId('work-failure-2'),
        ],
        generatedAt: 200,
        tags: ['work', 'energy', 'risk'],
      },
    ]);
  });

  test('sorts insights by kind and topic key for stable output', () => {
    const records = [
      createMemory({ id: 'study-1', status: 'succeeded', summary: 'Completed study session.' }),
      createMemory({ id: 'study-2', status: 'succeeded', summary: 'Studied in the library.' }),
      createMemory({
        id: 'work-failure-1',
        status: 'failed',
        summary: 'Work failed with low energy.',
        tags: ['work', 'energy'],
      }),
      createMemory({
        id: 'work-failure-2',
        status: 'failed',
        summary: 'Could not work while tired.',
        tags: ['job', 'tired'],
      }),
    ];

    expect(
      proposeReflectiveInsights({
        agentId,
        records,
        minEvidenceCount: 2,
        generatedAt: 300,
      }).map((insight) => `${insight.kind}:${insight.topicKey}`),
    ).toEqual(['caution:work-energy-risk', 'habit:study-routine']);
  });

  test('synthesizes repeated successful social memories into a social habit insight', () => {
    const records = [
      createMemory({
        id: 'social-1',
        status: 'succeeded',
        summary: 'Shared food with agent-2 after work.',
        tags: ['social', 'agent-2'],
      }),
      createMemory({
        id: 'social-2',
        status: 'succeeded',
        summary: 'Studied together with agent-2.',
        tags: ['social', 'agent-2'],
      }),
    ];

    expect(
      proposeReflectiveInsights({
        agentId,
        records,
        minEvidenceCount: 2,
        generatedAt: 400,
      }),
    ).toEqual([
      {
        id: 'reflection-agent-1-habit-social-agent-2-400',
        agentId,
        kind: 'habit',
        topicKey: 'social-agent-2',
        statement: 'Repeated successful social interactions with agent-2 suggest a stable social routine.',
        confidence: 0.7,
        evidenceRecordIds: ['social-1', 'social-2'],
        generatedAt: 400,
        tags: ['social', 'agent-2', 'routine'],
      },
    ]);
  });

  test('synthesizes repeated successful social interactions into value and personality insights', () => {
    const agent2 = asAgentId('agent-2');
    const agent3 = asAgentId('agent-3');
    const records = [
      createSocialInteractionMemory({
        id: 'social-agent-2-1',
        targetAgentId: agent2,
        summary: 'Talked with agent-2 about community routines.',
        occurredAt: 1,
        importanceScore: 0.8,
      }),
      createSocialInteractionMemory({
        id: 'social-agent-3-2',
        targetAgentId: agent3,
        summary: 'Shared plans with agent-3 after a town meeting.',
        occurredAt: 2,
        importanceScore: 0.6,
      }),
    ];

    expect(
      proposeReflectiveInsights({
        agentId,
        records,
        minEvidenceCount: 2,
        generatedAt: 500,
      }),
    ).toEqual([
      {
        id: 'reflection-agent-1-personality-sociable-500',
        agentId,
        kind: 'personality',
        topicKey: 'sociable',
        statement:
          'Repeated positive social interactions with multiple agents suggest a sociable disposition.',
        confidence: 0.7,
        evidenceRecordIds: ['social-agent-2-1', 'social-agent-3-2'],
        generatedAt: 500,
        tags: ['social', 'personality', 'sociable'],
      },
      {
        id: 'reflection-agent-1-value-community-cooperation-500',
        agentId,
        kind: 'value',
        topicKey: 'community-cooperation',
        statement:
          'Repeated positive social interactions suggest the agent values cooperative community routines.',
        confidence: 0.7,
        evidenceRecordIds: ['social-agent-2-1', 'social-agent-3-2'],
        generatedAt: 500,
        tags: ['social', 'community', 'cooperation', 'value'],
      },
    ]);
  });

  test('keeps one-target social interactions scoped to a social habit insight', () => {
    const agent2 = asAgentId('agent-2');
    const records = [
      createSocialInteractionMemory({
        id: 'single-target-social-1',
        targetAgentId: agent2,
        summary: 'Talked with agent-2 about community routines.',
        occurredAt: 1,
      }),
      createSocialInteractionMemory({
        id: 'single-target-social-2',
        targetAgentId: agent2,
        summary: 'Shared plans with agent-2 after a town meeting.',
        occurredAt: 2,
      }),
    ];

    expect(
      proposeReflectiveInsights({
        agentId,
        records,
        minEvidenceCount: 2,
        generatedAt: 600,
      }),
    ).toEqual([
      {
        id: 'reflection-agent-1-habit-social-agent-2-600',
        agentId,
        kind: 'habit',
        topicKey: 'social-agent-2',
        statement:
          'Repeated successful social interactions with agent-2 suggest a stable social routine.',
        confidence: 0.7,
        evidenceRecordIds: ['single-target-social-1', 'single-target-social-2'],
        generatedAt: 600,
        tags: ['social', 'agent-2', 'routine'],
      },
    ]);
  });

  test('ignores hinted pattern records when synthesizing study and caution insights', () => {
    const records = [
      createShortTermMemoryRecord({
        id: 'hinted-study-1',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Completed study session.',
        occurredAt: 1,
        importanceScore: 0.7,
        source: { eventIds: [] },
        tags: ['study'],
        consolidationHint: {
          kind: 'habit',
          patternKey: 'study-before-work',
          statement: 'Studies before work.',
        },
      }),
      createShortTermMemoryRecord({
        id: 'hinted-study-2',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Studied in the town library.',
        occurredAt: 2,
        importanceScore: 0.7,
        source: { eventIds: [] },
        tags: ['study'],
        consolidationHint: {
          kind: 'habit',
          patternKey: 'study-before-work',
          statement: 'Studies before work.',
        },
      }),
      createShortTermMemoryRecord({
        id: 'hinted-work-failure-1',
        agentId,
        kind: 'action',
        status: 'failed',
        summary: 'Work failed because energy was depleted.',
        occurredAt: 3,
        importanceScore: 0.7,
        source: { eventIds: [] },
        tags: ['work', 'energy'],
        consolidationHint: {
          kind: 'caution',
          patternKey: 'work-with-low-energy',
          statement: 'Avoid working while exhausted.',
        },
      }),
      createShortTermMemoryRecord({
        id: 'hinted-work-failure-2',
        agentId,
        kind: 'action',
        status: 'failed',
        summary: 'Could not work while tired.',
        occurredAt: 4,
        importanceScore: 0.7,
        source: { eventIds: [] },
        tags: ['job', 'tired'],
        consolidationHint: {
          kind: 'caution',
          patternKey: 'work-with-low-energy',
          statement: 'Avoid working while exhausted.',
        },
      }),
    ];

    expect(
      proposeReflectiveInsights({
        agentId,
        records,
        minEvidenceCount: 2,
        generatedAt: 700,
      }),
    ).toEqual([]);
  });

  test('converts reflective insights into long-term memory patches with provenance', () => {
    const insights: ReflectiveInsightRecord[] = [
      {
        id: 'reflection-agent-1-habit-study-routine-100',
        agentId,
        kind: 'habit',
        topicKey: 'study-routine',
        statement: 'Repeated successful study sessions suggest a reliable study routine.',
        confidence: 0.7,
        evidenceRecordIds: [
          asMemoryRecordId('study-1'),
          asMemoryRecordId('study-2'),
          asMemoryRecordId('study-3'),
        ],
        generatedAt: 100,
        tags: ['study', 'education', 'routine'],
      },
      {
        id: 'reflection-agent-1-caution-work-energy-risk-200',
        agentId,
        kind: 'caution',
        topicKey: 'work-energy-risk',
        statement: 'Repeated failed work attempts suggest avoiding work when energy is low.',
        confidence: 0.8,
        evidenceRecordIds: [
          asMemoryRecordId('work-failure-1'),
          asMemoryRecordId('work-failure-2'),
        ],
        generatedAt: 200,
        tags: ['work', 'energy', 'risk'],
      },
      {
        id: 'reflection-agent-1-value-community-cooperation-500',
        agentId,
        kind: 'value',
        topicKey: 'community-cooperation',
        statement:
          'Repeated positive social interactions suggest the agent values cooperative community routines.',
        confidence: 0.7,
        evidenceRecordIds: [
          asMemoryRecordId('social-agent-2-1'),
          asMemoryRecordId('social-agent-3-2'),
        ],
        generatedAt: 500,
        tags: ['social', 'community', 'cooperation', 'value'],
      },
      {
        id: 'reflection-agent-1-personality-sociable-500',
        agentId,
        kind: 'personality',
        topicKey: 'sociable',
        statement:
          'Repeated positive social interactions with multiple agents suggest a sociable disposition.',
        confidence: 0.7,
        evidenceRecordIds: [
          asMemoryRecordId('social-agent-2-1'),
          asMemoryRecordId('social-agent-3-2'),
        ],
        generatedAt: 500,
        tags: ['social', 'personality', 'sociable'],
      },
    ];

    expect(convertReflectiveInsightsToLongTermMemoryPatches({ insights })).toEqual([
      {
        id: 'ltm-patch-agent-1-reflection-belief-work-energy-risk-200',
        agentId,
        section: 'beliefs',
        key: 'caution:work-energy-risk',
        statement: 'Repeated failed work attempts suggest avoiding work when energy is low.',
        confidence: 0.8,
        provenanceRecordIds: ['work-failure-1', 'work-failure-2'],
        proposedAt: 200,
      },
      {
        id: 'ltm-patch-agent-1-reflection-habit-study-routine-100',
        agentId,
        section: 'habits',
        key: 'study-routine',
        statement: 'Repeated successful study sessions suggest a reliable study routine.',
        confidence: 0.7,
        provenanceRecordIds: ['study-1', 'study-2', 'study-3'],
        proposedAt: 100,
      },
      {
        id: 'ltm-patch-agent-1-reflection-personality-sociable-500',
        agentId,
        section: 'personality',
        key: 'sociable',
        statement:
          'Repeated positive social interactions with multiple agents suggest a sociable disposition.',
        confidence: 0.7,
        provenanceRecordIds: ['social-agent-2-1', 'social-agent-3-2'],
        proposedAt: 500,
      },
      {
        id: 'ltm-patch-agent-1-reflection-value-community-cooperation-500',
        agentId,
        section: 'values',
        key: 'community-cooperation',
        statement:
          'Repeated positive social interactions suggest the agent values cooperative community routines.',
        confidence: 0.7,
        provenanceRecordIds: ['social-agent-2-1', 'social-agent-3-2'],
        proposedAt: 500,
      },
    ]);
  });
});

function createMemory(input: {
  readonly id: string;
  readonly agentId?: typeof agentId;
  readonly status: 'succeeded' | 'failed' | 'repaired' | 'observed';
  readonly summary: string;
  readonly tags?: readonly string[];
  readonly importanceScore?: number;
}) {
  return createShortTermMemoryRecord({
    id: input.id,
    agentId: input.agentId ?? agentId,
    kind: 'action',
    status: input.status,
    summary: input.summary,
    occurredAt: Number(input.id.match(/\d+/)?.[0] ?? 1),
    importanceScore: input.importanceScore ?? 0.7,
    source: { eventIds: [] },
    tags: input.tags ?? ['study', 'education'],
  });
}

function createSocialInteractionMemory(input: {
  readonly id: string;
  readonly targetAgentId: AgentId;
  readonly summary: string;
  readonly occurredAt: number;
  readonly importanceScore?: number;
}) {
  return createShortTermMemoryRecord({
    id: input.id,
    agentId,
    kind: 'social-interaction',
    status: 'succeeded',
    summary: input.summary,
    occurredAt: input.occurredAt,
    importanceScore: input.importanceScore ?? 0.7,
    source: { eventIds: [] },
    tags: ['conversation', 'community', input.targetAgentId],
    consolidationHint: {
      kind: 'social',
      targetAgentId: input.targetAgentId,
      relationDelta: 1,
      attitudeDelta: 1,
      summary: input.summary,
    },
  });
}
