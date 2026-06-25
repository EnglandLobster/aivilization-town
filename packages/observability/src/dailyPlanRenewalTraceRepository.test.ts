import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileDailyPlanRenewalTraceRepository,
  InMemoryDailyPlanRenewalTraceRepository,
  type DailyPlanRenewalTrace,
} from './dailyPlanRenewalTraceRepository';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('daily plan renewal trace repositories', () => {
  test('records traces idempotently and queries latest matching daily plans first', async () => {
    const repository = new InMemoryDailyPlanRenewalTraceRepository();
    const first = createTrace({
      traceId: 'trace-1',
      agentId: 'agent-1',
      dailyPlanId: 'daily-plan:agent-1:0',
      issuedAt: 100,
    });
    const second = createTrace({
      traceId: 'trace-2',
      agentId: 'agent-1',
      dailyPlanId: 'daily-plan:agent-1:86400000',
      scheduledIntentionIds: ['daily-plan:agent-1:86400000:party-follow-up'],
      issuedAt: 200,
      planningTrace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'daily-plan-request-2',
        providerId: 'scripted-daily-planner',
        model: 'daily-planner-model',
        attempts: [
          {
            attemptIndex: 1,
            status: 'succeeded',
            providerId: 'scripted-daily-planner',
            model: 'daily-planner-model',
            message: 'LLM structured response validated',
            usage: {
              inputTokens: 7,
              outputTokens: 11,
              totalTokens: 18,
              estimatedCostMicros: 47,
            },
          },
        ],
        usage: {
          inputTokens: 7,
          outputTokens: 11,
          totalTokens: 18,
          estimatedCostMicros: 47,
        },
        shortTermMemoryContext: { recordCount: 1 },
        longTermProfileContext: { entryCount: 2 },
        worldDecisionContext: createWorldDecisionContextTrace('agent-1'),
      },
    });
    const otherPartition = createTrace({
      traceId: 'trace-other',
      partitionKey: 'world-east',
      agentId: 'agent-1',
      dailyPlanId: 'daily-plan:agent-1:east',
      issuedAt: 250,
    });

    await repository.record(first);
    await repository.record(second);
    await repository.record(otherPartition);
    await repository.record({
      ...second,
      scheduledIntentionIds: ['duplicate-should-be-ignored'],
    });

    await expect(repository.get('trace-2')).resolves.toEqual(second);
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
        dailyPlanId: 'daily-plan:agent-1:86400000',
      }),
    ).resolves.toEqual([second]);
    await expect(
      repository.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        traceId: 'trace-2',
      }),
    ).resolves.toEqual([second]);
  });

  test('persists file-backed traces across repository restarts', async () => {
    const rootDir = createRootDir();
    const repository = new FileDailyPlanRenewalTraceRepository({ rootDir });
    const trace = createTrace({
      traceId: 'trace-file',
      agentId: 'agent-2',
      dailyPlanId: 'daily-plan:agent-2:0',
      issuedAt: 300,
      scheduledIntentionIds: ['daily-plan:agent-2:0:morning-study'],
    });

    await repository.record(trace);
    const restarted = new FileDailyPlanRenewalTraceRepository({ rootDir });

    await expect(restarted.get('trace-file')).resolves.toEqual(trace);
    await expect(
      restarted.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
      }),
    ).resolves.toEqual([trace]);
  });

  test('returns deep clones of trace arrays and planning usage', async () => {
    const repository = new InMemoryDailyPlanRenewalTraceRepository();
    const trace = createTrace({
      traceId: 'trace-clone',
      agentId: 'agent-3',
      dailyPlanId: 'daily-plan:agent-3:0',
      issuedAt: 400,
      planningTrace: {
        status: 'accepted',
        source: 'llm',
        attempts: [
          {
            attemptIndex: 1,
            status: 'succeeded',
            providerId: 'provider-1',
            model: 'model-1',
            message: 'ok',
            usage: {
              inputTokens: 1,
              outputTokens: 2,
              totalTokens: 3,
              estimatedCostMicros: 4,
            },
          },
        ],
        shortTermMemoryContext: { recordCount: 1 },
        longTermProfileContext: { entryCount: 2 },
      },
    });
    await repository.record(trace);

    const read = await repository.get('trace-clone');
    if (read === undefined) {
      throw new Error('expected trace');
    }
    (read.scheduledIntentionIds as string[]).push('mutated');
    (read.planningTrace?.shortTermMemoryContext as
      | { recordCount: number }
      | undefined)!.recordCount = 999;
    const attempt = read.planningTrace?.attempts?.[0];
    if (attempt === undefined) {
      throw new Error('expected planning attempt');
    }
    (attempt.usage as { inputTokens: number }).inputTokens = 999;

    await expect(repository.get('trace-clone')).resolves.toEqual(trace);
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-daily-plan-renewal-traces-'));
  tmpRoots.push(root);
  return root;
}

function createWorldDecisionContextTrace(agentId: string) {
  return {
    agentId,
    hasLocationId: true,
    hasPhysiology: true,
    hasJob: true,
    hasBalance: true,
    hasEducationScore: true,
    hasResidentialTier: true,
    hasInventory: true,
    inventoryItemCount: 2,
    marketSpotPriceCount: 1,
    hasLatestPriceIndex: true,
  };
}

function createTrace(
  input: Partial<DailyPlanRenewalTrace> & {
    readonly traceId: string;
    readonly agentId: string;
    readonly dailyPlanId: string;
    readonly issuedAt: number;
  },
): DailyPlanRenewalTrace {
  return {
    traceId: input.traceId,
    simulationId: input.simulationId ?? 'sim-1',
    partitionKey: input.partitionKey ?? 'world-main',
    agentId: input.agentId,
    dailyPlanId: input.dailyPlanId,
    scheduledIntentionIds: input.scheduledIntentionIds ?? [
      `${input.dailyPlanId}:morning-study`,
      `${input.dailyPlanId}:evening-social`,
    ],
    shortTermMemoryContextIds: input.shortTermMemoryContextIds ?? ['memory-1'],
    profileEntryKeys: input.profileEntryKeys ?? ['habits:study-routine'],
    profileEvidenceRecordIds: input.profileEvidenceRecordIds ?? ['ltm-memory-1'],
    ...(input.planningTrace === undefined ? {} : { planningTrace: input.planningTrace }),
    issuedAt: input.issuedAt,
  };
}
