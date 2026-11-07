import type { EvidenceTradeCommand } from '@aivilization/commerce';
import { stringArg, numberArg, booleanArg, ToolRefusal } from './arguments';
import { exactPremisesArgs } from './premisesCommands';
export function parseEvidenceTradeCommand(
  name: string,
  a: Readonly<Record<string, unknown>>,
): EvidenceTradeCommand {
  if (name === 'trades.offer') {
    exactPremisesArgs(a, [
      'id',
      'sourceKind',
      'sourceId',
      'sourceRevision',
      'payerSector',
      'payerId',
      'revenueSector',
      'revenueId',
      'amount',
      'acceptBy',
      'title',
      'terms',
    ]);
    if (
      (a.sourceKind !== 'freight' && a.sourceKind !== 'service' && a.sourceKind !== 'permit') ||
      (a.payerSector !== 'agent' &&
        a.payerSector !== 'collective' &&
        a.payerSector !== 'treasury') ||
      (a.payerSector === 'treasury' && a.payerId !== 'public-treasury') ||
      (a.revenueSector !== 'agent' && a.revenueSector !== 'collective')
    )
      throw new ToolRefusal('invalid-trade-source-or-account');
    return {
      type: 'offer',
      id: stringArg(a, 'id'),
      source: {
        kind: a.sourceKind,
        id: stringArg(a, 'sourceId'),
        expectedRevision: numberArg(a, 'sourceRevision'),
      },
      payer:
        a.payerSector === 'treasury'
          ? { sector: 'treasury', id: 'public-treasury' }
          : { sector: a.payerSector, id: stringArg(a, 'payerId') },
      revenue: { sector: a.revenueSector, id: stringArg(a, 'revenueId') },
      amount: numberArg(a, 'amount'),
      acceptBy: numberArg(a, 'acceptBy'),
      title: stringArg(a, 'title'),
      terms: stringArg(a, 'terms'),
    };
  }
  const type = name.slice('trades.'.length);
  const base = { id: stringArg(a, 'id'), expectedRevision: numberArg(a, 'expectedRevision') };
  if (type === 'dispute') {
    exactPremisesArgs(a, ['id', 'expectedRevision', 'content']);
    return { type, ...base, content: stringArg(a, 'content') };
  }
  if (type === 'propose-settlement') {
    exactPremisesArgs(a, ['id', 'expectedRevision', 'content', 'refund']);
    return { type, ...base, content: stringArg(a, 'content'), refund: numberArg(a, 'refund') };
  }
  if (type === 'respond-settlement') {
    exactPremisesArgs(a, ['id', 'expectedRevision', 'accept']);
    return { type, ...base, accept: booleanArg(a, 'accept') };
  }
  if (!['accept', 'withdraw', 'observe', 'confirm', 'waive'].includes(type))
    throw new ToolRefusal('unsupported-trade-command');
  exactPremisesArgs(a, ['id', 'expectedRevision']);
  // The closed dispatch above guarantees this union, rather than trusting a resident-provided type.
  return { type: type as 'accept' | 'withdraw' | 'observe' | 'confirm' | 'waive', ...base };
}
