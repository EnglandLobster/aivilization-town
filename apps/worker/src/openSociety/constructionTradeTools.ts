import { decodeConstructionTradeOperation } from '@aivilization/world';
import { enterpriseController } from '@aivilization/enterprise';
import type { PrincipalOperationRequest } from '@aivilization/authority';
import type { ConstructionTradeCommand, ConstructionTradeOrder } from '@aivilization/commerce';
import type { OpenSocietyState } from './types';
import { principalVisibleTo, constructionVisibleTo } from './resourceControlAccess';
import { ToolRefusal } from './arguments';
const visible = (s: OpenSocietyState, o: ConstructionTradeOrder, actorId: string) =>
  principalVisibleTo(s, o.seller, actorId) || principalVisibleTo(s, o.buyer, actorId);
export function constructionOrderMetadata(s: OpenSocietyState, actorId: string) {
  return Object.values(s.world.residentTrade?.constructionOrders?.orders ?? {})
    .filter((o) => visible(s, o, actorId))
    .map((o) => ({
      kind: 'construction-order',
      id: o.id,
      title: o.title,
      status: o.status,
      revision: o.revision,
      controlVersion: 1,
    }));
}
export function readConstructionOrder(s: OpenSocietyState, actorId: string, id: string) {
  const state = s.world.residentTrade?.constructionOrders,
    order = state?.orders[id];
  if (!state) throw new ToolRefusal('construction-trade-not-enabled');
  if (!order || !visible(s, order, actorId))
    throw new ToolRefusal('construction-order-not-readable');
  return {
    data: {
      kind: 'construction-order',
      order,
      policy: state.policy,
      requestBase: {
        resourceKind: 'construction-order',
        resourceId: id,
        resourceRevision: order.revision,
        controlVersion: 1,
      },
      operations: [
        'construction-trades.accept',
        'construction-trades.observe',
        'construction-trades.withdraw',
        'construction-trades.propose-settlement',
        'construction-trades.accept-settlement',
      ],
      executeWith: 'town principals operate --request JSON',
      collectiveWith: 'town collectives propose',
      publicWith: 'town governance propose',
      limitation:
        'A funded order preserves escrow and physical obligations. Its text does not create work or subjective satisfaction. Each side requires independent exact authority.',
    },
    effects: {},
  };
}
export function constructionTradeCollectiveFailure(
  s: OpenSocietyState,
  collectiveId: string,
  request: PrincipalOperationRequest,
) {
  const state = s.world.residentTrade?.constructionOrders;
  if (!state) return 'construction-trade-not-enabled';
  const c = decodeConstructionTradeOperation(request),
    order = c.type === 'offer' ? undefined : state.orders[c.id];
  if (c.type !== 'offer' && (!order || order.revision !== c.expectedRevision))
    return 'construction-trade-order-revision-conflict';
  const subject = c.type === 'offer' ? c.terms.seller : order![c.side];
  if (subject.kind === 'collective' && subject.id === collectiveId) return;
  const enterprise = subject.kind === 'enterprise' ? s.world.enterprises[subject.id] : undefined;
  const control = enterprise && enterpriseController(enterprise);
  return control?.kind === 'collective' && control.id === collectiveId
    ? undefined
    : 'collective-principal-authority-required';
}

/** An offer must not become a second query path around the current construction ACL. */
export function assertConstructionOfferReadable(
  s: OpenSocietyState,
  actorId: string,
  command: ConstructionTradeCommand,
) {
  if (command.type !== 'offer') return;
  const p = s.world.premises?.projects[command.terms.projectId];
  if (!p || !constructionVisibleTo(s, p, actorId))
    throw new ToolRefusal('construction-not-readable');
}
