import type { AgentId } from '@aivilization/sim-core';
import {
  applyLongTermMemoryPatches,
  createEmptyLongTermAgentProfile,
  type LongTermAgentProfile,
  type LongTermMemoryPatch,
  type LongTermProfileEntry,
} from './profile';

export type LongTermProfileRepository = {
  readonly getOrCreate: (agentId: AgentId) => Promise<LongTermAgentProfile>;
  readonly save: (profile: LongTermAgentProfile) => Promise<void>;
  readonly applyPatches: (
    agentId: AgentId,
    patches: readonly LongTermMemoryPatch[],
  ) => Promise<LongTermAgentProfile>;
};

export class InMemoryLongTermProfileRepository implements LongTermProfileRepository {
  private readonly profiles = new Map<AgentId, LongTermAgentProfile>();

  getOrCreate(agentId: AgentId): Promise<LongTermAgentProfile> {
    const existing = this.profiles.get(agentId);
    if (existing !== undefined) {
      return Promise.resolve(cloneProfile(existing));
    }

    const profile = createEmptyLongTermAgentProfile(agentId);
    this.profiles.set(agentId, cloneProfile(profile));
    return Promise.resolve(profile);
  }

  save(profile: LongTermAgentProfile): Promise<void> {
    this.profiles.set(profile.agentId, cloneProfile(profile));
    return Promise.resolve();
  }

  async applyPatches(
    agentId: AgentId,
    patches: readonly LongTermMemoryPatch[],
  ): Promise<LongTermAgentProfile> {
    const current = await this.getOrCreate(agentId);
    const updated = applyLongTermMemoryPatches(current, patches);
    await this.save(updated);
    return updated;
  }
}

function cloneProfile(profile: LongTermAgentProfile): LongTermAgentProfile {
  return {
    agentId: profile.agentId,
    beliefs: profile.beliefs.map((entry) => cloneEntry(entry)),
    habits: profile.habits.map((entry) => cloneEntry(entry)),
    mood: profile.mood.map((entry) => cloneEntry(entry)),
    values: profile.values.map((entry) => cloneEntry(entry)),
    personality: profile.personality.map((entry) => cloneEntry(entry)),
    socialRecords: profile.socialRecords.map((entry) => cloneEntry(entry)),
  };
}

function cloneEntry(entry: LongTermProfileEntry): LongTermProfileEntry {
  return {
    ...entry,
    provenanceRecordIds: [...entry.provenanceRecordIds],
  };
}
