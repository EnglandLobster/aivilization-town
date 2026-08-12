import {
  createMemoryProvenance,
  createShortTermMemoryRecord,
  type ScheduledIntention,
  type ShortTermMemoryRecord,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type {
  BulletinPostedPayload,
  TownBulletinPolicy,
  WorldEvent,
  WorldProjection,
} from '@aivilization/world';

/**
 * Town-bulletin awareness. When the
 * simulation-wide authority settles a BulletinPosted event, every resident
 * becomes aware of the bulletin through the town channel: an observation
 * memory tagged hearsay (residents hear the board announcement rather than
 * witnessing the underlying facts). High-priority bulletins additionally
 * preempt planning with a forced-attention ScheduledIntention.
 */
export function createBulletinObservationRecords(input: {
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
}): readonly ShortTermMemoryRecord[] {
  const bulletins = input.events.flatMap((event) =>
    event.type === 'BulletinPosted' ? [event.payload] : [],
  );
  const agentIds = Object.values(input.projection.agents)
    .map((agent) => agent.agentId)
    .sort((left, right) => left.localeCompare(right));
  return bulletins.flatMap((payload) =>
    agentIds.map((agentId) => createBulletinObservationRecord({ payload, agentId })),
  );
}

function createBulletinObservationRecord(input: {
  readonly payload: BulletinPostedPayload;
  readonly agentId: AgentId;
}): ShortTermMemoryRecord {
  const { bulletin } = input.payload;
  return createShortTermMemoryRecord({
    id: `bulletin-awareness:${bulletin.bulletinId}:${input.agentId}`,
    agentId: input.agentId,
    kind: 'observation',
    status: 'observed',
    summary: `Town bulletin "${bulletin.title}": ${bulletin.body}`,
    occurredAt: bulletin.postedAt,
    importanceScore: bulletin.priority === 'high' ? 0.9 : 0.5,
    source: { eventIds: [] },
    tags: [
      'town-bulletin',
      `bulletin-priority-${bulletin.priority}`,
      bulletin.bulletinId,
    ],
    // The town channel broadcasts secondhand by nature: residents read or
    // hear the board rather than witnessing the underlying events.
    provenance: createMemoryProvenance({ kind: 'hearsay' }),
  });
}

/**
 * Preemption: high-priority bulletins produce one forced-attention intention
 * per resident so the next planning cycle handles the bulletin before
 * ordinary work. Normal bulletins never preempt — they only enter awareness
 * memory. Intention ids are deterministic, so upserts are idempotent.
 */
export function createBulletinScheduledIntentions(input: {
  readonly records: readonly ShortTermMemoryRecord[];
  readonly policy: TownBulletinPolicy;
  readonly createdAt: number;
}): readonly ScheduledIntention[] {
  return input.records
    .filter((record) => record.tags.includes('bulletin-priority-high'))
    .map((record) => ({
      id: `town-bulletin:${record.agentId}:${record.id}`,
      agentId: record.agentId,
      description: `Attend to the high-priority town bulletin: ${record.summary}`,
      priority: input.policy.highPriorityIntentionPriority,
      startsAt: record.occurredAt,
      endsAt: record.occurredAt + input.policy.highPriorityReactionWindowMs,
      status: 'planned',
      affinityTags: ['town-bulletin', 'attention'],
      provenanceRecordIds: [record.id],
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }));
}
