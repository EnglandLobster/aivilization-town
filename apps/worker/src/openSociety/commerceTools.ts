import type { CommerceCommand } from '@aivilization/commerce';
import { residentCommerceEvent } from '@aivilization/world';
import { stringArg, stringArrayArg, numberArg, pageItems, ToolRefusal } from './arguments';
import { applyOpenSocietyEffects } from './state';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { digest } from './journal';
export function executeCommerceTool(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const s = state.world.residentCommerce;
  if (!s) throw new ToolRefusal('commerce-not-enabled');
  const id = stringArg(args, 'id'),
    expectedRevision = numberArg(args, 'expectedRevision');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  const [group, operation] = name.split('.');
  if (operation === 'list' || operation === 'read') {
    const records =
      group === 'offers'
        ? Object.values(s.offers)
        : group === 'orders'
          ? Object.values(s.orders).filter((o) => o.buyerId === actorId || o.sellerId === actorId)
          : group === 'payments'
            ? Object.values(s.requests).filter(
                (r) => r.requesterId === actorId || r.payers.includes(actorId),
              )
            : Object.values(s.deposits).filter(
                (d) => d.payerId === actorId || d.beneficiaryId === actorId,
              );
    if (operation === 'list')
      return result(
        pageItems(
          records.filter((r) => !('active' in r) || r.active),
          args,
        ),
      );
    const data = records.find((r) => r.id === id);
    if (!data) throw new ToolRefusal('record-not-found');
    return result(data);
  }
  let c: CommerceCommand;
  switch (name) {
    case 'offers.publish':
      c = {
        type: name,
        id,
        kind: stringArg(args, 'kind') as 'goods' | 'service',
        ...(args.deliveryMode === undefined
          ? {}
          : { deliveryMode: stringArg(args, 'deliveryMode') as 'in-person' | 'remote' }),
        commodity: stringArg(args, 'commodity'),
        description: stringArg(args, 'description'),
        unitPrice: numberArg(args, 'unitPrice'),
        maxQuantity: numberArg(args, 'maxQuantity'),
      };
      break;
    case 'offers.withdraw':
      c = { type: name, id, expectedRevision };
      break;
    case 'orders.create':
      c = {
        type: name,
        id,
        offerId: stringArg(args, 'offerId'),
        offerRevision: numberArg(args, 'offerRevision'),
        quantity: numberArg(args, 'quantity'),
      };
      break;
    case 'orders.accept':
    case 'orders.pay':
    case 'orders.deliver':
    case 'orders.confirm':
    case 'orders.cancel':
    case 'orders.dispute':
    case 'orders.refund':
    case 'orders.propose-settlement':
    case 'orders.respond-settlement':
      c = {
        type: name,
        id,
        expectedRevision,
        ...(args.content === undefined ? {} : { content: stringArg(args, 'content') }),
        ...(args.amount === undefined ? {} : { amount: numberArg(args, 'amount') }),
        ...(args.accept === undefined ? {} : { accept: args.accept === true }),
      };
      break;
    case 'payments.transfer':
      c = {
        type: name,
        targetId: stringArg(args, 'targetId'),
        amount: numberArg(args, 'amount'),
        note: stringArg(args, 'note'),
      };
      break;
    case 'payments.request':
      c = {
        type: name,
        id,
        payers: stringArrayArg(args, 'payers'),
        amountEach: numberArg(args, 'amountEach'),
        description: stringArg(args, 'description'),
      };
      break;
    case 'payments.pay':
    case 'payments.cancel':
    case 'deposits.release':
    case 'deposits.settle':
      c = { type: name, id, expectedRevision };
      break;
    case 'deposits.lock':
      c = {
        type: name,
        id,
        beneficiaryId: stringArg(args, 'beneficiaryId'),
        amount: numberArg(args, 'amount'),
        purpose: stringArg(args, 'purpose'),
      };
      break;
    default:
      throw new ToolRefusal('unknown-commerce-command');
  }
  const d = residentCommerceEvent({
    projection: state.world,
    actorId,
    command: c,
    requestId: `commerce-${digest([actorId, requestId]).slice(0, 32)}`,
    simulationId: manifest.simulationId,
    nextSequence: state.worldSequence + 1,
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  const after = applyOpenSocietyEffects(state, { worldEvents: d.events }).world.residentCommerce!;
  const data =
    group === 'offers'
      ? after.offers[id]
      : group === 'orders'
        ? after.orders[id]
        : group === 'deposits'
          ? after.deposits[id]
          : name === 'payments.transfer'
            ? { transferred: true, amount: args.amount, to: args.targetId }
            : after.requests[id];
  return { data, effects: { worldEvents: d.events } };
}
