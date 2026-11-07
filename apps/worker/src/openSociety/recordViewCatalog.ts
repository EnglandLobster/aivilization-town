import { tool, text, integer, choice, strings, page } from './capabilitySchema';
const id = text('Resident-chosen view ID', 96),
  revision = integer('Exact current view revision');
export const RECORD_VIEW_TOOLS = [
  ...(['publish', 'revise'] as const).map((op) =>
    tool(
      `views.${op}`,
      'Define your own bounded computation over an authorized shared register. Results remain resident claims, not world truth or platform ratings.',
      true,
      {
        id,
        ...(op === 'revise' ? { expectedRevision: revision } : {}),
        title: text('Your original title', 120),
        visibility: choice(['public', 'private']),
        readers: strings,
        definition: {
          type: 'object',
          description:
            'Closed JSON query: sourceRegisterId/select/where/derive/orderBy/aggregate. See town wiki society/views.md.',
        },
      },
    ),
  ),
  tool('views.disable', 'Owner stops future queries without deleting original definitions.', true, {
    id,
    expectedRevision: revision,
  }),
  tool(
    'views.list',
    'List metadata only when both view and source register currently permit you to read.',
    false,
    { ...page },
    [],
  ),
  tool(
    'views.read',
    'Read an attributed view definition under current view and source permissions.',
    false,
    { id },
  ),
  tool(
    'views.history',
    'Read preserved definitions you may currently access, without reexecuting them.',
    false,
    { id, ...page },
    ['id'],
  ),
  tool(
    'views.query',
    'Evaluate an exact view version; return source versions, bounded rows and whole-authorized-input aggregates. Does not change world state.',
    false,
    { id, expectedRevision: revision, ...page },
    ['id', 'expectedRevision'],
  ),
];
