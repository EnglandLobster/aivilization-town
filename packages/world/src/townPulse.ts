import type { AgentId } from '@aivilization/sim-core';
import type { WorldEvent } from './events';

/**
 * Town pulse ring (AGENT_CONTEXT_DESIGN.md §4 right 3, independent-section
 * path): a bounded, deterministic read-model of recent town-wide occurrences
 * — deaths, departures, arrivals, petition thresholds, weather shifts,
 * enterprise openings and closures — maintained by the projection reducer
 * purely for the per-agent "town news" context section. It is deliberately
 * NOT part of the ambient bystander channel: those records are firsthand
 * and co-located; town-wide events are hearsay by nature, and conflating
 * the two provenances would defeat the memory system's firsthand/hearsay
 * distinction. Settlement never consumes this ring; adding it changes no
 * domain outcomes (no bereavement coupling — explicitly out of scope).
 */

export const WORLD_TOWN_PULSE_RING_CAPACITY = 32;

export type WorldTownPulseKind =
  | 'death'
  | 'emigration'
  | 'arrival'
  | 'petition-threshold'
  | 'weather-change'
  | 'enterprise-founded'
  | 'enterprise-closed';

export type WorldTownPulseRecord = {
  /** Event sequence, retained for stable ordering among equal timestamps. */
  readonly sequence: number;
  readonly occurredAt: number;
  readonly kind: WorldTownPulseKind;
  readonly subjectAgentId?: AgentId;
  readonly subjectDisplayName?: string;
  readonly subjectEnterpriseName?: string;
  /** Machine-readable qualifier (cause, weather transition, petition topic). */
  readonly detail?: string;
};

/**
 * Append the pulse view of one world event onto the ring. Events that carry
 * no pulse meaning leave the ring untouched (same reference). Subject names
 * come from the callers' resolvers, which read the projection BEFORE the
 * event's own reducer runs — death/emigration remove the agent and closure
 * may drop the enterprise, so the ring must snapshot names at append time.
 * Deterministic and replay-safe: same ring + same event + same pre-state
 * produces the same record.
 */
export function appendWorldTownPulseRecord(input: {
  readonly records: readonly WorldTownPulseRecord[];
  readonly event: WorldEvent;
  readonly resolveAgentDisplayName: (agentId: AgentId) => string | undefined;
  readonly resolveEnterpriseName: (enterpriseId: string) => string | undefined;
}): readonly WorldTownPulseRecord[] {
  const record = describeTownPulseEvent(input.event, input);
  if (record === undefined) {
    return input.records;
  }
  const next = [...input.records, record];
  return next.length <= WORLD_TOWN_PULSE_RING_CAPACITY
    ? next
    : next.slice(next.length - WORLD_TOWN_PULSE_RING_CAPACITY);
}

function describeTownPulseEvent(
  event: WorldEvent,
  input: {
    readonly resolveAgentDisplayName: (agentId: AgentId) => string | undefined;
    readonly resolveEnterpriseName: (enterpriseId: string) => string | undefined;
  },
): WorldTownPulseRecord | undefined {
  switch (event.type) {
    case 'AgentDied': {
      const displayName = input.resolveAgentDisplayName(event.payload.agentId);
      return {
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        kind: 'death',
        subjectAgentId: event.payload.agentId,
        ...(displayName === undefined ? {} : { subjectDisplayName: displayName }),
        detail: event.payload.cause,
      };
    }
    case 'AgentEmigrated': {
      const displayName = input.resolveAgentDisplayName(event.payload.agentId);
      return {
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        kind: 'emigration',
        subjectAgentId: event.payload.agentId,
        ...(displayName === undefined ? {} : { subjectDisplayName: displayName }),
        detail: event.payload.cause,
      };
    }
    case 'AgentRegistered':
      return {
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        kind: 'arrival',
        subjectAgentId: event.payload.agentId,
        ...(event.payload.displayName.length === 0
          ? {}
          : { subjectDisplayName: event.payload.displayName }),
      };
    case 'PetitionThresholdReached':
      return {
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        kind: 'petition-threshold',
        detail: event.payload.topic,
      };
    case 'WeatherChanged':
      return {
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        kind: 'weather-change',
        detail: `${event.payload.from}->${event.payload.to}`,
      };
    case 'EnterpriseFounded':
      return {
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        kind: 'enterprise-founded',
        subjectAgentId: event.payload.ownerAgentId,
        subjectEnterpriseName: event.payload.name,
        detail: event.payload.occupationName,
      };
    case 'EnterpriseClosed': {
      const name = input.resolveEnterpriseName(event.payload.enterpriseId);
      return {
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        kind: 'enterprise-closed',
        subjectAgentId: event.payload.ownerAgentId,
        ...(name === undefined ? {} : { subjectEnterpriseName: name }),
        detail: event.payload.reason,
      };
    }
    default:
      return undefined;
  }
}
