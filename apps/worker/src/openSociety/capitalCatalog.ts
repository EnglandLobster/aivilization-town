import { tool, text, integer, choice, page } from './capabilitySchema';
const enterpriseId = text('Actual enterprise ID', 96),
  id = text('Immutable capital agreement ID', 96),
  expectedRevision = integer('Exact observed agreement revision');
export const CAPITAL_TOOLS = [
  tool(
    'capital.close',
    'Current manager closes a capital-enabled company only after actual inventory disposal and all protected obligations and pending funding are settled. Residual cash goes to real current right holders; no valuation cash is invented.',
    true,
    {
      enterpriseId,
      expectedEquityVersion: integer('Current capital version'),
      expectedControlVersion: integer('Current management version'),
    },
  ),
  tool(
    'capital.list',
    'List enterprises whose management, actual capital rights or agreements are visible to you. Holding rights does not grant management.',
    false,
    { ...page },
    [],
  ),
  tool(
    'capital.rights',
    'Read paged current capital rights and original source; full company cash is only visible to actual management.',
    false,
    { enterpriseId, ...page },
    ['enterpriseId'],
  ),
  tool(
    'capital.agreements',
    'List visible capital agreements for the enterprise. Proposed rights are not effective rights.',
    false,
    { enterpriseId, ...page },
    ['enterpriseId'],
  ),
  tool(
    'capital.read',
    'Read the exact capital agreement, independent consents, held contributions and executable disposition. No participation is inferred.',
    false,
    { enterpriseId, id },
  ),
  tool(
    'capital.initialize',
    'Current manager explicitly enables the capital ledger, preserving every inherited right. Does not transfer money, rights, employment or management.',
    true,
    { enterpriseId },
  ),
  tool(
    'capital.propose',
    'Freeze proposed rights, actual contributions and destinations. All existing and new holders and payers independently accept; company receipts additionally require current management authorization.',
    true,
    {
      enterpriseId,
      id,
      expectedEquityVersion: integer('Current capital version'),
      expiresAt: integer('Absolute simulation deadline'),
      terms: text('Your original terms', 4000),
      allocation: {
        type: 'object',
        description:
          'Exact JSON: positions:[{account:{sector:agent|collective,id},weight}], contributions:[{account:{sector:agent|collective,id},amount}], disbursements:[{account:{sector:agent|collective,id}|{sector:enterprise},amount}]. Amounts in currency, up to six decimal places; totals must balance. Weight is relative capital entitlement, not a management vote.',
      },
    },
  ),
  tool(
    'capital.accept',
    'Independently accept frozen terms for your account; your promised contribution moves to real escrow now. Collective accounts require a separately approved collective resource action.',
    true,
    {
      enterpriseId,
      id,
      expectedRevision,
      accountSector: choice(['agent', 'collective']),
      accountId: text('Actual rights/payer account ID', 96),
    },
  ),
  tool(
    'capital.authorize',
    'Current enterprise manager authorizes receiving the exact new company capital under the current management version. This is not shareholder consent.',
    true,
    {
      enterpriseId,
      id,
      expectedRevision,
      expectedControlVersion: integer('Current enterprise management version'),
    },
  ),
  tool(
    'capital.execute',
    'A participating account controller executes once all independent consents, funding and current management conditions hold. Actual cash and rights commit atomically.',
    true,
    { enterpriseId, id, expectedRevision },
  ),
  tool(
    'capital.cancel',
    'The proposer or a participating account controller withdraws an unfinished agreement; escrow refunds original real payer accounts. Executed rights cannot be erased.',
    true,
    { enterpriseId, id, expectedRevision },
  ),
];
