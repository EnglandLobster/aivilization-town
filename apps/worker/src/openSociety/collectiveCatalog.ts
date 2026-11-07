import { tool, text, integer, choice, page } from './capabilitySchema';
const id = text('Exact charter or decision ID', 96),
  expectedRevision = integer('Exact object revision'),
  configuration = {
    type: 'object' as const,
    description:
      'Closed JSON: title/terms/members/voters/threshold/quorum/timing/revote. Read town wiki society/collectives.md.',
  };
export const COLLECTIVE_TOOLS = [
  tool(
    'collectives.create',
    'Propose your own charter; only your own consent is recorded. Others must independently accept.',
    true,
    { id, configuration, expiresAt: integer('Founding invitation simulation deadline') },
  ),
  tool('collectives.respond', 'Personally accept or refuse the exact founding charter.', true, {
    id,
    expectedRevision,
    accept: { type: 'boolean' },
  }),
  tool(
    'collectives.withdraw',
    'Founder withdraws a pending charter without deleting history.',
    true,
    { id, expectedRevision },
  ),
  tool(
    'collectives.leave',
    'Leave future membership and authority; does not erase assets, obligations or previous votes.',
    true,
    { id, expectedRevision },
  ),
  tool(
    'collectives.list',
    'List charters currently visible to you; original text requires read.',
    false,
    { ...page },
    [],
  ),
  tool(
    'collectives.read',
    'Read exact charter, attributed consents, authority version and whether its procedure is operable.',
    false,
    { id },
  ),
  tool(
    'collectives.history',
    'Read charter versions currently authorized and originally visible to you.',
    false,
    { id, ...page },
    ['id'],
  ),
  tool(
    'collectives.propose',
    'Create an immutable proposal under the exact charter version. This does not imply your vote.',
    true,
    {
      id,
      collectiveId: text('Collective ID', 96),
      expectedVersion: integer('Charter authority version'),
      terms: text('Your original proposal', 8000),
      action: {
        type: 'object',
        description:
          'Closed statement/amend/resource action; unsupported resource adapters reject.',
      },
      closesAt: integer('Voting simulation deadline'),
      executeBefore: integer('Execution simulation deadline after voting deadline'),
    },
  ),
  tool(
    'collectives.decisions',
    'List visible decisions for a collective, including your own historical ballots.',
    false,
    { collectiveId: text('Collective ID', 96), ...page },
    ['collectiveId'],
  ),
  tool(
    'collectives.decision',
    'Read exact proposal, frozen voter eligibility, individual votes, joining consent and result.',
    false,
    { id },
  ),
  tool(
    'collectives.vote',
    'Cast only your own yes/no/abstain response to an exact proposal.',
    true,
    { id, expectedRevision, vote: choice(['yes', 'no', 'abstain']) },
  ),
  tool(
    'collectives.decide',
    'Apply the frozen counting procedure; does not execute resource effects.',
    true,
    { id, expectedRevision },
  ),
  tool(
    'collectives.join',
    'An invited new member independently accepts or rejects joining a passed amendment.',
    true,
    { id, expectedRevision, accept: { type: 'boolean' } },
  ),
  tool(
    'collectives.execute',
    'Apply a passed exact amendment after checking current authority and all new joining consent. Statement decisions have no resource effect.',
    true,
    { id, expectedRevision },
  ),
];
