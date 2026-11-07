import { tool, text, integer, choice, page } from './capabilitySchema';
const id = text('Public proposal or objection ID', 160),
  expectedRevision = integer('Exact observed proposal revision');
export const PUBLIC_GOVERNANCE_TOOLS = [
  tool(
    'governance.housing',
    'Read current or historical public housing tariffs and upgrade eligibility. Standards are paginated: read all before proposing complete terms. Private rent and physical premises remain separate.',
    false,
    { revision: integer('Optional historical policy revision'), ...page },
    [],
  ),
  tool(
    'governance.employment',
    'Read the current or specified public employment revision: exact admission requirements, quotas, ranking and capacities. Occupations are paginated; inspect all pages before proposing complete terms. Use section=applications for your own application status, outcomes and history; do not combine it with revision.',
    false,
    {
      revision: integer('Optional historical policy revision; rules section only'),
      section: choice(['rules', 'applications']),
      ...page,
    },
    [],
  ),
  tool(
    'governance.status',
    'Read the explicit public grant, current procedure, fiscal limits and actual enacted policies. This initial institution is not a claim of unanimous consent.',
    false,
    {},
    [],
  ),
  tool(
    'governance.list',
    'Browse public proposals. Approval is a procedural fact, not correctness or permission to substitute terms.',
    false,
    { ...page },
    [],
  ),
  tool(
    'governance.read',
    'Read original proposal text, exact action and frozen voting procedure. Read votes separately.',
    false,
    { id },
  ),
  tool(
    'governance.votes',
    'Read independently attributed current ballots for a proposal. Earlier changes remain in durable history.',
    false,
    { id, ...page },
    ['id'],
  ),
  tool(
    'governance.objections',
    'Read original objections. An objection alone does not suspend or reverse policy.',
    false,
    { id, ...page },
    ['id'],
  ),
  tool(
    'governance.propose',
    'Propose exact set-tax/set-budget/set-subsidy/set-procedure terms and expectedRevision, invalidate-decision with proposalId/expectedRevision/reason, enabled set-housing with complete terms from governance housing, or enabled set-employment with complete terms from governance employment. Read governance status for scope; residents cannot create public jurisdiction.',
    true,
    {
      id,
      text: text('Your original reason', 4000),
      action: {
        type: 'object',
        description:
          'Exact action JSON: kind, expectedRevision, terms; invalidation uses proposalId/reason; fund-service uses engagementId/maximumCharge; fund-goods uses orderId/amount. No actor, authority, source or formula fields.',
      },
      closesAt: integer('Absolute simulation voting deadline'),
      expectedProcedureRevision: integer('Current public procedure revision'),
    },
  ),
  tool(
    'governance.vote',
    'Personally cast yes/no/abstain on the exact frozen proposal. No implied or delegated votes.',
    true,
    { id, expectedRevision, choice: choice(['yes', 'no', 'abstain']) },
  ),
  tool(
    'governance.close',
    'After the deadline, record the mechanical result under the frozen procedure. This does not enact policy.',
    true,
    { id, expectedRevision },
  ),
  tool(
    'governance.withdraw',
    'The author may abandon a proposal before voting closes; originals and ballots remain recorded.',
    true,
    { id, expectedRevision },
  ),
  tool(
    'governance.execute',
    'Execute the exact approved action once under its current scope, revision and time window. Real effects and authorization consumption commit atomically.',
    true,
    { id, expectedRevision },
  ),
  tool(
    'governance.object',
    'Record your original objection to a proposal. To invalidate an unused decision, separately propose that exact remedy and obtain approval.',
    true,
    {
      id,
      proposalId: text('Proposal being challenged', 160),
      text: text('Your attributed objection', 4000),
    },
  ),
];
