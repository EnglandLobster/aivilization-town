import {
  decidePrincipalPremisesRights,
  applyPrincipalPremisesRightsEvent,
  startPremisesProvision,
  applyPremisesProvisionEvent,
  type PrincipalPremisesRightsEvent,
  type PremisesProvisionEvent,
} from '@aivilization/premises';
import { tradeFactsEqual, type PrincipalTradeEvent } from '@aivilization/commerce';
import { samePrincipal, samePrincipalRequest } from '@aivilization/authority';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import type { PublicPrincipalExecution } from './resourcePrincipalAuthority';
import { principalPremisesRightsPorts } from './principalPremisesRights';
export type PrincipalPaidPermitEffects = {
  readonly acceptance: Extract<
    PrincipalPremisesRightsEvent,
    { type: 'PrincipalPremisesPermitTradeAccepted' }
  >;
  readonly provision: Extract<PremisesProvisionEvent, { type: 'PremisesProvisionStarted' }>;
};
export function preparePrincipalPaidPermitEffects(
  w: WorldProjection,
  event: PrincipalTradeEvent,
  collective?: PrincipalCollectivePort,
  execution?: PublicPrincipalExecution,
) {
  if (event.type !== 'PrincipalTradeCommitted' || event.receipt.operation !== 'accept')
    return undefined;
  const { order, receipt } = event,
    state = w.premisesRights,
    p = state?.permits[order.source.id];
  if (!state || !p || !w.residentTrade?.principalOrders || order.status !== 'funded')
    throw Error('principal-paid-permit-domains-required');
  const rights = decidePrincipalPremisesRights(
    state,
    receipt.actorId,
    w.clock.now,
    { type: 'accept', id: p.id, revision: p.revision },
    {
      ...principalPremisesRightsPorts(w, receipt.actorId, collective, execution),
      // The parent proof has already been checked against the pre-event authority.
      // Reuse it for its explicitly bound child, without searching for another vote.
      authorize: (principal, request) =>
        receipt.authorization &&
        samePrincipal(receipt.authorization.principal, principal) &&
        samePrincipalRequest(receipt.authorization.request, request)
          ? receipt.authorization
          : undefined,
    },
    { orderId: order.id, orderRevision: receipt.previousRevision },
  );
  if (!rights.accepted) throw Error(rights.reason);
  const acceptance = rights.events[0];
  if (
    rights.events.length !== 1 ||
    acceptance?.type !== 'PrincipalPremisesPermitTradeAccepted' ||
    !tradeFactsEqual(acceptance.authorization, order.acceptedAuthorization)
  )
    throw Error('principal-paid-permit-parent-authority-mismatch');
  const after = applyPrincipalPremisesRightsEvent(state, acceptance),
    d = startPremisesProvision(after, p.id, order.id, receipt.actorId, w.clock.now);
  if (!d.accepted) throw Error(d.reason);
  const provision = d.events[0];
  if (d.events.length !== 1 || provision?.type !== 'PremisesProvisionStarted')
    throw Error('principal-paid-permit-provision-required');
  return { acceptance, provision } satisfies PrincipalPaidPermitEffects;
}
export function applyPrincipalPaidPermitEffects(
  w: WorldProjection,
  event: PrincipalTradeEvent,
  effects: PrincipalPaidPermitEffects | undefined,
  collective?: PrincipalCollectivePort,
  execution?: PublicPrincipalExecution,
): WorldProjection {
  const expected = preparePrincipalPaidPermitEffects(w, event, collective, execution);
  if (!tradeFactsEqual(expected ?? null, effects ?? null))
    throw Error('principal-paid-permit-effects-mismatch');
  if (!expected) return w;
  const state = applyPrincipalPremisesRightsEvent(w.premisesRights!, expected.acceptance);
  return { ...w, premisesRights: applyPremisesProvisionEvent(state, expected.provision) };
}
