import type {
  BranchPlanProgress,
  BranchPlanRecord,
} from '@aivilization/agent-runtime';
import {
  createEmptyLongTermAgentProfile,
  type AgentIntentionState,
  type LongTermAgentProfile,
  type ShortTermMemoryRecord,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { LocalWorldRuntimeStorage } from './localRuntimeStorage';

export const AGENT_COGNITIVE_SNAPSHOT_SCHEMA_VERSION = 'agent-cognitive-snapshot-v1';

/**
 * Mechanism-stage bound: the snapshot carries the agent's most recent N
 * short-term memory records. Long-horizon evidence beyond this window already
 * belongs to consolidated long-term memory, which transfers in full.
 */
export const AGENT_COGNITIVE_SNAPSHOT_SHORT_TERM_LIMIT = 512;

/**
 * The durable cognitive state of one Agent, captured by the owning partition at
 * cross-owner transfer time and held by the simulation-wide authority until the
 * destination partition hydrates it. World state (location, balance, inventory)
 * is NOT part of this snapshot: it travels inside the AgentOwnershipArrived
 * world event, settled authoritatively against the global projection.
 */
export type AgentCognitiveSnapshot = {
  readonly schemaVersion: typeof AGENT_COGNITIVE_SNAPSHOT_SCHEMA_VERSION;
  readonly agentId: AgentId;
  readonly sourcePartitionKey: string;
  readonly capturedAt: number;
  readonly shortTermMemory: readonly ShortTermMemoryRecord[];
  readonly longTermProfile: LongTermAgentProfile;
  readonly intention: AgentIntentionState;
  readonly plan?: BranchPlanRecord;
  readonly planProgress?: BranchPlanProgress;
};

export async function captureAgentCognitiveSnapshot(input: {
  readonly storage: LocalWorldRuntimeStorage;
  readonly agentId: AgentId;
  readonly sourcePartitionKey: string;
  readonly capturedAt: number;
}): Promise<AgentCognitiveSnapshot> {
  const [shortTermMemory, longTermProfile, intention] = await Promise.all([
    input.storage.shortTermMemoryRepository.retrieve({
      agentId: input.agentId,
      limit: AGENT_COGNITIVE_SNAPSHOT_SHORT_TERM_LIMIT,
    }),
    input.storage.longTermProfileRepository.getOrCreate(input.agentId),
    input.storage.intentionRepository.getOrCreate(input.agentId),
  ]);
  const planId = intention.activeObjective?.id;
  const plan =
    planId === undefined
      ? undefined
      : await input.storage.planRepository.get({
          planId,
          agentId: input.agentId,
        });
  const planProgress =
    planId === undefined
      ? undefined
      : await input.storage.planProgressRepository.get({
          planId,
          agentId: input.agentId,
        });
  return {
    schemaVersion: AGENT_COGNITIVE_SNAPSHOT_SCHEMA_VERSION,
    agentId: input.agentId,
    sourcePartitionKey: input.sourcePartitionKey,
    capturedAt: input.capturedAt,
    // retrieve returns most-recent-first; the snapshot preserves chronological
    // order so hydration replays records the way they were lived.
    shortTermMemory: [...shortTermMemory].sort(
      (left, right) => left.occurredAt - right.occurredAt || left.id.localeCompare(right.id),
    ),
    longTermProfile,
    intention,
    ...(plan === undefined ? {} : { plan }),
    ...(planProgress === undefined ? {} : { planProgress }),
  };
}

/**
 * Hydrate a destination partition's repositories from a transfer snapshot. The
 * rules are idempotent and first-write-wins so a recovered materializer can
 * re-apply the same arrival delivery safely:
 * - short-term memory: records already present by id are skipped;
 * - long-term profile: only an untouched (empty) profile is overwritten, so an
 *   agent that already lived in the destination keeps its local evidence;
 * - intention / plan / progress: existing durable state is never clobbered.
 */
export async function hydrateAgentCognitiveSnapshot(input: {
  readonly storage: LocalWorldRuntimeStorage;
  readonly snapshot: AgentCognitiveSnapshot;
}): Promise<void> {
  const { storage, snapshot } = input;

  const recent = await storage.shortTermMemoryRepository.retrieve({
    agentId: snapshot.agentId,
    limit: AGENT_COGNITIVE_SNAPSHOT_SHORT_TERM_LIMIT,
  });
  const knownIds = new Set(recent.map((record) => record.id));
  const missingRecords = snapshot.shortTermMemory.filter((record) => !knownIds.has(record.id));
  if (missingRecords.length > 0) {
    await storage.shortTermMemoryRepository.appendMany(missingRecords);
  }

  const currentProfile = await storage.longTermProfileRepository.getOrCreate(snapshot.agentId);
  const emptyProfile = createEmptyLongTermAgentProfile(snapshot.agentId);
  if (stableStringify(currentProfile) === stableStringify(emptyProfile)) {
    await storage.longTermProfileRepository.save(snapshot.longTermProfile);
  }

  const currentIntention = await storage.intentionRepository.getOrCreate(snapshot.agentId);
  if (currentIntention.activeObjective === undefined) {
    await storage.intentionRepository.save(snapshot.intention);
    if (snapshot.plan !== undefined) {
      const existingPlan = await storage.planRepository.get({
        planId: snapshot.plan.planId,
        agentId: snapshot.agentId,
      });
      if (existingPlan === undefined) {
        await storage.planRepository.save(snapshot.plan);
      }
    }
    if (snapshot.planProgress !== undefined) {
      const existingProgress = await storage.planProgressRepository.get({
        planId: snapshot.planProgress.planId,
        agentId: snapshot.agentId,
      });
      if (existingProgress === undefined) {
        await storage.planProgressRepository.save(snapshot.planProgress);
      }
    }
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}
