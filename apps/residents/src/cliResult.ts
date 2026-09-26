import { cliRoute } from './cliCatalog';

/** Adapt only server-owned navigation metadata. Never traverse or rewrite original content. */
export function residentCliResult(
  capability: string,
  result: Record<string, unknown>,
): Record<string, unknown> {
  if (
    !['files.index', 'files.list', 'files.search', 'messages.list', 'memory.search'].includes(
      capability,
    )
  )
    return result;
  const data = result.data;
  if (data === null || typeof data !== 'object' || !('items' in data) || !Array.isArray(data.items))
    return result;
  return {
    ...result,
    data: {
      ...data,
      items: data.items.map((item: unknown) => {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
        const entry = item as Record<string, unknown>;
        if (
          capability === 'files.index' &&
          typeof entry.spaceId === 'string' &&
          typeof entry.path === 'string'
        ) {
          return {
            ...entry,
            read: {
              command: 'town',
              argv: ['files', 'read', '--space-id', entry.spaceId, '--path', entry.path],
            },
          };
        }
        return typeof entry.expandedBy === 'string'
          ? { ...entry, expandedBy: cliRoute(entry.expandedBy) }
          : entry;
      }),
    },
  };
}
