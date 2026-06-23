import { asAgentId } from '@aivilization/sim-core';
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
