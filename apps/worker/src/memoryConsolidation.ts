import {
  proposeLongTermMemoryPatches,
  type LongTermAgentProfile,
  type LongTermMemoryPatch,
  type LongTermProfileRepository,
  type ShortTermMemoryRecord,
  type ShortTermMemoryRepository,
} from '@aivilization/memory';
import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';

export type WorkerMemoryConsolidationInput = {
  readonly agentId: AgentId;
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly retrievalLimit: number;
  readonly minPatternCount: number;
  readonly proposedAt: SimulationTimestamp;
};

export type WorkerMemoryConsolidationResult = {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly patches: readonly LongTermMemoryPatch[];
  readonly profile: LongTermAgentProfile;
};

export type WorkerMemoryConsolidationBatchInput = Omit<
  WorkerMemoryConsolidationInput,
  'agentId'
> & {
  readonly agentIds: readonly AgentId[];
};

export type WorkerMemoryConsolidationBatchResult = {
  readonly agentIds: readonly AgentId[];
  readonly results: readonly WorkerMemoryConsolidationResult[];
  readonly patchCount: number;
};

export async function runWorkerMemoryConsolidation(
  input: WorkerMemoryConsolidationInput,
): Promise<WorkerMemoryConsolidationResult> {
  const records = await input.shortTermMemoryRepository.retrieve({
    agentId: input.agentId,
    limit: input.retrievalLimit,
  });
  const patches = proposeLongTermMemoryPatches({
    agentId: input.agentId,
    records,
    minPatternCount: input.minPatternCount,
    proposedAt: input.proposedAt,
  });
  const profile =
    patches.length === 0
      ? await input.longTermProfileRepository.getOrCreate(input.agentId)
      : await input.longTermProfileRepository.applyPatches(input.agentId, patches);

  return {
    agentId: input.agentId,
    records,
    patches,
    profile,
  };
}

export async function runWorkerMemoryConsolidationBatch(
  input: WorkerMemoryConsolidationBatchInput,
): Promise<WorkerMemoryConsolidationBatchResult> {
  const agentIds = dedupeAgentIds(input.agentIds);
  const results: WorkerMemoryConsolidationResult[] = [];
  for (const agentId of agentIds) {
    results.push(
      await runWorkerMemoryConsolidation({
        agentId,
        shortTermMemoryRepository: input.shortTermMemoryRepository,
        longTermProfileRepository: input.longTermProfileRepository,
        retrievalLimit: input.retrievalLimit,
        minPatternCount: input.minPatternCount,
        proposedAt: input.proposedAt,
      }),
    );
  }

  return {
    agentIds,
    results,
    patchCount: results.reduce((count, result) => count + result.patches.length, 0),
  };
}

function dedupeAgentIds(agentIds: readonly AgentId[]): readonly AgentId[] {
  return [...new Set(agentIds)];
}
