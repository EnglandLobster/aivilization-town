import { freightCustodian } from './custodyHandoff';
import { authorizeController, sameController, validControllerId } from '@aivilization/authority';
import { freightFactsEqual, validFreightTerms } from './facts';
import { freightCreated, freightReceiptId, transitionFreight } from './transitions';
import {
  assertLogisticsPolicy,
  activeFreight,
  freightRejected as no,
  type Freight,
  type FreightTerms,
  type FreightReceipt,
  type LogisticsState,
  type LogisticsCommand,
  type LogisticsPorts,
  type LogisticsDecision,
} from './model';

function sourceAvailable(f: FreightTerms, p: LogisticsPorts, at: number) {
  const source = p.stock(f.sourceStockId),
    r = p.material(f.materialRef.id);
  return (
    !!source &&
    source.status === 'open' &&
    sameController(source.controller, f.controller) &&
    source.locationId === f.sourceLocationId &&
    !!r &&
    r.status === 'offered' &&
    r.stockId === f.sourceStockId &&
    r.revision === f.materialRef.revision &&
    r.expiresAt > at &&
    r.consumer.domain === 'logistics' &&
    r.consumer.id === f.id &&
    sameController(r.beneficiary, f.controller) &&
    freightFactsEqual(r.held, f.items)
  );
}
function receivingStock(f: FreightTerms, p: LogisticsPorts, allowSettling = false) {
  const d = p.stock(f.destinationStockId);
  return (
    !!d &&
    (d.status === 'open' || (allowSettling && d.status === 'settling')) &&
    d.locationId === f.destinationLocationId &&
    sameController(d.controller, f.recipient)
  );
}
function mayReleaseUnbound(f: Freight, p: LogisticsPorts) {
  const r = p.material(f.materialRef.id);
  return (
    f.status === 'offered' &&
    !!r &&
    r.status === 'offered' &&
    r.stockId === f.sourceStockId &&
    r.consumer.domain === 'logistics' &&
    r.consumer.id === f.id &&
    sameController(r.beneficiary, f.controller) &&
    freightFactsEqual(r.held, f.items)
  );
}
export function decideLogistics(
  s: LogisticsState,
  actorId: string,
  at: number,
  c: LogisticsCommand,
  p: LogisticsPorts,
): LogisticsDecision {
  assertLogisticsPolicy(s.policy);
  if (
    !p.exists(actorId) ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    !validControllerId(c.id) ||
    c.id.length > 60
  )
    return no('invalid-freight-actor-time-or-id');
  if (c.type === 'offer') {
    const { type: _type, ...terms } = c;
    void _type;
    if (
      s.freight[c.id] ||
      !validFreightTerms(c, at) ||
      !p.exists(c.carrierId) ||
      !p.controllerAvailable(c.controller) ||
      !p.controllerAvailable(c.recipient)
    )
      return no('invalid-freight-terms');
    const auth = authorizeController(c.controller, actorId, p.authorize);
    if (!auth) return no('freight-source-authority-required');
    if (!sourceAvailable(c, p, at)) return no('freight-source-reservation-required');
    if (!receivingStock(c, p) || !p.routeExists(c.sourceLocationId, c.destinationLocationId))
      return no('freight-destination-or-route-unavailable');
    if (p.account(c.payer)?.status !== 'open') return no('freight-payer-unavailable');
    if (
      Object.keys(s.freight).length >= s.policy.maxTotal ||
      Object.values(s.freight).filter((f) => sameController(f.controller, c.controller)).length >=
        s.policy.maxPerController
    )
      return no('freight-limit');
    const freight: Freight = {
      ...terms,
      status: 'offered',
      createdBy: actorId,
      createdAt: at,
      at,
      revision: 1,
      funded: 0,
      escrow: 0,
      paid: 0,
      refunded: 0,
    };
    return freightCreated(freight, {
      id: freightReceiptId(c.id, 1),
      freightId: c.id,
      actorId,
      at,
      operation: 'offer',
      ...(auth.decisionId ? { decisionId: auth.decisionId } : {}),
    });
  }
  const f = s.freight[c.id];
  if (!f) return no('freight-not-found');
  if (f.revision !== c.expectedRevision) return no('freight-revision-conflict');
  if (!activeFreight(f) || at < f.at) return no('freight-ended-or-invalid-time');
  let decisionId: string | undefined;
  if (c.type === 'accept') {
    const auth = authorizeController(f.recipient, actorId, p.authorize);
    if (!auth || !receivingStock(f, p)) return no('freight-recipient-authority-required');
    if (!sourceAvailable(f, p, at)) return no('freight-source-reservation-required');
    decisionId = auth.decisionId;
  } else if (c.type === 'fund') {
    const payer = p.account(f.payer);
    if (!payer || payer.status !== 'open') return no('freight-payer-unavailable');
    const auth = authorizeController(payer.controller, actorId, p.authorize);
    if (!auth) return no('freight-payer-authority-required');
    if (payer.balance < Math.max(f.deliveryFee, f.returnFee))
      return no('insufficient-freight-funding');
    decisionId = auth.decisionId;
  } else if (c.type === 'cancel') {
    const payer = p.account(f.payer),
      auth =
        authorizeController(f.controller, actorId, p.authorize) ??
        authorizeController(f.recipient, actorId, p.authorize) ??
        (payer && authorizeController(payer.controller, actorId, p.authorize));
    if (actorId !== f.carrierId && !auth) return no('freight-party-authority-required');
    decisionId = auth?.decisionId;
  } else if (c.type === 'load' || c.type === 'deliver' || c.type === 'return') {
    if (actorId !== freightCustodian(s.custody, f).carrierId)
      return no('freight-personal-carrier-required');
    const location = c.type === 'deliver' ? f.destinationLocationId : f.sourceLocationId;
    if (!p.presentAndIdle(actorId, location)) return no('freight-carrier-not-present-and-idle');
    if (c.type !== 'return' && !receivingStock(f, p, true))
      return no('freight-reception-no-longer-authorized');
    const failure = p.cargoAccess(f, c.type);
    if (failure) return no(failure);
  }
  const receipt: FreightReceipt = {
    id: freightReceiptId(f.id, f.revision + 1),
    freightId: f.id,
    actorId,
    at,
    operation: c.type,
    ...(decisionId ? { decisionId } : {}),
    ...(c.type === 'cancel' && mayReleaseUnbound(f, p) ? { releaseUnboundSource: true } : {}),
  };
  return transitionFreight(f, receipt);
}
export function advanceFreight(
  s: LogisticsState,
  id: string,
  at: number,
  p: LogisticsPorts,
): LogisticsDecision {
  const f = s.freight[id];
  if (!f || !activeFreight(f) || f.status === 'return-required' || at < f.deadline)
    return { accepted: true, events: [], transactions: [], materialProofs: [] };
  return transitionFreight(f, {
    id: freightReceiptId(f.id, f.revision + 1),
    freightId: f.id,
    actorId: 'system',
    at,
    operation: 'expire',
    ...(mayReleaseUnbound(f, p) ? { releaseUnboundSource: true } : {}),
  });
}
export function nextLogisticsBoundary(s: LogisticsState | undefined, at: number) {
  const times = Object.values(s?.freight ?? {})
    .filter((f) => activeFreight(f) && f.status !== 'return-required' && f.deadline > at)
    .map((f) => f.deadline);
  return times.length ? Math.min(...times) : undefined;
}
