import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import type { MemoryProvenance, MemoryRecordId } from './records';

export type LongTermProfileSection =
  | 'beliefs'
  | 'habits'
  | 'mood'
  | 'values'
  | 'personality'
  | 'socialRecords';

export type LongTermMemoryPatch = {
  readonly id: string;
  readonly agentId: AgentId;
  readonly section: LongTermProfileSection;
  readonly key: string;
  readonly statement: string;
  readonly confidence: number;
  readonly provenanceRecordIds: readonly MemoryRecordId[];
  readonly proposedAt: SimulationTimestamp;
  readonly relationDelta?: number;
  readonly attitudeDelta?: number;
  readonly outcomeSignals?: readonly string[];
  readonly provenance?: MemoryProvenance;
};

export type LongTermProfileEntry = {
  readonly key: string;
  readonly statement: string;
  readonly confidence: number;
  readonly updatedAt: SimulationTimestamp;
  readonly provenanceRecordIds: readonly MemoryRecordId[];
  readonly relationDelta?: number;
  readonly attitudeDelta?: number;
  readonly outcomeSignals?: readonly string[];
  readonly provenance?: MemoryProvenance;
};

export type LongTermAgentProfile = {
  readonly agentId: AgentId;
  readonly beliefs: readonly LongTermProfileEntry[];
  readonly habits: readonly LongTermProfileEntry[];
  readonly mood: readonly LongTermProfileEntry[];
  readonly values: readonly LongTermProfileEntry[];
  readonly personality: readonly LongTermProfileEntry[];
  readonly socialRecords: readonly LongTermProfileEntry[];
};

export function createEmptyLongTermAgentProfile(agentId: AgentId): LongTermAgentProfile {
  return {
    agentId,
    beliefs: [],
    habits: [],
    mood: [],
    values: [],
    personality: [],
    socialRecords: [],
  };
}

/**
 * A profile entry asserts only while its provenance is influencing (or
 * unknown/legacy): corrected and aged-out entries stay durable for audit but
 * are excluded from belief assertions; doubtful entries still assert but carry
 * the flag so consumers can hedge.
 */
export function isAssertableProfileEntry(entry: LongTermProfileEntry): boolean {
  return entry.provenance?.status !== 'corrected' && entry.provenance?.status !== 'past';
}

export function listAssertableBeliefs(
  profile: LongTermAgentProfile,
): readonly LongTermProfileEntry[] {
  return profile.beliefs.filter(isAssertableProfileEntry);
}

export function applyLongTermMemoryPatches(
  profile: LongTermAgentProfile,
  patches: readonly LongTermMemoryPatch[],
): LongTermAgentProfile {
  return patches.reduce(applyLongTermMemoryPatch, profile);
}

export function applyLongTermMemoryPatch(
  profile: LongTermAgentProfile,
  patch: LongTermMemoryPatch,
): LongTermAgentProfile {
  if (patch.agentId !== profile.agentId) {
    throw new Error(`patch agent ${patch.agentId} does not match profile agent ${profile.agentId}`);
  }

  return {
    ...profile,
    [patch.section]: upsertProfileEntry(profile[patch.section], patch),
  };
}

function upsertProfileEntry(
  entries: readonly LongTermProfileEntry[],
  patch: LongTermMemoryPatch,
): readonly LongTermProfileEntry[] {
  const existing = entries.find((entry) => entry.key === patch.key);
  const nextEntry = createEntryFromPatch(patch, existing);
  return [...entries.filter((entry) => entry.key !== patch.key), nextEntry].sort(compareEntries);
}

function createEntryFromPatch(
  patch: LongTermMemoryPatch,
  existing: LongTermProfileEntry | undefined,
): LongTermProfileEntry {
  return {
    key: patch.key,
    statement: patch.statement,
    confidence: patch.confidence,
    updatedAt: patch.proposedAt,
    provenanceRecordIds: mergeProvenance(
      existing?.provenanceRecordIds ?? [],
      patch.provenanceRecordIds,
    ),
    ...(patch.relationDelta === undefined ? {} : { relationDelta: patch.relationDelta }),
    ...(patch.attitudeDelta === undefined ? {} : { attitudeDelta: patch.attitudeDelta }),
    ...(patch.outcomeSignals === undefined
      ? {}
      : {
          outcomeSignals: [
            ...new Set([...(existing?.outcomeSignals ?? []), ...patch.outcomeSignals]),
          ],
        }),
    // Provenance follows the latest patch: a correction patch overwrites the
    // entry's status, and a provenance-free legacy patch preserves whatever
    // the entry already carried.
    ...(patch.provenance === undefined
      ? existing?.provenance === undefined
        ? {}
        : { provenance: existing.provenance }
      : { provenance: patch.provenance }),
  };
}

function mergeProvenance(
  existing: readonly MemoryRecordId[],
  incoming: readonly MemoryRecordId[],
): readonly MemoryRecordId[] {
  return [...new Set([...existing, ...incoming])].sort((left, right) => left.localeCompare(right));
}

function compareEntries(left: LongTermProfileEntry, right: LongTermProfileEntry): number {
  return left.key.localeCompare(right.key);
}
