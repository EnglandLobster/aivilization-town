import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileReactionEvaluationTraceRepository,
  InMemoryReactionEvaluationTraceRepository,
  type ReactionEvaluationTrace,
} from './reactionEvaluationTraceRepository';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('reaction evaluation trace repositories', () => {
  test('records traces idempotently and queries latest matching decisions first', async () => {
    const repository = new InMemoryReactionEvaluationTraceRepository();
    const first = createTrace({
      traceId: 'trace-ignore-1',
      agentId: 'agent-1',
      memoryRecordId: 'memory-1',
      issuedAt: 100,
      decision: {
        kind: 'ignore',
        confidence: 0.9,
        rationale: 'The observed conversation is not relevant now.',
      },
      reactionTrace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'reaction-request-1',
        providerId: 'scripted-reaction',
        model: 'reaction-model',
        attempts: [
          {
            attemptIndex: 1,
            status: 'succeeded',
            providerId: 'scripted-reaction',
            model: 'reaction-model',
            message: 'LLM structured response validated',
            usage: {
              inputTokens: 5,
              outputTokens: 7,
              totalTokens: 12,
              estimatedCostMicros: 31,
            },
          },
        ],
        usage: {
          inputTokens: 5,
          outputTokens: 7,
          totalTokens: 12,
          estimatedCostMicros: 31,
        },
        worldDecisionContext: createWorldDecisionContextTrace('agent-1'),
      },
    });
    const second = createTrace({
      traceId: 'trace-follow-up-2',
      agentId: 'agent-1',
      memoryRecordId: 'memory-2',
      issuedAt: 200,
      decision: {
        kind: 'follow-up',
        confidence: 0.84,
        rationale: 'The topic matches the agent party routine.',
        description: 'Ask agent-a whether help is needed for the Valentine party.',
        priority: 6,
        reactionWindowMs: 30 * 60 * 1000,
        affinityTags: ['social', 'party', 'agent-a'],
      },
      scheduledIntentionId: 'social-observation:agent-1:memory-2',
    });
    const otherPartition = createTrace({
      traceId: 'trace-other',
      partitionKey: 'world-east',
      agentId: 'agent-1',
      memoryRecordId: 'memory-east',
      issuedAt: 250,
      decision: {
        kind: 'ignore',
        confidence: 0.8,
        rationale: 'The east partition trace should not match world-main.',
      },
    });

    await repository.record(first);
    await repository.record(second);
    await repository.record(otherPartition);
    await repository.record({
      ...second,
      decision: {
        ...second.decision,
        rationale: 'duplicate should be ignored',
      },
    });

    await expect(repository.get('trace-follow-up-2')).resolves.toEqual(second);
    await expect(
      repository.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-1',
        fromIssuedAt: 90,
        toIssuedAt: 200,
        limit: 2,
      }),
    ).resolves.toEqual([second, first]);
    await expect(
      repository.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        decisionKind: 'ignore',
      }),
    ).resolves.toEqual([first]);
    await expect(
      repository.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        memoryRecordId: 'memory-2',
      }),
    ).resolves.toEqual([second]);
  });

  test('persists file-backed traces across repository restarts', async () => {
    const rootDir = createRootDir();
    const repository = new FileReactionEvaluationTraceRepository({ rootDir });
    const trace = createTrace({
      traceId: 'trace-file',
      agentId: 'agent-2',
      memoryRecordId: 'memory-file',
      issuedAt: 300,
      decision: {
        kind: 'follow-up',
        confidence: 0.71,
        rationale: 'The memory should become a later conversation.',
        description: 'Ask about the observed study plan.',
        priority: 5,
        reactionWindowMs: 60 * 60 * 1000,
        affinityTags: ['social', 'study'],
      },
      scheduledIntentionId: 'social-observation:agent-2:memory-file',
    });

    await repository.record(trace);
    const restarted = new FileReactionEvaluationTraceRepository({ rootDir });

    await expect(restarted.get('trace-file')).resolves.toEqual(trace);
    await expect(
      restarted.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
      }),
    ).resolves.toEqual([trace]);
  });

  test('returns deep clones of decision tags and reaction usage', async () => {
    const repository = new InMemoryReactionEvaluationTraceRepository();
    const trace = createTrace({
      traceId: 'trace-clone',
      agentId: 'agent-3',
      memoryRecordId: 'memory-clone',
      issuedAt: 400,
      decision: {
        kind: 'follow-up',
        confidence: 0.76,
        rationale: 'The trace includes mutable nested fields.',
        description: 'Follow up on the observed collaboration.',
        priority: 7,
        reactionWindowMs: 45 * 60 * 1000,
        affinityTags: ['social', 'collaboration'],
      },
      reactionTrace: {
        status: 'fallback',
        source: 'deterministic-fallback',
        failureReason: 'provider-timeout',
        attempts: [
          {
            attemptIndex: 1,
            status: 'failed',
            providerId: 'provider-1',
            model: 'model-1',
            message: 'timeout',
            usage: {
              inputTokens: 1,
              outputTokens: 2,
              totalTokens: 3,
              estimatedCostMicros: 4,
            },
          },
        ],
      },
    });
    await repository.record(trace);

    const read = await repository.get('trace-clone');
    if (read === undefined || read.decision.kind !== 'follow-up') {
      throw new Error('expected follow-up trace');
    }
    (read.decision.affinityTags as string[]).push('mutated');
    const attempt = read.reactionTrace?.attempts?.[0];
    if (attempt === undefined) {
      throw new Error('expected reaction attempt');
    }
    (attempt.usage as { inputTokens: number }).inputTokens = 999;

    await expect(repository.get('trace-clone')).resolves.toEqual(trace);
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-reaction-evaluation-traces-'));
  tmpRoots.push(root);
  return root;
}

function createWorldDecisionContextTrace(agentId: string) {
  return {
    agentId,
    hasPhysiology: true,
    hasBalance: true,
    hasEducationScore: true,
    hasResidentialTier: true,
    inventoryItemCount: 2,
    marketSpotPriceCount: 1,
    hasLatestPriceIndex: true,
  };
}

function createTrace(
  input: Partial<ReactionEvaluationTrace> & {
    readonly traceId: string;
    readonly agentId: string;
    readonly memoryRecordId: string;
    readonly issuedAt: number;
    readonly decision: ReactionEvaluationTrace['decision'];
  },
): ReactionEvaluationTrace {
  return {
    traceId: input.traceId,
    simulationId: input.simulationId ?? 'sim-1',
    partitionKey: input.partitionKey ?? 'world-main',
    agentId: input.agentId,
    memoryRecordId: input.memoryRecordId,
    decision: input.decision,
    ...(input.reactionTrace === undefined ? {} : { reactionTrace: input.reactionTrace }),
    ...(input.scheduledIntentionId === undefined
      ? {}
      : { scheduledIntentionId: input.scheduledIntentionId }),
    issuedAt: input.issuedAt,
  };
}
