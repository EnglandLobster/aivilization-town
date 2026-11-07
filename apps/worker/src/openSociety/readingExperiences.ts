import type { OpenSocietyState, ResidentExperience } from './types';
import { digest } from './journal';
import { hasExperience } from './state';

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
  'governance.read',
  'governance.votes',
  'governance.objections',
  'files.read',
  'groups.messages',
  'feed.read',
  'notifications.read',
  'records.read',
  'records.history',
  'programs.read',
  'programs.history',
  'programs.runs',
  'reactions.history',
  'resources.read',
  'views.read',
  'views.history',
  'views.query',
  'collectives.read',
  'collectives.history',
  'collectives.decision',
  'funds.ledger',
  'stocks.ledger',
  'production.read',
  'construction.read',
  'premises.read',
  'materials.read',
  'engagements.read',
  'engagements.ledger',
  'trades.read',
  'permits.read',
  'trades.ledger',
  'freight.read',
  'freight.ledger',
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
    name === 'governance.votes' ||
    name === 'governance.objections' ||
    name === 'groups.messages' ||
    name === 'records.history' ||
    name === 'programs.history' ||
    name === 'programs.runs' ||
    name === 'reactions.history' ||
    name === 'views.history' ||
    name === 'collectives.history' ||
    name === 'stocks.ledger' ||
    name === 'engagements.ledger' ||
    name === 'freight.ledger' ||
    name === 'trades.ledger' ||
    name === 'funds.ledger'
      ? Array.isArray(result.items)
        ? result.items.map(record)
        : []
      : [result];
  const added = new Set<string>();
  return artifacts.flatMap((artifact) => {
    const document =
      name === 'feed.read' || name === 'notifications.read' ? record(artifact.original) : artifact;
    const source = name.startsWith('governance.')
      ? `public-original-${digest([name, artifact.id, artifact.revision ?? null, artifact])}`
      : [
            'construction.read',
            'premises.read',
            'materials.read',
            'engagements.read',
            'engagements.ledger',
            'trades.read',
            'permits.read',
            'trades.ledger',
            'freight.read',
            'freight.ledger',
          ].includes(name)
        ? `premises-original-${digest([name, artifact.id, artifact.revision ?? null, artifact])}`
        : name === 'stocks.ledger'
          ? `material-receipt-${String(artifact.id)}`
          : name === 'production.read'
            ? `material-production-${digest([artifact.id, artifact.revision])}`
            : name === 'resources.read'
              ? `resource-control-${digest([artifact.kind, artifact.id, artifact.revision])}`
              : name === 'reactions.history'
                ? `reaction-${digest([artifact.id, artifact.revision])}`
                : name === 'programs.runs'
                  ? `program-run-${String(artifact.id)}`
                  : name === 'funds.ledger'
                    ? `account-receipt-${String(artifact.id)}`
                    : name.startsWith('collectives.')
                      ? `collective-${name === 'collectives.decision' ? 'decision' : 'charter'}-${digest([artifact.id, artifact.revision])}`
                      : name === 'views.query'
                        ? `view-query-${digest([artifact.viewId, artifact.viewRevision, artifact.source, artifact.offset, artifact.limit])}`
                        : name.startsWith('views.')
                          ? `view-${digest([artifact.id, artifact.revision])}`
                          : name.startsWith('records.')
                            ? `record-${digest([artifact.registerId, artifact.key, artifact.revision])}`
                            : name.startsWith('programs.')
                              ? `program-${digest([artifact.id, artifact.revision])}`
                              : name === 'groups.messages'
                                ? `group-message-${String(artifact.id)}`
                                : name === 'files.read'
                                  ? `document-${digest([document.id, document.revision])}`
                                  : `publication-${String(artifact.id)}`;
    const id = `experience-${source}-${actorId}`;
    if (hasExperience(state, actorId, id) || added.has(id)) return [];
    added.add(id);
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
            ...(typeof artifact.id === 'string' ? [artifact.id] : []),
            ...(typeof artifact.viewId === 'string' ? [artifact.viewId] : []),
            ...(typeof artifact.registerId === 'string' && typeof artifact.key === 'string'
              ? [`${artifact.registerId}/${artifact.key}`]
              : []),
            ...(typeof document.id === 'string' ? [document.id] : []),
          ]),
        ],
        people: experiencePeople(state, artifact),
        provenance:
          name === 'stocks.ledger' ||
          name === 'funds.ledger' ||
          name === 'programs.runs' ||
          name === 'reactions.history'
            ? ('firsthand' as const)
            : ('message-claim' as const),
      },
    ];
  });
}
