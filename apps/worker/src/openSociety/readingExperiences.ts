import type { OpenSocietyState, ResidentExperience } from './types';
import { digest } from './journal';

const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const personKeys = new Set([
  'authorId',
  'publisherId',
  'buyerId',
  'sellerId',
  'residentId',
  'ownerId',
  'providerId',
  'recipientId',
  'hostId',
  'tenantId',
  'targetId',
  'senderId',
  'requesterId',
  'partnerId',
]);
/** Extract only typed adapter metadata. Never parse personal text as authority or references. */
export function experiencePeople(
  state: { residents: Readonly<Record<string, unknown>> },
  value: unknown,
): string[] {
  const people = new Set<string>();
  function visit(v: unknown, depth: number) {
    if (depth > 4) return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(record(v))) {
      if (personKeys.has(key) && typeof item === 'string' && Object.hasOwn(state.residents, item))
        people.add(item);
      if (['participants', 'payers', 'members', 'paidBy'].includes(key) && Array.isArray(item))
        for (const id of item)
          if (typeof id === 'string' && Object.hasOwn(state.residents, id)) people.add(id);
      if (typeof item === 'object') visit(item, depth + 1);
    }
  }
  visit(value, 0);
  return [...people].sort();
}
export const ORIGINAL_READS = new Set([
  'files.read',
  'groups.messages',
  'feed.read',
  'notifications.read',
]);
/** Record exactly the originals returned by a successful authorized read, once per version. */
export function readingExperiences(
  state: OpenSocietyState,
  actorId: string,
  name: string,
  data: unknown,
): ResidentExperience[] {
  if (!ORIGINAL_READS.has(name)) return [];
  const result = record(data);
  const artifacts =
    name === 'groups.messages'
      ? Array.isArray(result.items)
        ? result.items.map(record)
        : []
      : [result];
  const seen = new Set((state.experiences[actorId] ?? []).map((e) => e.id));
  return artifacts.flatMap((artifact) => {
    const document =
      name === 'feed.read' || name === 'notifications.read' ? record(artifact.original) : artifact;
    const source =
      name === 'groups.messages'
        ? `group-message-${String(artifact.id)}`
        : name === 'files.read'
          ? `document-${digest([document.id, document.revision])}`
          : `publication-${String(artifact.id)}`;
    const id = `experience-${source}-${actorId}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const occurredAt =
      typeof artifact.at === 'number'
        ? artifact.at
        : typeof document.updatedAt === 'number'
          ? document.updatedAt
          : state.world.clock.now;
    return [
      {
        id,
        ownerId: actorId,
        at: state.world.clock.now,
        occurredAt,
        kind: 'observation' as const,
        summary: `${name} succeeded: ${JSON.stringify(artifact)}`,
        sourceIds: [
          ...new Set([
            source,
            String(artifact.id),
            ...(typeof document.id === 'string' ? [document.id] : []),
          ]),
        ],
        people: experiencePeople(state, artifact),
        provenance: 'message-claim' as const,
      },
    ];
  });
}
