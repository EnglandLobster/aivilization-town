import { canReadSpace, type InformationDocument, type InformationState } from './model';
import type { DistributionState, InformationPublication } from './distributionModel';

/** Current authorization plus an exact historical version; tombstones never expose a source. */
export function visiblePublicationSource(
  info: InformationState,
  actorId: string,
  publication: InformationPublication,
): InformationDocument | undefined {
  const current = info.documents[publication.documentId];
  const space = current === undefined ? undefined : info.spaces[current.spaceId];
  if (
    current === undefined ||
    current.deleted ||
    space === undefined ||
    !canReadSpace(space, actorId)
  )
    return undefined;
  return current.revision === publication.documentRevision
    ? current
    : info.history[current.id]?.find(
        (document) => document.revision === publication.documentRevision && !document.deleted,
      );
}
export function isSubscribedPublication(
  state: DistributionState,
  actorId: string,
  publication: InformationPublication,
  source: InformationDocument,
): boolean {
  if (publication.publisherId === actorId) return false;
  return Object.values(state.subscriptions[actorId] ?? {}).some(
    (subscription) =>
      subscription.active &&
      publication.sequence > subscription.sinceSequence &&
      (subscription.kind === 'author'
        ? subscription.targetId === publication.publisherId
        : subscription.targetId === source.spaceId),
  );
}
export function publicationMetadata(
  state: DistributionState,
  actorId: string,
  publication: InformationPublication,
  source: InformationDocument,
) {
  return {
    id: publication.id,
    sequence: publication.sequence,
    publisherId: publication.publisherId,
    authorId: source.authorId,
    documentId: source.id,
    documentRevision: source.revision,
    spaceId: source.spaceId,
    kind: publication.kind,
    at: publication.at,
    ...(source.title === undefined ? {} : { title: source.title }),
    read: Object.hasOwn(state.readByOwner[actorId] ?? {}, publication.id),
    provenance: 'original-document-reference' as const,
  };
}
export function listDistributionFeed(
  state: DistributionState,
  info: InformationState,
  actorId: string,
  unreadOnly = false,
) {
  const items: ReturnType<typeof publicationMetadata>[] = [];
  for (const publication of Object.values(state.publications)) {
    if (unreadOnly && Object.hasOwn(state.readByOwner[actorId] ?? {}, publication.id)) continue;
    const source = visiblePublicationSource(info, actorId, publication);
    if (source !== undefined && isSubscribedPublication(state, actorId, publication, source))
      items.push(publicationMetadata(state, actorId, publication, source));
  }
  return items.sort((a, b) => b.sequence - a.sequence);
}
export function readDistributionPublication(
  state: DistributionState,
  info: InformationState,
  actorId: string,
  id: string,
) {
  const publication = state.publications[id];
  if (publication === undefined) return undefined;
  const source = visiblePublicationSource(info, actorId, publication);
  if (source === undefined) return undefined;
  return {
    ...publicationMetadata(state, actorId, publication, source),
    ...(publication.comment === undefined ? {} : { comment: publication.comment }),
    original: source,
  };
}
