import { asAgentId, type AgentId } from '@aivilization/sim-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createBranchPlan,
  FileBranchPlanRepository,
  InMemoryBranchPlanRepository,
  type BranchPlanRecord,
  type StrategicPlanCompilationTrace,
} from './index';

const agentId = asAgentId('agent-1');
const otherAgentId = asAgentId('agent-2');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('branch plan repositories', () => {
  test('in-memory repository saves plans and returns defensive clones', async () => {
    const repository = new InMemoryBranchPlanRepository();
    const record = createPlanRecord({ planId: 'plan-1', basePriority: 5, updatedAt: 100 });

    await repository.save(record);

    const firstRead = await repository.require({ planId: 'plan-1', agentId });
    const secondRead = await repository.require({ planId: 'plan-1', agentId });

    expect(firstRead).toEqual(record);
    expect(secondRead).toEqual(record);
    expect(firstRead).not.toBe(secondRead);
    expect(firstRead.plan).not.toBe(secondRead.plan);
    expect(firstRead.plan.branches).not.toBe(secondRead.plan.branches);
  });

  test('in-memory repository isolates agents and plan ids', async () => {
    const repository = new InMemoryBranchPlanRepository();
    await repository.save(createPlanRecord({ planId: 'plan-1', basePriority: 5, updatedAt: 100 }));

    await expect(
      repository.get({ planId: 'plan-1', agentId: otherAgentId }),
    ).resolves.toBeUndefined();
    await expect(repository.get({ planId: 'plan-2', agentId })).resolves.toBeUndefined();
    await expect(repository.require({ planId: 'missing-plan', agentId })).rejects.toThrow(
      'branch plan missing-plan for agent agent-1 was not found',
    );
  });

  test('file repository recovers latest saved plan after restart', async () => {
    const rootDir = createTempRoot();
    const repository = new FileBranchPlanRepository({ rootDir });
    await repository.save(createPlanRecord({ planId: 'plan-1', basePriority: 1, updatedAt: 100 }));
    await repository.save(createPlanRecord({ planId: 'plan-1', basePriority: 9, updatedAt: 200 }));

    const restarted = new FileBranchPlanRepository({ rootDir });

    await expect(restarted.require({ planId: 'plan-1', agentId })).resolves.toEqual(
      createPlanRecord({ planId: 'plan-1', basePriority: 9, updatedAt: 200 }),
    );
  });

  test('repositories preserve optional strategic planning provenance across clone and restart', async () => {
    const planningTrace = createPlanningTrace();
    const record = createPlanRecord({
      planId: 'plan-with-provenance',
      basePriority: 5,
      updatedAt: 100,
      planningTrace,
    });
    const memoryRepository = new InMemoryBranchPlanRepository();

    await memoryRepository.save(record);

    const firstRead = await memoryRepository.require({
      planId: 'plan-with-provenance',
      agentId,
    });
    const secondRead = await memoryRepository.require({
      planId: 'plan-with-provenance',
      agentId,
    });

    expect(firstRead).toEqual(record);
    expect(firstRead.planningTrace).toEqual(planningTrace);
    expect(firstRead.planningTrace).not.toBe(secondRead.planningTrace);
    expect(firstRead.planningTrace?.attempts).not.toBe(secondRead.planningTrace?.attempts);

    const rootDir = createTempRoot();
    await new FileBranchPlanRepository({ rootDir }).save(record);
    const restarted = new FileBranchPlanRepository({ rootDir });

    await expect(
      restarted.require({
        planId: 'plan-with-provenance',
        agentId,
      }),
    ).resolves.toEqual(record);
  });

  test('queries latest branch plan records with optional filters', async () => {
    const memoryRepository = new InMemoryBranchPlanRepository();
    await memoryRepository.save(
      createPlanRecord({ planId: 'plan-1', basePriority: 1, updatedAt: 100 }),
    );
    await memoryRepository.save(
      createPlanRecord({ planId: 'plan-2', basePriority: 2, updatedAt: 200 }),
    );
    await memoryRepository.save(
      createPlanRecord({
        planId: 'other-agent-plan',
        agentId: otherAgentId,
        basePriority: 3,
        updatedAt: 300,
      }),
    );

    await expect(memoryRepository.query({})).resolves.toEqual([
      createPlanRecord({
        planId: 'other-agent-plan',
        agentId: otherAgentId,
        basePriority: 3,
        updatedAt: 300,
      }),
      createPlanRecord({ planId: 'plan-2', basePriority: 2, updatedAt: 200 }),
      createPlanRecord({ planId: 'plan-1', basePriority: 1, updatedAt: 100 }),
    ]);
    await expect(memoryRepository.query({ agentId })).resolves.toEqual([
      createPlanRecord({ planId: 'plan-2', basePriority: 2, updatedAt: 200 }),
      createPlanRecord({ planId: 'plan-1', basePriority: 1, updatedAt: 100 }),
    ]);
    await expect(memoryRepository.query({ agentId, limit: 1 })).resolves.toEqual([
      createPlanRecord({ planId: 'plan-2', basePriority: 2, updatedAt: 200 }),
    ]);

    const rootDir = createTempRoot();
    const fileRepository = new FileBranchPlanRepository({ rootDir });
    await fileRepository.save(
      createPlanRecord({ planId: 'plan-1', basePriority: 1, updatedAt: 100 }),
    );
    await fileRepository.save(
      createPlanRecord({ planId: 'plan-1', basePriority: 9, updatedAt: 400 }),
    );
    await fileRepository.save(
      createPlanRecord({
        planId: 'other-agent-plan',
        agentId: otherAgentId,
        basePriority: 3,
        updatedAt: 300,
      }),
    );

    const restarted = new FileBranchPlanRepository({ rootDir });

    await expect(restarted.query({})).resolves.toEqual([
      createPlanRecord({ planId: 'plan-1', basePriority: 9, updatedAt: 400 }),
      createPlanRecord({
        planId: 'other-agent-plan',
        agentId: otherAgentId,
        basePriority: 3,
        updatedAt: 300,
      }),
    ]);
    await expect(restarted.query({ planId: 'plan-1', fromUpdatedAt: 250 })).resolves.toEqual([
      createPlanRecord({ planId: 'plan-1', basePriority: 9, updatedAt: 400 }),
    ]);
    await expect(restarted.query({ limit: 0 })).rejects.toThrow(
      'limit must be a positive integer',
    );
  });
});

