import { tool, text, integer, choice, page } from './capabilitySchema';
const id = text('Exact existing resource ID', 96),
  kind = choice(['space', 'register', 'view', 'group', 'service', 'enterprise']),
  revision = integer('Exact current revision'),
  base = { kind, id, expectedRevision: revision, expectedControlVersion: revision };
export const RESOURCE_CONTROL_TOOLS = [
  tool(
    'resources.list',
    'List administrative metadata for resources you control or are offered. This grants no content access or usage rights.',
    false,
    { ...page },
    [],
  ),
  tool(
    'resources.read',
    'Read current controller and an attributed handover offer, without private contents.',
    false,
    { kind, id },
  ),
  tool(
    'resources.offer',
    'Personal controller offers a versioned handover. Target independently accepts; collective actions require their exact decision.',
    true,
    {
      ...base,
      target: { type: 'object', description: 'Closed JSON {kind:resident|collective,id}' },
      expiresAt: integer('Exclusive simulation-time expiry'),
      terms: text('Original handover terms; not executable authority', 2000),
    },
  ),
  tool(
    'resources.accept',
    'Personally accept control offered to you. Collective recipients act through their own exact passed decision.',
    true,
    base,
  ),
  tool(
    'resources.cancel',
    'Personal controller withdraws the pending offer. A collective controller uses its exact decision.',
    true,
    base,
  ),
  tool(
    'resources.manage',
    'Apply a closed administrative operation under the actual controller. Does not rewrite authorship or create consent, money or physical effects.',
    true,
    {
      ...base,
      operation: {
        type: 'object',
        description:
          'Closed kind-specific operation. See society/resources.md for space/register settings, view definitions and group administration.',
      },
    },
  ),
];
