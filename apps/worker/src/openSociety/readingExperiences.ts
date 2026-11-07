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
  'records.read',
  'records.history',
  'programs.read',
  'programs.history',
  'programs.runs',
  'resources.read',
  'collectives.read',
  'collectives.history',
  'collectives.decision',
  'funds.ledger',
  'stocks.ledger',
  'production.read',
  'construction.read',
  'premises.read',
  'materials.read',
]);
/** Reads that return a page of originals in `items`; every other read returns one original. */
const LIST_READS = new Set([
  'governance.votes',
  'governance.objections',
  'groups.messages',
  'records.history',
  'programs.history',
  'programs.runs',
  'collectives.history',
  'stocks.ledger',
  'funds.ledger',
]);
/** Ledgers of the resident's own committed effects, as opposed to what someone else wrote. */
const FIRSTHAND_READS = new Set(['stocks.ledger', 'funds.ledger', 'programs.runs']);
const PREMISES_READS = new Set(['construction.read', 'premises.read', 'materials.read']);
function sourceOf(name: string, artifact: Record<string, unknown>): string {
  if (name.startsWith('governance.'))
    return `public-original-${digest([name, artifact.id, artifact.revision ?? null, artifact])}`;
  if (PREMISES_READS.has(name))
    return `premises-original-${digest([name, artifact.id, artifact.revision ?? null, artifact])}`;
  if (name === 'stocks.ledger') return `material-receipt-${String(artifact.id)}`;
  if (name === 'production.read')
    return `material-production-${digest([artifact.id, artifact.revision])}`;
  if (name === 'resources.read')
    return `resource-control-${digest([artifact.kind, artifact.id, artifact.revision])}`;
  if (name === 'programs.runs') return `program-run-${String(artifact.id)}`;
  if (name === 'funds.ledger') return `account-receipt-${String(artifact.id)}`;
  if (name.startsWith('collectives.'))
    return `collective-${name === 'collectives.decision' ? 'decision' : 'charter'}-${digest([artifact.id, artifact.revision])}`;
  if (name.startsWith('records.'))
    return `record-${digest([artifact.registerId, artifact.key, artifact.revision])}`;
  if (name.startsWith('programs.')) return `program-${digest([artifact.id, artifact.revision])}`;
  if (name === 'groups.messages') return `group-message-${String(artifact.id)}`;
  if (name === 'files.read') return `document-${digest([artifact.id, artifact.revision])}`;
  return `publication-${String(artifact.id)}`;
}
/** Record exactly the originals returned by a successful authorized read, once per version. */
export function readingExperiences(
  state: OpenSocietyState,
  actorId: string,
  name: string,
  data: unknown,
): ResidentExperience[] {
  if (!ORIGINAL_READS.has(name)) return [];
  const result = record(data);
  const artifacts = LIST_READS.has(name)
    ? Array.isArray(result.items)
      ? result.items.map(record)
      : []
    : [result];
  const added = new Set<string>();
  return artifacts.flatMap((artifact) => {
    const source = sourceOf(name, artifact);
    const id = `experience-${source}-${actorId}`;
    if (hasExperience(state, actorId, id) || added.has(id)) return [];
    added.add(id);
    const occurredAt =
      typeof artifact.at === 'number'
        ? artifact.at
        : typeof artifact.updatedAt === 'number'
          ? artifact.updatedAt
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
            ...(typeof artifact.registerId === 'string' && typeof artifact.key === 'string'
              ? [`${artifact.registerId}/${artifact.key}`]
              : []),
          ]),
        ],
        people: experiencePeople(state, artifact),
        provenance: FIRSTHAND_READS.has(name) ? ('firsthand' as const) : ('message-claim' as const),
      },
    ];
  });
}
