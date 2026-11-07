import { tool, text, integer, choice, page, strings } from './capabilitySchema';
const id = text('Exact premises permit ID', 96),
  expectedRevision = integer('Current permit revision');
export const PERMIT_TOOLS = [
  tool(
    'permits.rules',
    'Read the boundaries between control, shared/exclusive usage and physical occupation.',
    false,
    {},
    [],
  ),
  tool(
    'permits.list',
    'List permits visible to you without broadcasting private contracts.',
    false,
    { ...page },
    [],
  ),
  tool(
    'permits.read',
    'Read original permit terms and independent signatures; permissions do not cause participation.',
    false,
    { id },
  ),
  tool(
    'permits.access',
    'Read your current permissions and next authorization limit at a building.',
    false,
    { buildingId: text('Building ID', 96) },
  ),
  tool(
    'permits.offer',
    'Current controller offers a fixed scope, named users and time window. The grantee must independently accept.',
    true,
    {
      id,
      buildingId: text('Building ID', 96),
      buildingRevision: integer('Current building revision'),
      granteeKind: choice(['resident', 'collective']),
      granteeId: text('Receiving controller ID', 96),
      users: { ...strings, description: 'Up to 64 distinct named residents' },
      scopes: {
        ...strings,
        description:
          'Distinct scopes from entry, operate, store, reside; exclusive entry is unsupported',
      },
      mode: choice(['shared', 'exclusive']),
      title: text('Original title', 120),
      terms: text('Original terms', 8000),
      startAt: integer('Simulation permission start'),
      endAt: integer('Simulation permission end'),
      acceptBy: integer('Acceptance deadline'),
    },
  ),
  ...(['accept', 'withdraw', 'release'] as const).map((op) =>
    tool(
      `permits.${op}`,
      {
        accept:
          'Grantee independently accepts the original grant. Current control and conflicting rights/obligations are checked again.',
        withdraw:
          'Either party withdraws an unaccepted offer; accepted rights cannot be revoked unilaterally.',
        release:
          'Grantee releases its own future permission after ending actual work. Goods and residence are not erased.',
      }[op],
      true,
      { id, expectedRevision },
    ),
  ),
];
