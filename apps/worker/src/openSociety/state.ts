import { canonicalCognitiveExperiences } from './canonicalCognition';
import { canonicalMemoryExperiences } from './canonicalMemory';
import { principalReplayAuthority } from './principalCollectiveAuthority';
import { applyWorldEventWithPrincipalAuthority } from '@aivilization/world';
import { assertResourceControlPolicy } from '@aivilization/authority';
import { applyCollectiveEvent, emptyCollectivesState } from '@aivilization/collaboration';
import { applySharedRecordsEvent, emptySharedRecordsState } from '@aivilization/information';
import { applyCoordinationEvent, emptyCoordinationState } from '@aivilization/collaboration';
import { applyCollaborationEvent, emptyCollaborationState } from '@aivilization/collaboration';
import {
  applyInformationEvent,
  applyCommunicationEvent,
  emptyCommunicationState,
  emptyInformationState,
} from '@aivilization/information';
import { applyCognitiveEvent } from '@aivilization/memory';
import { applyOrderedProgramEffects } from './programTransactionReplay';
import type {
  OpenSocietyCommit,
  OpenSocietyManifest,
  OpenSocietyState,
  OpenSocietyEffects,
  ResidentExperience,
} from './types';

export function initialOpenSocietyState(manifest: OpenSocietyManifest): OpenSocietyState {
  const canonicalMemories = canonicalMemoryExperiences(manifest);
  const canonicalDocuments = canonicalCognitiveExperiences(manifest);
  if (
    manifest.groupControlPolicy &&
    (!manifest.communicationPolicy || !manifest.resourceControlPolicy)
  )
    throw new Error('group-control-requires-communication-and-resource-control');
  if (manifest.resourceControlPolicy) assertResourceControlPolicy(manifest.resourceControlPolicy);
  if (manifest.programConditionsPolicy && !manifest.societyKernelPolicy)
    throw new Error('program-conditions-require-coordination');
  if (manifest.programActionsPolicy && !manifest.societyKernelPolicy)
    throw new Error('program-actions-require-coordination');
  if (
    manifest.societyKernelPolicy &&
    manifest.societyKernelPolicy.version !== 'agent-driven-society-v1'
  )
    throw new Error('unsupported-society-kernel-policy');
  return {
    ...(manifest.policy.actionPlans ? { actionPlans: manifest.policy.actionPlans } : {}),
    ...(manifest.collectivesPolicy
      ? { collectives: emptyCollectivesState(manifest.collectivesPolicy) }
      : {}),
    ...(manifest.societyKernelPolicy
      ? {
          sharedRecords: emptySharedRecordsState(manifest.societyKernelPolicy.records),
          coordination: emptyCoordinationState(
            manifest.societyKernelPolicy.coordination,
            manifest.programConditionsPolicy,
            manifest.programActionsPolicy,
          ),
        }
      : {}),
    revision: 0,
    worldSequence: 0,
    world: structuredClone(manifest.initialWorld),
    information: emptyInformationState(),
    ...(manifest.resourceControlPolicy
      ? { resourceControlPolicy: manifest.resourceControlPolicy }
      : {}),
    ...(manifest.communicationPolicy
      ? {
          communication: emptyCommunicationState(
            manifest.communicationPolicy,
            manifest.groupControlPolicy,
          ),
        }
      : {}),
    ...(manifest.collaborationPolicy
      ? { collaboration: emptyCollaborationState(manifest.collaborationPolicy) }
      : {}),
    cognition: {},
    experiences: Object.fromEntries(
      manifest.residents
        .map((r): [string, readonly ResidentExperience[]] => [
          r.id,
          [...(canonicalMemories[r.id] ?? []), ...(canonicalDocuments[r.id] ?? [])],
        ])
        .filter(([, entries]) => entries.length > 0),
    ),
    reminders: {},
    turns: {},
    residents: Object.fromEntries(
      manifest.residents.map((resident) => [
        resident.id,
        {
          actorId: resident.id,
          lastTurnOrdinal: 0,
          nextWakeAt: manifest.initialWorld.clock.now,
          wakeReason: 'free-activity',
          unreadMessageIds: [],
        },
      ]),
    ),
  };
}
export function applyOpenSocietyEffects(
  state: OpenSocietyState,
  effects: OpenSocietyEffects,
): OpenSocietyState {
  if (effects.effectOrder !== undefined) {
    const working = applyOrderedProgramEffects(state, effects, applyUnorderedSocietyEffects);
    // UI and cognitive delivery metadata follows the complete atomic domain transition.
    return applyOpenSocietyEffects(working, {
      ...(effects.cityApps === undefined ? {} : { cityApps: effects.cityApps }),
      ...(effects.experiences ? { experiences: effects.experiences } : {}),
      ...(effects.residents ? { residents: effects.residents } : {}),
      ...(effects.reminders ? { reminders: effects.reminders } : {}),
      ...(effects.turns ? { turns: effects.turns } : {}),
    });
  }
  if (
    effects.coordinationEvents?.some(
      (e) =>
        e.type === 'ProgramRunRecorded' &&
        (e.run.execution ||
          (e.run.status === 'succeeded' &&
            state.coordination?.programs[e.run.programId]?.actionPolicyVersion)),
    )
  )
    throw Error('program-ordered-transaction-required');
  return applyUnorderedSocietyEffects(state, effects);
}
function applyUnorderedSocietyEffects(
  state: OpenSocietyState,
  effects: OpenSocietyEffects,
): OpenSocietyState {
  let world = state.world;
  const principalAuthority = principalReplayAuthority(state, effects);
  let worldSequence = state.worldSequence;
  for (const event of effects.worldEvents ?? []) {
    if (event.sequence !== worldSequence + 1) throw new Error('world-event-sequence-gap');
    world = applyWorldEventWithPrincipalAuthority(world, event, principalAuthority);
    worldSequence = event.sequence;
  }
  const information = (effects.informationEvents ?? []).reduce(
    applyInformationEvent,
    state.information,
  );
  let collectives = state.collectives;
  for (const event of effects.collectiveEvents ?? [])
    collectives = applyCollectiveEvent(collectives, event);
  let collaboration = state.collaboration;
  let sharedRecords = state.sharedRecords;
  for (const event of effects.sharedRecordsEvents ?? [])
    sharedRecords = applySharedRecordsEvent(sharedRecords, event);
  let coordination = state.coordination;
  for (const event of effects.coordinationEvents ?? [])
    coordination = applyCoordinationEvent(coordination, event);
  for (const event of effects.collaborationEvents ?? [])
    collaboration = applyCollaborationEvent(collaboration, event);
  let communication = state.communication;
  for (const event of effects.communicationEvents ?? [])
    communication = applyCommunicationEvent(communication, event);
  const cognition = { ...state.cognition };
  for (const event of effects.cognitiveEvents ?? [])
    cognition[event.entry.ownerId] = applyCognitiveEvent(
      cognition[event.entry.ownerId] ?? {},
      event,
    );
  const experiences = appendExperiences(state.experiences, effects.experiences ?? []);
  return {
    ...state,
    ...(effects.cityApps === undefined ? {} : { cityApps: effects.cityApps }),
    world,
    worldSequence,
    information,
    ...(communication ? { communication } : {}),
    ...(collaboration ? { collaboration } : {}),
    ...(collectives ? { collectives } : {}),
    ...(sharedRecords ? { sharedRecords } : {}),
    ...(coordination ? { coordination } : {}),
    cognition,
    experiences,
    residents: upsert(state.residents, effects.residents, (resident) => resident.actorId),
    reminders: upsert(state.reminders, effects.reminders, (reminder) => reminder.id),
    turns: upsert(state.turns, effects.turns, (turn) => turn.id),
  };
}
/**
 * Merge changed entries into a keyed table. A commit that changes none keeps the same table: the
 * turn table alone grows by two entries per opportunity, and copying it on every commit was most
 * of the remaining replay time.
 */
