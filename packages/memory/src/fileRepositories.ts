import type { AgentId } from '@aivilization/sim-core';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  completeLongHorizonObjective,
  createEmptyAgentIntentionState,
  setLongHorizonObjective,
  upsertScheduledIntentions,
  type AgentIntentionState,
  type CompletedLongHorizonObjective,
  type LongHorizonObjective,
  type ScheduledIntention,
} from './intentions';
import {
  applyLongTermMemoryPatches,
  createEmptyLongTermAgentProfile,
  type LongTermAgentProfile,
  type LongTermMemoryPatch,
  type LongTermProfileEntry,
} from './profile';
import type { ShortTermMemoryRecord } from './records';
import type {
  AgentIntentionRepository,
  CompleteLongHorizonObjectiveRequest,
} from './intentionRepository';
import type { LongTermProfileRepository } from './profileRepository';
import { retrieveShortTermMemory, type ShortTermMemoryQuery } from './retrieval';
import type { ShortTermMemoryRepository } from './repository';

export class FileShortTermMemoryRepository implements ShortTermMemoryRepository {
  private readonly recordsPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.recordsPath = join(input.rootDir, 'short-term-memory.jsonl');
    ensureFile(this.recordsPath, input.rootDir);
  }

  append(record: ShortTermMemoryRecord): Promise<void> {
    appendJsonLines(this.recordsPath, [record]);
    return Promise.resolve();
  }

  appendMany(records: readonly ShortTermMemoryRecord[]): Promise<void> {
    appendJsonLines(this.recordsPath, records);
    return Promise.resolve();
  }

  retrieve(query: ShortTermMemoryQuery): Promise<ShortTermMemoryRecord[]> {
    return Promise.resolve(retrieveShortTermMemory(readJsonLines(this.recordsPath), query));
  }
}

export class FileAgentIntentionRepository implements AgentIntentionRepository {
  private readonly statesPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.statesPath = join(input.rootDir, 'agent-intentions.jsonl');
    ensureFile(this.statesPath, input.rootDir);
  }

  async getOrCreate(agentId: AgentId): Promise<AgentIntentionState> {
    const existing = this.getLatestState(agentId);
    if (existing !== undefined) {
      return cloneState(existing);
    }

    const state = createEmptyAgentIntentionState(agentId);
    await this.save(state);
    return state;
  }

  save(state: AgentIntentionState): Promise<void> {
    appendJsonLines(this.statesPath, [cloneState(state)]);
    return Promise.resolve();
  }

  async setObjective(
    agentId: AgentId,
    objective: LongHorizonObjective,
  ): Promise<AgentIntentionState> {
    const current = await this.getOrCreate(agentId);
    const updated = setLongHorizonObjective(current, objective);
    await this.save(updated);
    return updated;
  }

  async upsertScheduledIntentions(
    agentId: AgentId,
    scheduledIntentions: readonly ScheduledIntention[],
  ): Promise<AgentIntentionState> {
    const current = await this.getOrCreate(agentId);
    const updated = upsertScheduledIntentions(current, scheduledIntentions);
    await this.save(updated);
    return updated;
  }

  async completeObjective(
    agentId: AgentId,
    input: CompleteLongHorizonObjectiveRequest,
  ): Promise<AgentIntentionState> {
    const current = await this.getOrCreate(agentId);
    const updated = completeLongHorizonObjective(current, input);
    await this.save(updated);
    return updated;
  }

  private getLatestState(agentId: AgentId): AgentIntentionState | undefined {
    return readJsonLines<AgentIntentionState>(this.statesPath)
      .filter((state) => state.agentId === agentId)
      .at(-1);
  }
}

export class FileLongTermProfileRepository implements LongTermProfileRepository {
  private readonly profilesPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.profilesPath = join(input.rootDir, 'long-term-profiles.jsonl');
    ensureFile(this.profilesPath, input.rootDir);
  }

  async getOrCreate(agentId: AgentId): Promise<LongTermAgentProfile> {
    const existing = this.getLatestProfile(agentId);
    if (existing !== undefined) {
      return cloneProfile(existing);
    }

    const profile = createEmptyLongTermAgentProfile(agentId);
    await this.save(profile);
    return profile;
  }

  save(profile: LongTermAgentProfile): Promise<void> {
    appendJsonLines(this.profilesPath, [cloneProfile(profile)]);
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

  private getLatestProfile(agentId: AgentId): LongTermAgentProfile | undefined {
    return readJsonLines<LongTermAgentProfile>(this.profilesPath)
      .filter((profile) => profile.agentId === agentId)
      .at(-1);
  }
}

function cloneState(state: AgentIntentionState): AgentIntentionState {
  return {
    agentId: state.agentId,
    ...(state.activeObjective === undefined
      ? {}
      : { activeObjective: cloneObjective(state.activeObjective) }),
    completedObjectives: (state.completedObjectives ?? []).map((completed) =>
      cloneCompletedObjective(completed),
    ),
    scheduledIntentions: state.scheduledIntentions.map((intention) =>
      cloneScheduledIntention(intention),
    ),
    updatedAt: state.updatedAt,
  };
}

function cloneObjective(objective: LongHorizonObjective): LongHorizonObjective {
  return {
    ...objective,
    affinityTags: [...objective.affinityTags],
  };
}

function cloneCompletedObjective(
  completed: CompletedLongHorizonObjective,
): CompletedLongHorizonObjective {
  return {
    objective: cloneObjective(completed.objective),
    completedAt: completed.completedAt,
    reason: completed.reason,
    ...(completed.planId === undefined ? {} : { planId: completed.planId }),
  };
}

function cloneScheduledIntention(intention: ScheduledIntention): ScheduledIntention {
  return {
    id: intention.id,
    agentId: intention.agentId,
    ...(intention.objectiveId === undefined ? {} : { objectiveId: intention.objectiveId }),
    ...(intention.branchId === undefined ? {} : { branchId: intention.branchId }),
    ...(intention.subtaskId === undefined ? {} : { subtaskId: intention.subtaskId }),
    ...(intention.sourcePlanId === undefined ? {} : { sourcePlanId: intention.sourcePlanId }),
    description: intention.description,
    priority: intention.priority,
    startsAt: intention.startsAt,
    endsAt: intention.endsAt,
    status: intention.status,
    affinityTags: [...intention.affinityTags],
    ...(intention.provenanceRecordIds === undefined
      ? {}
      : { provenanceRecordIds: [...intention.provenanceRecordIds] }),
    createdAt: intention.createdAt,
    updatedAt: intention.updatedAt,
  };
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

function ensureFile(filePath: string, rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '');
  }
}

function appendJsonLines(path: string, values: readonly unknown[]): void {
  if (values.length === 0) {
    return;
  }
  const payload = values.map((value) => JSON.stringify(value)).join('\n');
  appendFileSync(path, `${payload}\n`);
}

function readJsonLines<TValue>(path: string): readonly TValue[] {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, 'utf8').trim();
  if (content.length === 0) {
    return [];
  }
  return content.split('\n').map((line) => JSON.parse(line) as TValue);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
