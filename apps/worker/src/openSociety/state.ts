import { applyResidentLifeEvents, emptyResidentLifeState } from './lifeState';
import { applyServicesEvent, emptyServicesState } from '@aivilization/services';
import { applyCollaborationEvent, emptyCollaborationState } from '@aivilization/collaboration';
import {
  applyInformationEvent,
  applyCommunicationEvent,
  emptyCommunicationState,
  emptyInformationState,
  applyDistributionEvent,
  emptyDistributionState,
} from '@aivilization/information';
import { applyCognitiveEvent } from '@aivilization/memory';
import { applyWorldEvent } from '@aivilization/world';
import type {
  OpenSocietyCommit,
  OpenSocietyManifest,
  OpenSocietyState,
  OpenSocietyEffects,
} from './types';

export function initialOpenSocietyState(manifest: OpenSocietyManifest): OpenSocietyState {
  if (manifest.lifeVersion !== undefined && manifest.lifeVersion !== 'resident-life-v1')
    throw new Error('unsupported-resident-life-version');
  return {
    revision: 0,
    worldSequence: 0,
    world: structuredClone(manifest.initialWorld),
    information: emptyInformationState(),
    ...(manifest.distributionPolicy === undefined
      ? {}
      : { distribution: emptyDistributionState(manifest.distributionPolicy) }),
    ...(manifest.communicationPolicy
      ? { communication: emptyCommunicationState(manifest.communicationPolicy) }
      : {}),
    ...(manifest.collaborationPolicy
      ? { collaboration: emptyCollaborationState(manifest.collaborationPolicy) }
      : {}),
    ...(manifest.servicesPolicy ? { services: emptyServicesState(manifest.servicesPolicy) } : {}),
    ...(manifest.lifeVersion ? { life: emptyResidentLifeState() } : {}),
    cognition: {},
    experiences: {},
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
  let world = state.world;
  let worldSequence = state.worldSequence;
  for (const event of effects.worldEvents ?? []) {
    if (event.sequence !== worldSequence + 1) throw new Error('world-event-sequence-gap');
    world = applyWorldEvent(world, event);
    worldSequence = event.sequence;
  }
  const information = (effects.informationEvents ?? []).reduce(
    applyInformationEvent,
    state.information,
  );
  let collaboration = state.collaboration;
  for (const event of effects.collaborationEvents ?? [])
    collaboration = applyCollaborationEvent(collaboration, event);
  const life = applyResidentLifeEvents(state.life, effects);
  let services = state.services;
  for (const event of effects.servicesEvents ?? []) services = applyServicesEvent(services, event);
  let communication = state.communication;
  for (const event of effects.communicationEvents ?? [])
    communication = applyCommunicationEvent(communication, event);
  let distribution = state.distribution;
  for (const event of effects.distributionEvents ?? [])
    distribution = applyDistributionEvent(distribution, event);
  const cognition = { ...state.cognition };
  for (const event of effects.cognitiveEvents ?? [])
    cognition[event.entry.ownerId] = applyCognitiveEvent(
      cognition[event.entry.ownerId] ?? {},
      event,
    );
  const experiences = { ...state.experiences };
  for (const experience of effects.experiences ?? []) {
    const existing = experiences[experience.ownerId] ?? [];
    if (existing.some((entry) => entry.id === experience.id))
      throw new Error('duplicate-experience-id');
    experiences[experience.ownerId] = [...existing, experience];
  }
  return {
    ...state,
    ...(effects.cityApps === undefined ? {} : { cityApps: effects.cityApps }),
    world,
    worldSequence,
    information,
    ...(distribution === undefined ? {} : { distribution }),
    ...(communication ? { communication } : {}),
    ...(collaboration ? { collaboration } : {}),
    ...(services ? { services } : {}),
    ...(life ? { life } : {}),
    cognition,
    experiences,
    residents: {
      ...state.residents,
      ...Object.fromEntries(
        (effects.residents ?? []).map((resident) => [resident.actorId, resident]),
      ),
    },
    reminders: {
      ...state.reminders,
      ...Object.fromEntries((effects.reminders ?? []).map((reminder) => [reminder.id, reminder])),
    },
    turns: {
      ...state.turns,
      ...Object.fromEntries((effects.turns ?? []).map((turn) => [turn.id, turn])),
    },
  };
}
export function applyOpenSocietyCommit(
  state: OpenSocietyState,
  commit: OpenSocietyCommit,
): OpenSocietyState {
  if (commit.sequence !== state.revision + 1) throw new Error('journal-sequence-gap');
  return { ...applyOpenSocietyEffects(state, commit), revision: commit.sequence };
}
