import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileAgentCycleTraceRepository,
  InMemoryAgentCycleTraceRepository,
  createAgentCycleTrace,
  type AgentCycleTrace,
} from './index';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-agent-cycle-traces-'));
  tmpRoots.push(root);
  return root;
}

function createTrace(input: {
  readonly traceId: string;
  readonly simulationId?: string;
  readonly agentId?: string;
  readonly cycleStartedAt?: number;
}): AgentCycleTrace {
  return createAgentCycleTrace({
    traceId: input.traceId,
    simulationId: input.simulationId ?? 'sim-1',
    agentId: input.agentId ?? 'agent-1',
    cycleStartedAt: input.cycleStartedAt ?? 100,
    observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
    selectedBranch: 'development',
    candidateActions: ['study for one minute'],
    simulatorResult: { status: 'accepted' },
    selectionEvidence: {
      selectedSubtaskId: 'study',
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 0,
      profileInfluenceScore: 0,
      memoryEvidenceRecordIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    },
    replanningDecision: { kind: 'none' },
    emittedCommandIds: [`${input.traceId}:command-1`],
    memoryContextIds: [],
    memoryWriteIds: [`${input.traceId}:memory-1`],
  });
}

describe('agent cycle trace repositories', () => {
  test('records and queries in-memory traces idempotently', async () => {
    const repository = new InMemoryAgentCycleTraceRepository();
    const older = createTrace({ traceId: 'trace-100', cycleStartedAt: 100 });
    const newer = createTrace({ traceId: 'trace-200', cycleStartedAt: 200 });
    const otherAgent = createTrace({
      traceId: 'trace-150-agent-2',
      agentId: 'agent-2',
      cycleStartedAt: 150,
    });
    const otherSimulation = createTrace({
      traceId: 'trace-other-simulation',
      simulationId: 'sim-2',
      cycleStartedAt: 300,
    });

    await repository.record(older);
    await repository.record(newer);
    await repository.record(otherAgent);
    await repository.record(otherSimulation);
    await repository.record({ ...newer, selectedBranch: 'duplicate-ignored' });

    await expect(repository.query({ simulationId: 'sim-1', agentId: 'agent-1' })).resolves.toEqual([
      newer,
      older,
    ]);
    await expect(repository.query({ simulationId: 'sim-1', limit: 1 })).resolves.toEqual([newer]);
    await expect(
      repository.query({
        simulationId: 'sim-1',
        fromCycleStartedAt: 120,
        toCycleStartedAt: 170,
      }),
    ).resolves.toEqual([otherAgent]);
    await expect(repository.get('missing')).resolves.toBeUndefined();

    const read = await repository.get('trace-200');
    (read!.memoryWriteIds as string[]).push('mutated');
    await expect(repository.get('trace-200')).resolves.toEqual(newer);
  });

  test('persists file-backed traces across repository instances', async () => {
    const rootDir = createRootDir();
    const first = new FileAgentCycleTraceRepository({ rootDir });
    const trace = createTrace({ traceId: 'trace-1', cycleStartedAt: 100 });

    await first.record(trace);
    await first.record({ ...trace, selectedBranch: 'duplicate-ignored' });

    const restarted = new FileAgentCycleTraceRepository({ rootDir });

    await expect(restarted.get('trace-1')).resolves.toEqual(trace);
    await expect(restarted.query({ simulationId: 'sim-1' })).resolves.toEqual([trace]);
    await expect(restarted.query({ simulationId: 'sim-1', limit: 0 })).rejects.toThrow(
      'limit must be positive',
    );
  });
});
