import {
  resourceSaleRequest,
  tradeFactsEqual,
  type ResourceSaleCommand,
  type ResourceSaleKind,
} from '@aivilization/commerce';
import { worldResourceSaleSource } from '@aivilization/world';
import type { OpenSocietyState } from './types';
import type { ToolExecution } from './informationTools';
import { principalVisibleTo } from './resourceControlAccess';
import { stringArg, ToolRefusal } from './arguments';
/** On-demand exact contract expansion only; never injected into every resident context. */
export function readResourceSale(
  s: OpenSocietyState,
  actorId: string,
  args: Record<string, unknown>,
): ToolExecution {
  const state = s.world.resourceSales,
    id = stringArg(args, 'id'),
    sale = state?.sales[id];
  if (!state) throw new ToolRefusal('resource-sales-not-enabled');
  if (
    !sale ||
    !(
      principalVisibleTo(s, sale.source.seller, actorId) ||
      principalVisibleTo(s, sale.source.offer.target, actorId)
    )
  )
    throw new ToolRefusal('resource-sale-not-readable');
  const source = worldResourceSaleSource(s.world, sale.source.id, sale.source.kind),
    operations =
      sale.status === 'offered'
        ? Object.fromEntries(
            (['accept', 'withdraw', 'decline'] as const).map((type) => {
              const command: ResourceSaleCommand = { type, id, expectedRevision: sale.revision };
              return [type, resourceSaleRequest(state, command, source)];
            }),
          )
        : {};
  return {
    data: {
      kind: 'resource-sale',
      sale,
      policy: state.policy,
      operations,
      sourceMatchesQuote: tradeFactsEqual(source ?? null, sale.source),
      operateWith: 'town principals operate --request <exact operation>',
      independentWith:
        'collectives propose/vote/decide/execute or governance propose/vote/close/execute; resource action requires this whole exact request',
      limitation:
        'Money, actual control and old obligations are distinct from bodily consent, movement or private contract access.',
    },
    effects: {},
  };
}
export function resourceSaleEntry(
  s: OpenSocietyState,
  id: string,
  kind: ResourceSaleKind,
  actorId: string,
) {
  const source = worldResourceSaleSource(s.world, id, kind);
  if (
    !s.world.resourceSales ||
    !source ||
    !(
      principalVisibleTo(s, source.seller, actorId) ||
      principalVisibleTo(s, source.offer.target, actorId)
    ) ||
    !s.world.resourceSales.policy.resourceKinds.some((k) => k === kind)
  )
    return {};
  return {
    resourceSalesPolicy: s.world.resourceSales.policy,
    resourceSaleOfferSource: source,
    resourceSaleOfferBase: {
      resourceKind: 'resource-sale',
      resourceId: 'NEW_SALE_ID',
      resourceRevision: 1,
      controlVersion: source.controlVersion,
    },
    resourceSaleOfferWith: `principals operate: operation {capability:resource-sales.offer, arguments:{command:{type:offer,id,title,terms,resource:{kind:${kind},id,expectedRevision},payer:{sector,id},revenue:{sector,id},amount,acceptBy:original control offer expiry},source:resourceSaleOfferSource}}. After offering, principals read --kind resource-sale --id ID for exact accept/withdraw/decline.`,
  };
}
