import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileObjectiveRenewalTraceRepository,
  InMemoryObjectiveRenewalTraceRepository,
  type ObjectiveRenewalTrace,
} from './objectiveRenewalTraceRepository';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('objective renewal trace repositories', () => {
  test('records traces idempotently and queries latest matching decisions first', async () => {
    const repository = new InMemoryObjectiveRenewalTraceRepository();
    const first = createTrace({
      traceId: 'trace-1',
      agentId: 'agent-1',
      objectiveId: 'objective-1',
      issuedAt: 100,
      selectedCandidateId: 'physiology-maintenance',
    });
    const second = createTrace({
      traceId: 'trace-2',
      agentId: 'agent-1',
      objectiveId: 'objective-2',
      issuedAt: 150,
      selectedCandidateId: 'education-development',
      strategicPlan: {
        status: 'accepted',
        source: 'llm',
        requestId: 'llm-plan-objective-2',
        providerId: 'scripted-profile-planner',
        model: 'planner-model',
        usage: {
          inputTokens: 7,
          outputTokens: 11,
          totalTokens: 18,
          estimatedCostMicros: 47,
        },
        shortTermMemoryContext: { recordCount: 1 },
        longTermProfileContext: { entryCount: 2 },
        worldDecisionContext: createWorldDecisionContextTrace('agent-1'),
        attempts: [
          {
            attemptIndex: 1,
            status: 'succeeded',
            providerId: 'scripted-profile-planner',
            model: 'planner-model',
            message: 'LLM structured response validated',
            usage: {
              inputTokens: 7,
              outputTokens: 11,
              totalTokens: 18,
              estimatedCostMicros: 47,
            },
          },
        ],
      },
    });
    const otherPartition = createTrace({
      traceId: 'trace-other',
      partitionKey: 'world-east',
      agentId: 'agent-1',
      objectiveId: 'objective-east',
      issuedAt: 175,
    });

    await repository.record(first);
    await repository.record(second);
    await repository.record(otherPartition);
    await repository.record({
      ...second,
      rationale: 'duplicate should be ignored',
    });

    await expect(repository.get('trace-2')).resolves.toEqual(second);
    await expect(
      repository.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-1',
        fromIssuedAt: 90,
        toIssuedAt: 150,
        limit: 2,
      }),
    ).resolves.toEqual([second, first]);
  });

  test('persists file-backed traces across repository restarts', async () => {
    const rootDir = createRootDir();
    const repository = new FileObjectiveRenewalTraceRepository({ rootDir });
    const trace = createTrace({
      traceId: 'trace-file',
      agentId: 'agent-2',
      objectiveId: 'objective-file',
      issuedAt: 200,
      selectedCandidateId: 'scheduled-routine-study',
      scheduledIntentionIds: ['daily-routine:agent-2:0:morning-study'],
    });

    await repository.record(trace);
    const restarted = new FileObjectiveRenewalTraceRepository({ rootDir });

    await expect(restarted.get('trace-file')).resolves.toEqual(trace);
    await expect(
      restarted.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
      }),
    ).resolves.toEqual([trace]);
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-objective-renewal-traces-'));
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
  input: Partial<ObjectiveRenewalTrace> & {
    readonly traceId: string;
    readonly agentId: string;
    readonly objectiveId: string;
    readonly issuedAt: number;
  },
): ObjectiveRenewalTrace {
  return {
    traceId: input.traceId,
    simulationId: input.simulationId ?? 'sim-1',
    partitionKey: input.partitionKey ?? 'world-main',
    agentId: input.agentId,
    objectiveId: input.objectiveId,
    selectedCandidateId: input.selectedCandidateId ?? 'custom-proposer',
    rationale: input.rationale ?? 'Objective renewal selected a candidate.',
    score: input.score ?? 10,
    shortTermMemoryContextIds: input.shortTermMemoryContextIds ?? ['memory-1'],
    profileEntryKeys: input.profileEntryKeys ?? ['values:study'],
    profileEvidenceRecordIds: input.profileEvidenceRecordIds ?? ['ltm-1'],
    ...(input.scheduledIntentionIds === undefined
      ? {}
      : { scheduledIntentionIds: input.scheduledIntentionIds }),
    ...(input.strategicPlan === undefined ? {} : { strategicPlan: input.strategicPlan }),
    issuedAt: input.issuedAt,
  };
}
