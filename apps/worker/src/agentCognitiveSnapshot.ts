import type { BranchPlanProgress, BranchPlanRecord } from '@aivilization/agent-runtime';
import {
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

export function assertValidAgentCognitiveSnapshot(
  snapshot: AgentCognitiveSnapshot,
  expected?: { readonly agentId: AgentId; readonly sourcePartitionKey: string },
): void {
  if (snapshot.schemaVersion !== AGENT_COGNITIVE_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error('unsupported agent cognitive snapshot schema');
  }
  if (
    snapshot.agentId.trim().length === 0 ||
    snapshot.sourcePartitionKey.trim().length === 0 ||
    !Number.isFinite(snapshot.capturedAt) ||
    snapshot.capturedAt < 0
  ) {
    throw new Error('agent cognitive snapshot identity is invalid');
  }
  if (
    expected !== undefined &&
    (snapshot.agentId !== expected.agentId ||
      snapshot.sourcePartitionKey !== expected.sourcePartitionKey)
  ) {
    throw new Error(
      `agent cognitive snapshot belongs to ${snapshot.agentId}@${snapshot.sourcePartitionKey}, expected ${expected.agentId}@${expected.sourcePartitionKey}`,
    );
  }
  if (
    snapshot.longTermProfile.agentId !== snapshot.agentId ||
    snapshot.intention.agentId !== snapshot.agentId ||
    snapshot.shortTermMemory.some((record) => record.agentId !== snapshot.agentId) ||
    (snapshot.plan !== undefined && snapshot.plan.agentId !== snapshot.agentId) ||
    (snapshot.planProgress !== undefined && snapshot.planProgress.agentId !== snapshot.agentId)
  ) {
    throw new Error("agent cognitive snapshot contains another Agent's state");
  }
  const activePlanId = snapshot.intention.activeObjective?.id;
  if (
    (snapshot.plan !== undefined && snapshot.plan.planId !== activePlanId) ||
    (snapshot.planProgress !== undefined && snapshot.planProgress.planId !== activePlanId)
  ) {
    throw new Error('agent cognitive snapshot plan does not match its active objective');
  }
}

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
  const snapshot: AgentCognitiveSnapshot = {
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
  assertValidAgentCognitiveSnapshot(snapshot, {
    agentId: input.agentId,
    sourcePartitionKey: input.sourcePartitionKey,
  });
  return snapshot;
}

/**
 * Hydrate a destination partition's repositories from a transfer snapshot. The
 * rules are idempotent so a recovered materializer can re-apply the same
 * arrival delivery safely:
 * - short-term memory: records already present by id are skipped;
 * - profile, intention, plan and progress: the source snapshot replaces a
 *   stale destination copy, while equal retries are suppressed by comparison.
 *
 * The source snapshot is authoritative for this ownership transfer. A former
 * destination may retain an older copy from the Agent's previous residence;
 * allowing that copy to win would fork cognition from the world owner ledger.
 */
export async function hydrateAgentCognitiveSnapshot(input: {
  readonly storage: LocalWorldRuntimeStorage;
  readonly snapshot: AgentCognitiveSnapshot;
}): Promise<void> {
  const { storage, snapshot } = input;
  assertValidAgentCognitiveSnapshot(snapshot);

  const recent = await storage.shortTermMemoryRepository.retrieve({
    agentId: snapshot.agentId,
    limit: AGENT_COGNITIVE_SNAPSHOT_SHORT_TERM_LIMIT,
  });
  const knownById = new Map(recent.map((record) => [record.id, record]));
  for (const record of snapshot.shortTermMemory) {
    const existing = knownById.get(record.id);
    if (existing !== undefined && stableStringify(existing) !== stableStringify(record)) {
      throw new Error(`short-term memory id ${record.id} has conflicting transfer content`);
    }
  }
  const missingRecords = snapshot.shortTermMemory.filter((record) => !knownById.has(record.id));
  if (missingRecords.length > 0) {
    await storage.shortTermMemoryRepository.appendMany(missingRecords);
  }

  const currentProfile = await storage.longTermProfileRepository.getOrCreate(snapshot.agentId);
  if (stableStringify(currentProfile) !== stableStringify(snapshot.longTermProfile)) {
    await storage.longTermProfileRepository.save(snapshot.longTermProfile);
  }

  const currentIntention = await storage.intentionRepository.getOrCreate(snapshot.agentId);
  if (stableStringify(currentIntention) !== stableStringify(snapshot.intention)) {
    await storage.intentionRepository.save(snapshot.intention);
  }
  if (snapshot.plan !== undefined) {
    const existingPlan = await storage.planRepository.get({
      planId: snapshot.plan.planId,
      agentId: snapshot.agentId,
    });
    if (stableStringify(existingPlan) !== stableStringify(snapshot.plan)) {
      await storage.planRepository.save(snapshot.plan);
    }
  }
  if (snapshot.planProgress !== undefined) {
    const existingProgress = await storage.planProgressRepository.get({
      planId: snapshot.planProgress.planId,
      agentId: snapshot.agentId,
    });
    if (stableStringify(existingProgress) !== stableStringify(snapshot.planProgress)) {
      await storage.planProgressRepository.save(snapshot.planProgress);
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
