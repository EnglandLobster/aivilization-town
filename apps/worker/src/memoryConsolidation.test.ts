import {
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  asMemoryRecordId,
  createShortTermMemoryRecord,
  type ReflectiveInsightSynthesizer,
  type SocialModelSynthesizer,
} from '@aivilization/memory';
import { InMemorySocialReflectionObservationRepository } from '@aivilization/observability';
import { asAgentId, asSimulationId } from '@aivilization/sim-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileMemoryConsolidationCursorStore,
  InMemoryMemoryConsolidationCursorStore,
  runWorkerMemoryConsolidation,
  runWorkerMemoryConsolidationBatch,
  runWorkerMemoryConsolidationSchedule,
} from './index';

const agentId = asAgentId('agent-1');
const otherAgentId = asAgentId('agent-2');
const thirdAgentId = asAgentId('agent-3');
const simulationId = asSimulationId('sim-social');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function createStudyMemory(index: number, input: { readonly agentId?: typeof agentId } = {}) {
  const ownerAgentId = input.agentId ?? agentId;
  return createShortTermMemoryRecord({
    id: `memory-${ownerAgentId}-${index}`,
    agentId: ownerAgentId,
    kind: 'action',
    status: 'succeeded',
    summary: 'Completed a focused study session.',
    occurredAt: index,
    importanceScore: 0.6,
    source: { eventIds: [] },
    tags: ['study'],
    consolidationHint: {
      kind: 'habit',
      patternKey: 'study-before-work',
      statement: 'Studies before starting work.',
    },
  });
}

function createUnhintedStudyMemory(
  index: number,
  input: { readonly agentId?: typeof agentId } = {},
) {
  const ownerAgentId = input.agentId ?? agentId;
  return createShortTermMemoryRecord({
    id: `reflection-study-${ownerAgentId}-${index}`,
    agentId: ownerAgentId,
    kind: 'action',
    status: 'succeeded',
    summary: 'Completed a focused study session.',
    occurredAt: index,
    importanceScore: 0.7,
    source: { eventIds: [] },
    tags: ['study', 'education'],
  });
}

