import {
  type EvidenceTradeEvent,
  type EvidenceTradeDecision,
  tradeFactsEqual,
} from '@aivilization/commerce';
import {
  decidePremisesRights,
  startPremisesProvision,
  applyPremisesProvisionEvent,
  type PremisesRightsEvent,
  type PremisesProvisionEvent,
} from '@aivilization/premises';
import type { WorldProjection } from './projection';
import {
  residentPremisesRightsPorts,
  type PremisesRightsAuthorization,
} from './premisesRightsPorts';
import { applyPremisesRightsEffects } from './projectionReducers/premisesRights';

export type PaidPermitEffects = {
  readonly acceptance: Extract<PremisesRightsEvent, { type: 'PremisesPermitAccepted' }>;
  readonly provision: Extract<PremisesProvisionEvent, { type: 'PremisesProvisionStarted' }>;
};
function acceptedPermit(events: readonly EvidenceTradeEvent[]) {
  const changes = events.filter(
    (e): e is Extract<EvidenceTradeEvent, { type: 'TradeOrderChanged' }> =>
      e.type === 'TradeOrderChanged' && e.order.source.kind === 'permit',
  );
  const receipts = events.filter(
    (e): e is Extract<EvidenceTradeEvent, { type: 'TradeReceiptRecorded' }> =>
      e.type === 'TradeReceiptRecorded' && e.receipt.operation === 'accept',
  );
  if (!changes.length || !receipts.length) return undefined;
  if (events.length !== 2 || changes.length !== 1 || receipts.length !== 1)
    throw Error('invalid-paid-permit-trade-packet');
  return { order: changes[0]!.order, receipt: receipts[0]!.receipt };
}
export function preparePaidPermitEffects(
  w: WorldProjection,
  actorId: string,
  d: Extract<EvidenceTradeDecision, { accepted: true }>,
  authorization: PremisesRightsAuthorization,
) {
  const match = acceptedPermit(d.events);
  if (!match) return { accepted: true as const };
  const p = w.premisesRights?.permits[match.order.source.id];
  if (!p || !w.premisesRights || w.residentTrade?.policy.version !== 'resident-evidence-trade-v2')
    return { accepted: false as const, reason: 'paid-permit-domains-required' };
  const rights = decidePremisesRights(
    w.premisesRights,
    actorId,
    w.clock.now,
    { type: 'accept', id: p.id, revision: p.revision },
    residentPremisesRightsPorts(w, authorization),
  );
  if (!rights.accepted) return rights;
  const acceptance = rights.events[0];
  if (rights.events.length !== 1 || acceptance?.type !== 'PremisesPermitAccepted')
    throw Error('invalid-paid-permit-decision');
  const after = applyPremisesRightsEffects(w, actorId, w.clock.now, [acceptance]);
  const result = startPremisesProvision(
    after.premisesRights!,
    p.id,
    match.order.id,
    actorId,
    w.clock.now,
  );
  if (!result.accepted) return result;
  const provision = result.events[0];
  if (result.events.length !== 1 || provision?.type !== 'PremisesProvisionStarted')
    throw Error('invalid-paid-provision-decision');
  return {
    accepted: true as const,
    effects: { acceptance, provision } satisfies PaidPermitEffects,
  };
}
/** Missing, extra, substituted or partially funded rights effects are rejected during replay as well as admission. */
export function applyPaidPermitEffects(
  w: WorldProjection,
  actorId: string,
  events: readonly EvidenceTradeEvent[],
  effects: PaidPermitEffects | undefined,
): WorldProjection {
  const match = acceptedPermit(events);
  if (!match) {
    if (effects) throw Error('unexpected-paid-permit-effects');
    return w;
  }
  const { order, receipt } = match,
    p = w.premisesRights?.permits[order.source.id];
  if (
    !effects ||
    !p ||
    !w.premisesRights ||
    w.residentTrade?.policy.version !== 'resident-evidence-trade-v2'
  )
    throw Error('paid-permit-effects-required');
  const expected = {
    type: 'PremisesPermitAccepted' as const,
    id: p.id,
    revision: p.revision + 1,
    signature: {
      actorId,
      at: w.clock.now,
      ...(receipt.decisionId ? { decisionId: receipt.decisionId } : {}),
    },
  };
  if (
    !tradeFactsEqual(effects.acceptance, expected) ||
    receipt.actorId !== actorId ||
    order.status !== 'funded'
  )
    throw Error('paid-permit-consent-mismatch');
  const after = applyPremisesRightsEffects(w, actorId, w.clock.now, [expected]);
  const result = startPremisesProvision(
    after.premisesRights!,
    p.id,
    order.id,
    actorId,
    w.clock.now,
  );
  if (!result.accepted || !tradeFactsEqual(result.events, [effects.provision]))
    throw Error('paid-permit-provision-mismatch');
  return {
    ...after,
    premisesRights: applyPremisesProvisionEvent(after.premisesRights!, effects.provision),
  };
}
