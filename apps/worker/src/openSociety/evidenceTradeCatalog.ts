import { tool, text, integer, number, choice, page } from './capabilitySchema';
const id = text('Exact evidence order ID', 60),
  expectedRevision = integer('Current order revision');
export const EVIDENCE_TRADE_TOOLS = [
  tool(
    'trades.rules',
    'Read real fulfillment, independent acceptance, escrow and dispute rules.',
    false,
    {},
    [],
  ),
  tool(
    'trades.list',
    'List orders visible to your current personal or collective authority.',
    false,
    { ...page },
    [],
  ),
  tool(
    'trades.read',
    'Read original terms, real source facts and exact accounting; delivered never implies satisfaction.',
    false,
    { id },
  ),
  tool(
    'trades.ledger',
    'Read authenticated original statements and financial receipts.',
    false,
    { id, ...page },
    ['id'],
  ),
  tool(
    'trades.offer',
    'Offer a priced order for one unstarted freight, unpriced service or offered permission; the buyer must independently accept. Treasury freight contracts and fulfillment become public; funding requires governance fund-goods approval and does not create public ownership.',
    true,
    {
      id,
      sourceKind: choice(['freight', 'service', 'permit']),
      sourceId: text('Exact existing physical process ID', 96),
      sourceRevision: integer(
        'Current source revision from trades read or original unstarted source',
      ),
      payerSector: choice(['agent', 'collective', 'treasury']),
      payerId: text(
        'Buyer-controlled account, or public-treasury for explicitly enabled public freight procurement',
        96,
      ),
      revenueSector: choice(['agent', 'collective']),
      revenueId: text('Seller-controlled revenue account', 96),
      amount: number('Total price, at most six decimal places'),
      acceptBy: integer('Simulation acceptance deadline'),
      title: text('Original title', 120),
      terms: text('Original price and fulfillment terms', 8000),
    },
  ),
  ...(['accept', 'withdraw', 'observe', 'confirm', 'waive'] as const).map((op) =>
    tool(
      `trades.${op}`,
      {
        accept:
          'Buyer independently accepts immutable terms. Private funds escrow now; treasury freight awaits governance fund-goods approval before fulfillment.',
        withdraw:
          'A party withdraws an unfunded order. Funded orders await actual source cancellation or return.',
        observe:
          'Read owning-domain terminal evidence; reserve earned payment and return the unperformed amount. Cannot fabricate delivery.',
        confirm:
          'Buyer confirms the recorded fulfillment and releases remaining escrow to the agreed seller account.',
        waive:
          'Seller waives the remaining earned payment after actual fulfillment. This does not reverse delivered goods or bodily effects.',
      }[op],
      true,
      { id, expectedRevision },
    ),
  ),
  tool(
    'trades.dispute',
    'Record your original dispute and hold payment without inventing an objective quality judgment.',
    true,
    { id, expectedRevision, content: text('Your original statement', 8000) },
  ),
  tool(
    'trades.propose-settlement',
    'Propose an exact refund from remaining escrow after source resolution; counterparty consent is required.',
    true,
    {
      id,
      expectedRevision,
      content: text('Original settlement terms', 8000),
      refund: number('Refund amount from remaining escrow'),
    },
  ),
  tool(
    'trades.respond-settlement',
    'Independently accept or decline the other party current versioned settlement.',
    true,
    {
      id,
      expectedRevision,
      accept: { type: 'boolean', description: 'Independent acceptance or rejection' },
    },
  ),
];
