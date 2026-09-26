import { canReadSpace, type InformationState } from './model';

export const DOCUMENT_INDEX_VERSION = 'document-index-v1';
/** An index of author-supplied metadata. No body excerpts, rewriting or inferred labels. */
export function indexInformationDocuments(
  state: InformationState,
  actorId: string,
  filter: {
    readonly spaceId?: string;
    readonly prefix?: string;
    readonly authorId?: string;
    readonly tag?: string;
    readonly relatedTo?: string;
    readonly query?: string;
  },
) {
  const query = (filter.query ?? '').toLowerCase();
  return Object.values(state.documents)
    .filter((doc) => {
      const space = state.spaces[doc.spaceId];
      return (
        !doc.deleted &&
        space !== undefined &&
        canReadSpace(space, actorId) &&
        (filter.spaceId === undefined || doc.spaceId === filter.spaceId) &&
        (filter.prefix === undefined || doc.path.startsWith(filter.prefix)) &&
        (filter.authorId === undefined || doc.authorId === filter.authorId) &&
        (filter.tag === undefined || doc.tags?.includes(filter.tag)) &&
        (filter.relatedTo === undefined || doc.relatedTo === filter.relatedTo) &&
        [doc.path, doc.title ?? '', ...(doc.tags ?? []), doc.relatedTo ?? '']
          .join('\n')
          .toLowerCase()
          .includes(query)
      );
    })
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(
      ({
        id,
        spaceId,
        path,
        authorId,
        title,
        tags,
        relatedTo,
        revision,
        createdAt,
        updatedAt,
      }) => ({
        id,
        spaceId,
        path,
        authorId,
        title: title ?? path,
        tags: tags ?? [],
        relatedTo: relatedTo ?? null,
        revision,
        createdAt,
        updatedAt,
        metadataProvenance: 'author-supplied' as const,
        read: { capability: 'files.read', arguments: { spaceId, path } },
      }),
    );
}
