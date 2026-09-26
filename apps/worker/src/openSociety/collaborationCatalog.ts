import { tool, text, integer, strings, choice, page } from './capabilitySchema';
const id = text('Proposal ID', 96),
  expectedRevision = integer('Current proposal revision'),
  terms = text('Original terms'),
  expiresAt = integer('Future simulation timestamp');
export const COLLABORATION_TOOLS = [
  tool(
    'proposals.create',
    'Propose exact terms; only you consent initially. List other participants.',
    true,
    { id, participants: strings, terms, expiresAt },
  ),
  tool('proposals.revise', 'Revise your open proposal and reset other consents.', true, {
    id,
    expectedRevision,
    terms,
    expiresAt,
  }),
  tool('proposals.respond', 'Personally accept or reject this precise current revision.', true, {
    id,
    expectedRevision,
    accept: { type: 'boolean' },
  }),
  tool('proposals.withdraw', 'Withdraw your open proposal.', true, { id, expectedRevision }),
  ...['proposals', 'commitments'].flatMap((group) => [
    tool(
      `${group}.list`,
      'List your proposals or accepted multi-party commitments as metadata.',
      false,
      { ...page },
      [],
    ),
    tool(
      `${group}.read`,
      'Read exact terms and separately attributed fulfillment/dispute statements.',
      false,
      { id },
    ),
  ]),
  tool(
    'proposals.history',
    'Read immutable original revisions that you participate in.',
    false,
    { id, ...page },
    ['id'],
  ),
  tool(
    'commitments.declare',
    'Record your own fulfillment/dispute/release claim; does not prove fulfillment or debit money.',
    true,
    {
      id,
      kind: choice(['fulfilled', 'disputed', 'released']),
      content: text('Your original statement'),
    },
  ),
];
