import { expect, test } from 'vitest';
import { constructionTradeRequest, type ConstructionTradeCommand } from '@aivilization/commerce';
import { decodeConstructionTradeOperation } from './constructionTradeCommandCodec';
const commands: readonly ConstructionTradeCommand[] = [
  {
    type: 'offer',
    terms: {
      id: 'order',
      projectId: 'project',
      sourceRevision: 2,
      seller: { kind: 'enterprise', id: 'firm' },
      buyer: { kind: 'public', id: 'town' },
      payer: { sector: 'treasury', id: 'public-treasury' },
      revenue: { sector: 'enterprise', id: 'firm' },
      amount: 0.000001,
      acceptBy: 100,
      title: '原文',
      terms: '原文承诺',
    },
  },
  ...(['accept', 'observe', 'withdraw'] as const).map((type) => ({
    type,
    id: 'order',
    expectedRevision: 3,
    side: 'buyer' as const,
  })),
  {
    type: 'propose-settlement',
    id: 'order',
    expectedRevision: 4,
    side: 'seller',
    proposalId: 'split',
    paySeller: 0,
    text: '原文分款',
  },
  {
    type: 'accept-settlement',
    id: 'order',
    expectedRevision: 5,
    side: 'buyer',
    proposalId: 'split',
  },
];
test('all construction operations round trip exact original authorization; no actor or unknown fields are discarded', () => {
  for (const c of commands) {
    const r = constructionTradeRequest(c);
    expect(decodeConstructionTradeOperation(r)).toEqual(c);
    for (const bad of [
      { ...r, resourceId: 'other' },
      { ...r, resourceRevision: r.resourceRevision + 1 },
      { ...r, controlVersion: 2 },
      { ...r, resourceKind: 'stock' },
      { ...r, operation: { ...r.operation, capability: 'construction-trades.start' } },
      {
        ...r,
        operation: { ...r.operation, arguments: { ...r.operation.arguments, actorId: 'other' } },
      },
    ])
      expect(() => decodeConstructionTradeOperation(bad)).toThrow();
  }
});
test('malformed numbers, terms, accounts, principals and side cannot cross the operation envelope', () => {
  const offer = constructionTradeRequest(commands[0]!);
  const terms = commands[0]!.type === 'offer' ? commands[0]!.terms : undefined;
  if (!terms) throw Error('fixture');
  for (const t of [
    { ...terms, amount: Infinity },
    { ...terms, sourceRevision: 1.5 },
    { ...terms, acceptBy: -1 },
    { ...terms, buyer: { kind: 'system', id: 'town' } },
    { ...terms, payer: { sector: 'mint', id: 'public-treasury' } },
    { ...terms, payer: { ...terms.payer, actorId: 'a' } },
    { ...terms, extra: 'ignored' },
  ])
    expect(() =>
      decodeConstructionTradeOperation({
        ...offer,
        operation: { ...offer.operation, arguments: { type: 'offer', terms: t } },
      }),
    ).toThrow();
  const accept = constructionTradeRequest(commands[1]!);
  expect(() =>
    decodeConstructionTradeOperation({
      ...accept,
      operation: {
        ...accept.operation,
        arguments: { ...accept.operation.arguments, side: 'anyone' },
      },
    }),
  ).toThrow();
});
