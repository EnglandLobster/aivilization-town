import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileSteeringTraceRepository,
  InMemorySteeringTraceRepository,
  type SteeringTrace,
} from './steeringTraceRepository';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('steering trace repositories', () => {
  test('records steering traces idempotently and queries latest matching traces', async () => {
    const repository = new InMemorySteeringTraceRepository();

    await repository.record(createTrace({ traceId: 'trace-1', commandId: 'cmd-1', issuedAt: 100 }));
    await repository.record(
      createTrace({ traceId: 'trace-1', commandId: 'cmd-1-duplicate', issuedAt: 200 }),
    );
    await repository.record(createTrace({ traceId: 'trace-2', commandId: 'cmd-2', issuedAt: 300 }));

    await expect(
      repository.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        traceId: 'trace-1',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        traceId: 'trace-1',
        commandId: 'cmd-1',
      }),
    ]);
    await expect(
      repository.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-1',
        limit: 1,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        traceId: 'trace-2',
        commandId: 'cmd-2',
      }),
    ]);
    await expect(repository.get('trace-1')).resolves.toMatchObject({
      traceId: 'trace-1',
      commandId: 'cmd-1',
      strategicPlan: {
        source: 'llm',
        providerId: 'scripted-planner',
      },
    });
  });

  test('file repository restores traces after restart and returns defensive clones', async () => {
    const rootDir = createTempRoot();
    const repository = new FileSteeringTraceRepository({ rootDir });
    const trace = createTrace({ traceId: 'trace-file-1', commandId: 'cmd-file-1', issuedAt: 100 });

    await repository.record(trace);

    const restarted = new FileSteeringTraceRepository({ rootDir });
    const firstRead = await restarted.get('trace-file-1');
    const secondRead = await restarted.get('trace-file-1');

    expect(firstRead).toEqual(trace);
    expect(firstRead).not.toBe(secondRead);
    expect(firstRead?.shortTermMemoryRecordIds).not.toBe(secondRead?.shortTermMemoryRecordIds);
    expect(firstRead?.objectiveAffinityTags).not.toBe(secondRead?.objectiveAffinityTags);
    expect(firstRead?.strategicPlan?.attempts).not.toBe(secondRead?.strategicPlan?.attempts);
  });

  test('validates query filters before reading', async () => {
    const repository = new InMemorySteeringTraceRepository();

    await expect(repository.query({ simulationId: ' ', limit: 1 })).rejects.toThrow(
      'simulationId must not be empty',
    );
    await expect(repository.query({ simulationId: 'sim-1', limit: 0 })).rejects.toThrow(
      'limit must be a positive integer',
    );
  });
});

function createTrace(input: {
  readonly traceId: string;
  readonly commandId: string;
  readonly issuedAt: number;
}): SteeringTrace {
  return {
    traceId: input.traceId,
    simulationId: 'sim-1',
    partitionKey: 'world-main',
    commandId: input.commandId,
    commandType: 'SetLongHorizonObjective',
    source: 'human',
    agentId: 'agent-1',
    resultKind: 'long-horizon-objective-set',
    objectiveId: 'objective-study',
    objectiveStatement: 'Study until education score exceeds 100.',
    objectiveAffinityTags: ['study', 'education'],
    planId: 'objective-study',
    candidateActionCount: 0,
    commandDraftCount: 0,
    shortTermMemoryRecordIds: [],
    strategicPlan: {
      status: 'accepted',
      source: 'llm',
      requestId: 'steering-llm-plan-objective-study',
      providerId: 'scripted-planner',
      model: 'planner-model',
      attempts: [
        {
          attemptIndex: 1,
          status: 'succeeded',
          providerId: 'scripted-planner',
          model: 'planner-model',
          message: 'LLM structured response validated',
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            estimatedCostMicros: 70,
          },
        },
      ],
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        estimatedCostMicros: 70,
      },
      observedStateSummary: 'energy=50 satiety=80 health=100 education=10 balance=100',
      worldDecisionContext: {
        agentId: 'agent-1',
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
      },
    },
    issuedAt: input.issuedAt,
    recordedAt: input.issuedAt + 900,
  };
}

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-steering-traces-'));
  tmpRoots.push(root);
  return root;
}
