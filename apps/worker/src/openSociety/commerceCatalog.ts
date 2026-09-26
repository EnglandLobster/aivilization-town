import { tool, text, integer, number, choice, strings, page } from './capabilitySchema';
const id = text('Record ID', 96),
  expectedRevision = integer('Current revision'),
  amount = number('Positive currency amount', 0.000001);
export const COMMERCE_TOOLS = [
  tool(
    'offers.publish',
    'Publish a goods or subjective-service offer. No inventory or currency is created.',
    true,
    {
      id,
      kind: choice(['goods', 'service']),
      deliveryMode: choice(['in-person', 'remote']),
      commodity: text('Existing tradable commodity; use service for services', 96),
      description: text('Exact original terms'),
      unitPrice: amount,
      maxQuantity: { ...integer('Maximum units per order', 1000000), minimum: 1 },
    },
    ['id', 'kind', 'commodity', 'description', 'unitPrice', 'maxQuantity'],
  ),
  tool('offers.withdraw', 'Withdraw your listing; existing accepted orders remain binding.', true, {
    id,
    expectedRevision,
  }),
  tool('offers.list', 'Browse active original offers.', false, { ...page }, []),
  tool('offers.read', 'Read a public offer.', false, { id }),
  tool(
    'orders.create',
    'Request an order against a fixed offer version; seller must accept.',
    true,
    {
      id,
      offerId: text('Offer ID', 96),
      offerRevision: integer('Offer revision'),
      quantity: { ...integer('Units', 1000000), minimum: 1 },
    },
  ),
  ...['accept', 'pay', 'confirm', 'cancel'].map((op) =>
    tool(
      `orders.${op}`,
      'Act on your order. Seller accepts and reserves goods; buyer pays into escrow and confirms release. Cancellation before delivery returns escrow.',
      true,
      { id, expectedRevision },
    ),
  ),
  tool(
    'orders.deliver',
    'Deliver at a shared real location while both participants are idle. Service completion is a claim until buyer confirms.',
    true,
    { id, expectedRevision, content: text('Delivery statement') },
  ),
  tool('orders.dispute', 'Record your exact dispute and suspend confirmation.', true, {
    id,
    expectedRevision,
    content: text('Dispute statement'),
  }),
  tool('orders.refund', 'Seller authorizes a refund no greater than remaining paid amount.', true, {
    id,
    expectedRevision,
    amount,
  }),
  tool(
    'orders.propose-settlement',
    'Propose a split of remaining escrow: amount refunded to buyer, remainder paid to seller. Undelivered held goods return to seller; delivered goods stay with buyer. Counterparty must consent. No automatic verdict.',
    true,
    {
      id,
      expectedRevision,
      amount: number('Refund from remaining escrow, including zero'),
      content: text('Exact agreement terms'),
    },
  ),
  tool(
    'orders.respond-settlement',
    'Accept the exact current settlement proposed by the other participant, or decline/withdraw it. A stale proposal cannot move funds.',
    true,
    { id, expectedRevision, accept: { type: 'boolean' } },
  ),
  ...['orders', 'payments', 'deposits'].flatMap((group) => [
    tool(`${group}.list`, 'List only records you participate in.', false, { ...page }, []),
    tool(`${group}.read`, 'Read your record and current revision.', false, { id }),
  ]),
  tool(
    'payments.transfer',
    'Transfer your own money to another resident with balanced accounting.',
    true,
    { targetId: text('Recipient ID', 96), amount, note: text('Original transfer note') },
  ),
  tool(
    'payments.request',
    'Request equal amounts from listed payers. Each pays independently; no automatic deductions.',
    true,
    { id, payers: strings, amountEach: amount, description: text('Payment purpose') },
  ),
  ...['pay', 'cancel'].map((op) =>
    tool(
      `payments.${op}`,
      'Pay your share or cancel your own request. Already paid shares are not undone.',
      true,
      { id, expectedRevision },
    ),
  ),
  tool('deposits.lock', 'Voluntarily lock your money in escrow for a named beneficiary.', true, {
    id,
    beneficiaryId: text('Beneficiary ID', 96),
    amount,
    purpose: text('Deposit purpose'),
  }),
  tool('deposits.release', 'Beneficiary returns a held deposit to its payer.', true, {
    id,
    expectedRevision,
  }),
  tool(
    'deposits.settle',
    'Payer authorizes payment of the held deposit to its beneficiary.',
    true,
    { id, expectedRevision },
  ),
];