function upsert<T>(
  table: Readonly<Record<string, T>>,
  changed: readonly T[] | undefined,
  key: (entry: T) => string,
): Readonly<Record<string, T>> {
  if (!changed?.length) return table;
  return { ...table, ...Object.fromEntries(changed.map((entry) => [key(entry), entry])) };
}
/**
 * The IDs in each owner's experience list, keyed by the (immutable) list itself. Appending used to
 * scan and copy the whole list once per experience, which made replay and every commit slower as a
 * town aged (a 13-day town took minutes to open). A missing entry is rebuilt from the list.
 */
const experienceIds = new WeakMap<readonly ResidentExperience[], Set<string>>();
function idsOf(list: readonly ResidentExperience[]): Set<string> {
  let ids = experienceIds.get(list);
  if (ids === undefined) {
    ids = new Set(list.map((entry) => entry.id));
    experienceIds.set(list, ids);
  }
  return ids;
}
/** Whether the owner already has an experience with this ID. */
export function hasExperience(state: OpenSocietyState, ownerId: string, id: string): boolean {
  const list = state.experiences[ownerId];
  return list !== undefined && idsOf(list).has(id);
}
/** Same result as appending one by one with a duplicate check; copies each owner's list once. */
function appendExperiences(
  current: OpenSocietyState['experiences'],
  added: readonly ResidentExperience[],
): OpenSocietyState['experiences'] {
  if (!added.length) return current;
  const byOwner = new Map<string, ResidentExperience[]>();
  for (const experience of added) {
    const items = byOwner.get(experience.ownerId);
    if (items) items.push(experience);
    else byOwner.set(experience.ownerId, [experience]);
  }
  // Check everything before touching any index, so a refused commit leaves no trace.
  for (const [ownerId, items] of byOwner) {
    const ids = idsOf(current[ownerId] ?? []);
    const fresh = new Set<string>();
    for (const { id } of items) {
      if (ids.has(id) || fresh.has(id)) throw new Error('duplicate-experience-id');
      fresh.add(id);
    }
  }
  const next = { ...current };
  for (const [ownerId, items] of byOwner) {
    const existing = current[ownerId] ?? [];
    const list = [...existing, ...items];
    // Move the index to the new list; the old list rebuilds its own if it is ever extended again.
    const ids = idsOf(existing);
    experienceIds.delete(existing);
    for (const { id } of items) ids.add(id);
    experienceIds.set(list, ids);
    next[ownerId] = list;
  }
  return next;
}

export function applyOpenSocietyCommit(
  state: OpenSocietyState,
  commit: OpenSocietyCommit,
): OpenSocietyState {
  if (commit.sequence !== state.revision + 1) throw new Error('journal-sequence-gap');
  return { ...applyOpenSocietyEffects(state, commit), revision: commit.sequence };
}