function createSocialInteractionMemory(input: {
  readonly index: number;
  readonly targetAgentId: typeof agentId;
  readonly summary: string;
  readonly importanceScore: number;
}) {
  return createShortTermMemoryRecord({
    id: `social-${input.targetAgentId}-${input.index}`,
    agentId,
    kind: 'social-interaction',
    status: 'succeeded',
    summary: input.summary,
    occurredAt: input.index,
    importanceScore: input.importanceScore,
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

describe('worker memory consolidation', () => {
  test('synthesizes unhinted short-term memories into reflective long-term profile entries', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    await shortTermMemoryRepository.appendMany([
      createUnhintedStudyMemory(1),
      createUnhintedStudyMemory(2),
      createUnhintedStudyMemory(3),
    ]);

    const result = await runWorkerMemoryConsolidation({
      agentId,
      shortTermMemoryRepository,
      longTermProfileRepository,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 1000,
    });

    expect(result.reflectiveInsights).toEqual([
      {
        id: 'reflection-agent-1-habit-study-routine-1000',
        agentId,
        kind: 'habit',
        topicKey: 'study-routine',
        statement: 'Repeated successful study sessions suggest a reliable study routine.',
        confidence: 0.7,
        evidenceRecordIds: [
          'reflection-study-agent-1-1',
          'reflection-study-agent-1-2',
          'reflection-study-agent-1-3',
        ],
        generatedAt: 1000,
        tags: ['study', 'education', 'routine'],
      },
    ]);
    expect(result.patches).toEqual([
      {
        id: 'ltm-patch-agent-1-reflection-habit-study-routine-1000',
        agentId,
        section: 'habits',
        key: 'study-routine',
        statement: 'Repeated successful study sessions suggest a reliable study routine.',
        confidence: 0.7,
        provenanceRecordIds: [
          'reflection-study-agent-1-1',
          'reflection-study-agent-1-2',
          'reflection-study-agent-1-3',
        ],
        proposedAt: 1000,
      },
    ]);
    expect(result.profile.habits).toEqual([
      {
        key: 'study-routine',
        statement: 'Repeated successful study sessions suggest a reliable study routine.',
        confidence: 0.7,
        provenanceRecordIds: [
          'reflection-study-agent-1-1',
          'reflection-study-agent-1-2',
          'reflection-study-agent-1-3',
        ],
        updatedAt: 1000,
      },
    ]);
    await expect(longTermProfileRepository.getOrCreate(agentId)).resolves.toEqual(result.profile);
  });

  test('uses an injected reflective insight synthesizer and exposes its trace', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    await shortTermMemoryRepository.append(createTradeMemory(1));
    const synthesizerCalls: Parameters<ReflectiveInsightSynthesizer>[0][] = [];
    const reflectiveInsightSynthesizer: ReflectiveInsightSynthesizer = (input) => {
      synthesizerCalls.push(input);
      return {
        insights: [
          {
            id: 'reflection-agent-1-value-market-patience-1500',
            agentId,
            kind: 'value',
            topicKey: 'market-patience',
            statement: 'The agent values waiting for better market conditions.',
            confidence: 0.8,
            evidenceRecordIds: [asMemoryRecordId('trade-memory-1')],
            generatedAt: 1500,
            tags: ['trade', 'market', 'value'],
          },
        ],
        trace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'reflection-agent-1-1500',
          providerId: 'scripted-reflection',
          model: 'reflection-model',
        },
      };
    };

    const result = await runWorkerMemoryConsolidation({
      agentId,
      shortTermMemoryRepository,
      longTermProfileRepository,
      retrievalLimit: 10,
      minPatternCount: 1,
      proposedAt: 1500,
      reflectiveInsightSynthesizer,
    });

    expect(synthesizerCalls).toHaveLength(1);
    expect(synthesizerCalls[0]).toMatchObject({
      agentId,
      minEvidenceCount: 1,
      generatedAt: 1500,
      longTermProfile: { agentId },
    });
    expect(result.reflectionSynthesisTrace).toEqual({
      status: 'accepted',
      source: 'llm',
      requestId: 'reflection-agent-1-1500',
      providerId: 'scripted-reflection',
      model: 'reflection-model',
    });
    expect(result.reflectiveInsights.map((insight) => insight.topicKey)).toEqual([
      'market-patience',
    ]);
    expect(result.patches).toEqual([
      {
        id: 'ltm-patch-agent-1-reflection-value-market-patience-1500',
        agentId,
        section: 'values',
        key: 'market-patience',
        statement: 'The agent values waiting for better market conditions.',
        confidence: 0.8,
        provenanceRecordIds: ['trade-memory-1'],
        proposedAt: 1500,
      },
    ]);
    expect(result.profile.values).toEqual([
      {
        key: 'market-patience',
        statement: 'The agent values waiting for better market conditions.',
        confidence: 0.8,
        provenanceRecordIds: ['trade-memory-1'],
        updatedAt: 1500,
      },
    ]);
  });

  test('uses an injected social model synthesizer for social profile patches and reflections', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    await shortTermMemoryRepository.append(
      createSocialInteractionMemory({
        index: 1,
        targetAgentId: otherAgentId,
        summary: 'Shared food after work.',
        importanceScore: 0.8,
      }),
    );
    const synthesizerCalls: Parameters<SocialModelSynthesizer>[0][] = [];
    const socialModelSynthesizer: SocialModelSynthesizer = (input) => {
      synthesizerCalls.push(input);
      return {
        patches: [
          {
            id: 'ltm-patch-agent-1-social-agent-2-1700',
            agentId,
            section: 'socialRecords',
            key: otherAgentId,
            statement: 'agent-2 reliably shares food during recovery windows.',
            confidence: 0.9,
            provenanceRecordIds: [asMemoryRecordId('social-agent-2-1')],
            proposedAt: 1700,
            relationDelta: 2,
            attitudeDelta: 1,
          },
        ],
        socialReflections: [
          {
            id: 'social-reflection-agent-1-agent-2-llm-0-1700',
            agentId,
            targetAgentId: otherAgentId,
            statement: 'agent-2 is becoming a trusted food-sharing partner.',
            relationDelta: 2,
            attitudeDelta: 1,
            confidence: 0.9,
            evidenceRecordIds: [asMemoryRecordId('social-agent-2-1')],
            generatedAt: 1700,
            tags: ['social', 'post-interaction-reflection', 'agent-2', 'food'],
          },
        ],
        trace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'social-model-agent-1-1700',
          providerId: 'scripted-social-model',
          model: 'social-model',
        },
      };
    };

    const result = await runWorkerMemoryConsolidation({
      agentId,
      shortTermMemoryRepository,
      longTermProfileRepository,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 1700,
      socialModelSynthesizer,
    });

    expect(synthesizerCalls).toHaveLength(1);
    expect(synthesizerCalls[0]).toMatchObject({
      agentId,
      generatedAt: 1700,
      longTermProfile: { agentId },
    });
    expect(synthesizerCalls[0]?.records.map((record) => record.id)).toEqual(['social-agent-2-1']);
    expect(result.socialModelSynthesisTrace).toEqual({
      status: 'accepted',
      source: 'llm',
      requestId: 'social-model-agent-1-1700',
      providerId: 'scripted-social-model',
      model: 'social-model',
    });
    expect(result.socialReflections).toEqual([
      {
        id: 'social-reflection-agent-1-agent-2-llm-0-1700',
        agentId,
        targetAgentId: otherAgentId,
        statement: 'agent-2 is becoming a trusted food-sharing partner.',
        relationDelta: 2,
        attitudeDelta: 1,
        confidence: 0.9,
        evidenceRecordIds: ['social-agent-2-1'],
        generatedAt: 1700,
        tags: ['social', 'post-interaction-reflection', 'agent-2', 'food'],
      },
    ]);
    expect(result.patches).toEqual([
      {
        id: 'ltm-patch-agent-1-social-agent-2-1700',
        agentId,
        section: 'socialRecords',
        key: otherAgentId,
        statement: 'agent-2 reliably shares food during recovery windows.',
        confidence: 0.9,
        provenanceRecordIds: ['social-agent-2-1'],
        proposedAt: 1700,
        relationDelta: 2,
        attitudeDelta: 1,
      },
    ]);
    expect(result.profile.socialRecords).toEqual([
      {
        key: otherAgentId,
        statement: 'agent-2 reliably shares food during recovery windows.',
        confidence: 0.9,
        provenanceRecordIds: ['social-agent-2-1'],
        updatedAt: 1700,
        relationDelta: 2,
        attitudeDelta: 1,
      },
    ]);
  });

  test('promotes repeated short-term memory patterns into long-term profile entries', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    await shortTermMemoryRepository.appendMany([
      createStudyMemory(1),
      createStudyMemory(2),
      createStudyMemory(3),
    ]);

    const result = await runWorkerMemoryConsolidation({
      agentId,
      shortTermMemoryRepository,
      longTermProfileRepository,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 1000,
    });

    expect(result.records.map((record) => record.id)).toEqual([
      'memory-agent-1-3',
      'memory-agent-1-2',
      'memory-agent-1-1',
    ]);
    expect(result.patches).toEqual([
      {
        id: 'ltm-patch-agent-1-habit-study-before-work-1000',
        agentId,
        section: 'habits',
        key: 'study-before-work',
        statement: 'Studies before starting work.',
        confidence: 0.6,
        provenanceRecordIds: ['memory-agent-1-1', 'memory-agent-1-2', 'memory-agent-1-3'],
        proposedAt: 1000,
      },
    ]);
    expect(result.profile.habits).toEqual([
      {
        key: 'study-before-work',
        statement: 'Studies before starting work.',
        confidence: 0.6,
        provenanceRecordIds: ['memory-agent-1-1', 'memory-agent-1-2', 'memory-agent-1-3'],
        updatedAt: 1000,
      },
    ]);
    await expect(longTermProfileRepository.getOrCreate(agentId)).resolves.toEqual(result.profile);
  });

  test('promotes positive social memories into social records, values, and personality', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    await shortTermMemoryRepository.appendMany([
      createSocialInteractionMemory({
        index: 1,
        targetAgentId: otherAgentId,
        summary: 'Talked with agent-2 about community routines.',
        importanceScore: 0.8,
      }),
      createSocialInteractionMemory({
        index: 2,
        targetAgentId: thirdAgentId,
        summary: 'Shared plans with agent-3 after a town meeting.',
        importanceScore: 0.6,
      }),
    ]);

    const result = await runWorkerMemoryConsolidation({
      agentId,
      shortTermMemoryRepository,
      longTermProfileRepository,
      retrievalLimit: 10,
      minPatternCount: 2,
      proposedAt: 2000,
    });

    expect(result.reflectiveInsights.map((insight) => insight.kind)).toEqual([
      'mood',
      'personality',
      'value',
    ]);
    expect(result.patches.map((patch) => `${patch.section}:${patch.key}`)).toEqual([
      'socialRecords:agent-2',
      'socialRecords:agent-3',
      'mood:cooperative-composure',
      'personality:sociable',
      'values:community-cooperation',
    ]);
    expect(result.profile.socialRecords).toHaveLength(2);
    expect(result.profile.socialRecords.map((entry) => entry.key)).toEqual(['agent-2', 'agent-3']);
    expect(result.profile.personality).toEqual([
      {
        key: 'sociable',
        statement:
          'Repeated positive social interactions with multiple agents suggest a sociable disposition.',
        confidence: 0.7,
        provenanceRecordIds: ['social-agent-2-1', 'social-agent-3-2'],
        updatedAt: 2000,
      },
    ]);
    expect(result.profile.mood).toEqual([
      {
        key: 'cooperative-composure',
        statement: 'Repeated positive social interactions suggest a cooperative and composed mood.',
        confidence: 0.7,
        provenanceRecordIds: ['social-agent-2-1', 'social-agent-3-2'],
        updatedAt: 2000,
      },
    ]);
    expect(result.profile.values).toEqual([
      {
        key: 'community-cooperation',
        statement:
          'Repeated positive social interactions suggest the agent values cooperative community routines.',
        confidence: 0.7,
        provenanceRecordIds: ['social-agent-2-1', 'social-agent-3-2'],
        updatedAt: 2000,
      },
    ]);
  });

  test('returns immediate social reflection artifacts for single social interactions', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    await shortTermMemoryRepository.append(
      createSocialInteractionMemory({
        index: 1,
        targetAgentId: otherAgentId,
        summary: 'Shared food after work.',
        importanceScore: 0.8,
      }),
    );

    const result = await runWorkerMemoryConsolidation({
      agentId,
      shortTermMemoryRepository,
      longTermProfileRepository,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 2000,
    });

    expect(result.socialReflections).toEqual([
      {
        id: 'social-reflection-agent-1-agent-2-social-agent-2-1-2000',
        agentId,
        targetAgentId: otherAgentId,
        statement:
          'Interaction with agent-2 changed relation by 1 and attitude by 1: Shared food after work.',
        relationDelta: 1,
        attitudeDelta: 1,
        confidence: 0.8,
        evidenceRecordIds: ['social-agent-2-1'],
        generatedAt: 2000,
        tags: ['social', 'post-interaction-reflection', 'agent-2', 'conversation', 'community'],
      },
    ]);
    expect(result.reflectiveInsights).toEqual([]);
    expect(result.patches).toEqual([
      {
        id: 'ltm-patch-agent-1-social-agent-2-2000',
        agentId,
        section: 'socialRecords',
        key: 'agent-2',
        statement: 'Shared food after work.',
        confidence: 0.8,
        provenanceRecordIds: ['social-agent-2-1'],
        proposedAt: 2000,
        relationDelta: 1,
        attitudeDelta: 1,
      },
    ]);
    expect(result.profile.socialRecords).toEqual([
      {
        key: 'agent-2',
        statement: 'Shared food after work.',
        confidence: 0.8,
        provenanceRecordIds: ['social-agent-2-1'],
        updatedAt: 2000,
        relationDelta: 1,
        attitudeDelta: 1,
      },
    ]);
  });

  test('leaves the profile unchanged when not enough records match a consolidation pattern', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    await shortTermMemoryRepository.appendMany([createStudyMemory(1), createStudyMemory(2)]);

    const result = await runWorkerMemoryConsolidation({
      agentId,
      shortTermMemoryRepository,
      longTermProfileRepository,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 1000,
    });

    expect(result.records).toHaveLength(2);
    expect(result.patches).toEqual([]);
    expect(result.profile.habits).toEqual([]);
  });

  test('runs consolidation once per unique agent in first-seen order', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    await shortTermMemoryRepository.appendMany([
      createStudyMemory(1, { agentId }),
      createStudyMemory(2, { agentId }),
      createStudyMemory(3, { agentId }),
      createStudyMemory(1, { agentId: otherAgentId }),
      createStudyMemory(2, { agentId: otherAgentId }),
      createStudyMemory(3, { agentId: otherAgentId }),
    ]);

    const result = await runWorkerMemoryConsolidationBatch({
      agentIds: [otherAgentId, agentId, otherAgentId],
      shortTermMemoryRepository,
      longTermProfileRepository,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 1000,
    });

    expect(result.agentIds).toEqual([otherAgentId, agentId]);
    expect(result.results.map((agentResult) => agentResult.agentId)).toEqual([
      otherAgentId,
      agentId,
    ]);
    expect(result.patchCount).toBe(2);
    await expect(longTermProfileRepository.getOrCreate(agentId)).resolves.toMatchObject({
      habits: [{ key: 'study-before-work' }],
    });
    await expect(longTermProfileRepository.getOrCreate(otherAgentId)).resolves.toMatchObject({
      habits: [{ key: 'study-before-work' }],
    });
  });

  test('runs scheduled consolidation only for records after each agent cursor', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const cursorStore = new InMemoryMemoryConsolidationCursorStore();
    await shortTermMemoryRepository.appendMany([
      createStudyMemory(1),
      createStudyMemory(2),
      createStudyMemory(3),
    ]);

    const first = await runWorkerMemoryConsolidationSchedule({
      agentIds: [agentId],
      shortTermMemoryRepository,
      longTermProfileRepository,
      cursorStore,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 1000,
    });

    expect(first.results[0]?.records.map((record) => record.id)).toEqual([
      'memory-agent-1-1',
      'memory-agent-1-2',
      'memory-agent-1-3',
    ]);
    expect(first.patchCount).toBe(1);
    expect(first.cursors).toEqual([
      {
        agentId,
        lastProcessedOccurredAt: 3,
        updatedAt: 1000,
      },
    ]);

    const second = await runWorkerMemoryConsolidationSchedule({
      agentIds: [agentId],
      shortTermMemoryRepository,
      longTermProfileRepository,
      cursorStore,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 2000,
    });

    expect(second.results[0]?.records).toEqual([]);
    expect(second.patchCount).toBe(0);
    expect(second.cursors).toEqual([]);

    await shortTermMemoryRepository.appendMany([
      createStudyMemory(4),
      createStudyMemory(5),
      createStudyMemory(6),
    ]);

    const third = await runWorkerMemoryConsolidationSchedule({
      agentIds: [agentId],
      shortTermMemoryRepository,
      longTermProfileRepository,
      cursorStore,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 3000,
    });

    expect(third.results[0]?.records.map((record) => record.id)).toEqual([
      'memory-agent-1-4',
      'memory-agent-1-5',
      'memory-agent-1-6',
    ]);
    expect(third.patchCount).toBe(1);
    expect(third.cursors).toEqual([
      {
        agentId,
        lastProcessedOccurredAt: 6,
        updatedAt: 3000,
      },
    ]);
  });

  test('passes an injected reflective insight synthesizer through scheduled consolidation', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const cursorStore = new InMemoryMemoryConsolidationCursorStore();
    await shortTermMemoryRepository.append(createTradeMemory(1));
    const reflectiveInsightSynthesizer: ReflectiveInsightSynthesizer = () => ({
      insights: [
        {
          id: 'reflection-agent-1-value-market-patience-2500',
          agentId,
          kind: 'value',
          topicKey: 'market-patience',
          statement: 'The agent values waiting for better market conditions.',
          confidence: 0.8,
          evidenceRecordIds: [asMemoryRecordId('trade-memory-1')],
          generatedAt: 2500,
          tags: ['trade', 'market', 'value'],
        },
      ],
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'reflection-agent-1-2500',
        providerId: 'scripted-reflection',
        model: 'reflection-model',
      },
    });

    const result = await runWorkerMemoryConsolidationSchedule({
      agentIds: [agentId],
      shortTermMemoryRepository,
      longTermProfileRepository,
      cursorStore,
      retrievalLimit: 10,
      minPatternCount: 1,
      proposedAt: 2500,
      reflectiveInsightSynthesizer,
    });

    expect(result.patchCount).toBe(1);
    expect(result.results[0]?.reflectionSynthesisTrace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'reflection-agent-1-2500',
    });
    expect(result.results[0]?.profile.values).toEqual([
      {
        key: 'market-patience',
        statement: 'The agent values waiting for better market conditions.',
        confidence: 0.8,
        provenanceRecordIds: ['trade-memory-1'],
        updatedAt: 2500,
      },
    ]);
  });

  test('gates scheduled reflection by accumulated pending memory importance', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const cursorStore = new InMemoryMemoryConsolidationCursorStore();
    await shortTermMemoryRepository.appendMany([
      createLowImportanceStudyMemory(1),
      createLowImportanceStudyMemory(2),
    ]);

    const belowThreshold = await runWorkerMemoryConsolidationSchedule({
      agentIds: [agentId],
      shortTermMemoryRepository,
      longTermProfileRepository,
      cursorStore,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 1000,
      reflectionTrigger: { minimumImportanceScore: 1 },
    });

    expect(belowThreshold.results).toEqual([]);
    expect(belowThreshold.patchCount).toBe(0);
    expect(belowThreshold.cursors).toEqual([]);
    expect(belowThreshold.skipped).toEqual([
      {
        agentId,
        reason: 'importance-threshold-not-met',
        pendingRecordCount: 2,
        pendingImportanceScore: 0.8,
        minimumImportanceScore: 1,
      },
    ]);
    await expect(cursorStore.getCursor(agentId)).resolves.toBeUndefined();
    await expect(longTermProfileRepository.getOrCreate(agentId)).resolves.toMatchObject({
      habits: [],
    });

    await shortTermMemoryRepository.append(createLowImportanceStudyMemory(3));

    const atThreshold = await runWorkerMemoryConsolidationSchedule({
      agentIds: [agentId],
      shortTermMemoryRepository,
      longTermProfileRepository,
      cursorStore,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 2000,
      reflectionTrigger: { minimumImportanceScore: 1 },
    });

    expect(atThreshold.skipped).toEqual([]);
    expect(atThreshold.results[0]?.records.map((record) => record.id)).toEqual([
      'low-importance-study-1',
      'low-importance-study-2',
      'low-importance-study-3',
    ]);
    expect(atThreshold.patchCount).toBe(1);
    expect(atThreshold.cursors).toEqual([
      {
        agentId,
        lastProcessedOccurredAt: 3,
        updatedAt: 2000,
      },
    ]);
    await expect(longTermProfileRepository.getOrCreate(agentId)).resolves.toMatchObject({
      habits: [{ key: 'study-routine' }],
    });
  });

  test('records scheduled social reflection observations through the observability sink', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const cursorStore = new InMemoryMemoryConsolidationCursorStore();
    const socialReflectionObservationRepository =
      new InMemorySocialReflectionObservationRepository();
    await shortTermMemoryRepository.append(
      createSocialInteractionMemory({
        index: 1,
        targetAgentId: otherAgentId,
        summary: 'Shared food after work.',
        importanceScore: 0.8,
      }),
    );

    const result = await runWorkerMemoryConsolidationSchedule({
      agentIds: [agentId],
      shortTermMemoryRepository,
      longTermProfileRepository,
      cursorStore,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 2000,
      socialReflectionObservationSink: {
        repository: socialReflectionObservationRepository,
        simulationId,
        partitionKey: 'world-main',
      },
    });

    expect(result.socialReflectionObservationCount).toBe(1);
    await expect(
      socialReflectionObservationRepository.query({
        simulationId,
        partitionKey: 'world-main',
        agentId,
        targetAgentId: otherAgentId,
      }),
    ).resolves.toEqual([
      {
        observationId:
          'sim-social:world-main:social-reflection-agent-1-agent-2-social-agent-2-1-2000',
        simulationId,
        partitionKey: 'world-main',
        reflectionId: 'social-reflection-agent-1-agent-2-social-agent-2-1-2000',
        agentId,
        targetAgentId: otherAgentId,
        statement:
          'Interaction with agent-2 changed relation by 1 and attitude by 1: Shared food after work.',
        relationDelta: 1,
        attitudeDelta: 1,
        confidence: 0.8,
        evidenceRecordIds: ['social-agent-2-1'],
        generatedAt: 2000,
        tags: ['social', 'post-interaction-reflection', 'agent-2', 'conversation', 'community'],
        source: 'memory-consolidation',
      },
    ]);
  });

  test('persists consolidation cursors across store restarts', async () => {
    const rootDir = createTempRoot();
    const store = new FileMemoryConsolidationCursorStore({ rootDir });

    await store.saveCursor({ agentId, lastProcessedOccurredAt: 3, updatedAt: 1000 });
    await store.saveCursor({ agentId, lastProcessedOccurredAt: 6, updatedAt: 2000 });
    await store.saveCursor({ agentId: otherAgentId, lastProcessedOccurredAt: 2, updatedAt: 1500 });

    const restarted = new FileMemoryConsolidationCursorStore({ rootDir });

    await expect(restarted.getCursor(agentId)).resolves.toEqual({
      agentId,
      lastProcessedOccurredAt: 6,
      updatedAt: 2000,
    });
    await expect(restarted.getCursor(otherAgentId)).resolves.toEqual({
      agentId: otherAgentId,
      lastProcessedOccurredAt: 2,
      updatedAt: 1500,
    });
  });
});

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-memory-cursor-'));
  tempRoots.push(root);
  return root;
}

function createLowImportanceStudyMemory(index: number) {
  return createShortTermMemoryRecord({
    id: `low-importance-study-${index}`,
    agentId,
    kind: 'action',
    status: 'succeeded',
    summary: 'Completed a focused study session.',
    occurredAt: index,
    importanceScore: 0.4,
    source: { eventIds: [] },
    tags: ['study', 'education'],
  });
}

function createTradeMemory(index: number) {
  return createShortTermMemoryRecord({
    id: `trade-memory-${index}`,
    agentId,
    kind: 'action',
    status: 'succeeded',
    summary: 'Waited for a better apple price before buying.',
    occurredAt: index,
    importanceScore: 0.8,
    source: { eventIds: [] },
    tags: ['trade', 'market'],
  });
}
