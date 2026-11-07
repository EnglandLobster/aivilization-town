import { tool, text, integer, page } from './capabilitySchema';
const id = text('Stable resident-chosen ID', 96),
  revision = integer('Exact current revision');
export const REACTION_TOOLS = [
  tool(
    'reactions.watch',
    'Register finite reevaluations of a program on committed dependency changes. No immediate execution; every run requires current mandates and source access.',
    true,
    {
      id,
      programId: id,
      programRevision: revision,
      maxReactions: integer('Maximum change checks, including skipped checks', 100),
      expiresAt: integer('Exclusive simulation-time expiry'),
    },
  ),
  tool(
    'reactions.cancel',
    'Runner cancels pending change checks. Completed effects remain; unused mandates are not consumed.',
    true,
    { id, expectedRevision: revision },
  ),
  tool(
    'reactions.list',
    'List watches for procedures you participate in, with finite progress and stop reasons.',
    false,
    { ...page },
    [],
  ),
  tool(
    'reactions.read',
    'Read one watch and its current progress; this does not grant access to its source data.',
    false,
    { id },
  ),
  tool(
    'reactions.history',
    'Read actual queued and completed change checks, their origin commit and program run references.',
    false,
    { id, ...page },
    ['id'],
  ),
];