function createPlanRecord(input: {
  readonly planId: string;
  readonly agentId?: AgentId;
  readonly basePriority: number;
  readonly updatedAt: number;
  readonly planningTrace?: StrategicPlanCompilationTrace;
}): BranchPlanRecord {
  return {
    planId: input.planId,
    agentId: input.agentId ?? agentId,
    plan: createBranchPlan({
      objective: 'develop education',
      branches: [
        {
          id: 'development',
          objective: 'improve education',
          subtasks: [
            {
              id: 'study',
              description: 'self study',
              basePriority: input.basePriority,
            },
          ],
        },
      ],
    }),
    ...(input.planningTrace === undefined ? {} : { planningTrace: input.planningTrace }),
    createdAt: 50,
    updatedAt: input.updatedAt,
  };
}

function createPlanningTrace(): StrategicPlanCompilationTrace {
  return {
    status: 'accepted',
    source: 'llm',
    requestId: 'request-1',
    providerId: 'scripted-provider',
    model: 'planner-model',
    attempts: [
      {
        attemptIndex: 1,
        status: 'succeeded',
        providerId: 'scripted-provider',
        model: 'planner-model',
        message: 'LLM structured response validated',
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
          estimatedCostMicros: 4,
        },
      },
    ],
    usage: {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      estimatedCostMicros: 4,
    },
  };
}

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-branch-plans-'));
  tempRoots.push(root);
  return root;
}
