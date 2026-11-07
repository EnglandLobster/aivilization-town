import {
  assertPrincipalAuthorization,
  principalId,
  validResourcePrincipal,
  samePrincipal,
  type PrincipalControlRequest,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import { tradeFactsEqual, tradeMoneyMicros } from './tradeFacts';
import {
  RESOURCE_SALES_POLICY,
  RESOURCE_SALES_POLICY_V2,
  type ResourceSalesPolicy,
  type ResourceSaleSource,
  type ResourceSaleCommand,
  type ResourceSalesState,
  type ResourceSale,
} from './resourceSaleModel';
import type { PrincipalTradeAccount } from './principalTradeModel';
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function assertResourceSalesPolicy(policy: ResourceSalesPolicy) {
  if (
    !tradeFactsEqual(policy, RESOURCE_SALES_POLICY) &&
    !tradeFactsEqual(policy, RESOURCE_SALES_POLICY_V2)
  )
    throw Error('unsupported-resource-sales-policy');
}
export function validResourceSaleAccount(a: PrincipalTradeAccount) {
  return (
    !!a &&
    Object.keys(a).length === 2 &&
    ['agent', 'collective', 'enterprise', 'treasury'].includes(a.sector) &&
    principalId(a.id) &&
    (a.sector !== 'treasury' || a.id === 'public-treasury')
  );
}
export function assertResourceSaleSource(source: ResourceSaleSource, at: number) {
  const s = source,
    offer = s.offer,
    proof = offer.authorization;
  if (
    ![s.id, s.authorId, s.locationId].every(principalId) ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 1 ||
    !Number.isSafeInteger(s.controlVersion) ||
    s.controlVersion < 2 ||
    !validResourcePrincipal(s.seller) ||
    !validResourcePrincipal(offer.target) ||
    samePrincipal(s.seller, offer.target) ||
    !time(at) ||
    !time(offer.offeredAt) ||
    offer.offeredAt > at ||
    !time(offer.expiresAt) ||
    offer.expiresAt <= offer.offeredAt ||
    !offer.terms.trim() ||
    offer.terms.length > 2000 ||
    s.encumbrances.length > 128 ||
    s.encumbrances.some(
      (r) =>
        !principalId(r.kind) ||
        !principalId(r.id) ||
        !Number.isSafeInteger(r.revision) ||
        r.revision < 1,
    )
  )
    throw Error('invalid-resource-sale-source');
  assertResourceSalePhysicalSource(s);
  assertPrincipalAuthorization(proof, s.seller, proof.request, proof.actorId);
  const r = proof.request;
  if (
    r.resourceKind !== s.kind ||
    r.resourceId !== s.id ||
    r.resourceRevision >= s.revision ||
    r.controlVersion + 1 !== s.controlVersion ||
    r.command.type !== 'offer' ||
    !samePrincipal(r.command.target, offer.target) ||
    r.command.terms !== offer.terms ||
    r.command.expiresAt !== offer.expiresAt
  )
    throw Error('resource-sale-original-control-offer-required');
}
/** Source is the owning resource's exact current read; a stale original price can never silently transfer newer terms. */
export function resourceSaleControlEffect(
  sale: ResourceSale,
  command: ResourceSaleCommand,
  source?: ResourceSaleSource,
): PrincipalControlRequest | undefined {
  if (command.type === 'accept')
    return {
      resourceKind: sale.source.kind,
      resourceId: sale.source.id,
      resourceRevision: sale.source.revision,
      controlVersion: sale.source.controlVersion,
      command: { type: 'accept' },
    };
  if (
    command.type === 'withdraw' &&
    source &&
    source.kind === sale.source.kind &&
    source.id === sale.source.id &&
    source.controlVersion === sale.source.controlVersion &&
    samePrincipal(source.seller, sale.source.seller)
  )
    return {
      resourceKind: source.kind,
      resourceId: source.id,
      resourceRevision: source.revision,
      controlVersion: source.controlVersion,
      command: { type: 'cancel' },
    };
  return undefined;
}
export function resourceSaleSubject(
  state: ResourceSalesState,
  c: ResourceSaleCommand,
  source?: ResourceSaleSource,
) {
  const sale = state.sales[c.id];
  if (c.type === 'offer') {
    if (!source) throw Error('resource-sale-source-required');
    return source.seller;
  }
  if (!sale) throw Error('resource-sale-not-found');
  return c.type === 'withdraw' ? sale.source.seller : sale.source.offer.target;
}
export function resourceSaleRequest(
  state: ResourceSalesState,
  c: ResourceSaleCommand,
  source?: ResourceSaleSource,
): PrincipalOperationRequest {
  if (c.type === 'offer') {
    if (!source) throw Error('resource-sale-source-required');
    return {
      resourceKind: 'resource-sale',
      resourceId: c.id,
      resourceRevision: 1,
      controlVersion: source.controlVersion,
      operation: {
        capability: 'resource-sales.offer',
        arguments: { command: structuredClone(c), source: structuredClone(source) },
      },
    };
  }
  const sale = state.sales[c.id];
  if (!sale) throw Error('resource-sale-not-found');
  const controlEffect = resourceSaleControlEffect(sale, c, source);
  return {
    resourceKind: 'resource-sale',
    resourceId: c.id,
    resourceRevision: c.expectedRevision,
    controlVersion: sale.source.controlVersion,
    operation: {
      capability: `resource-sales.${c.type}`,
      arguments: {
        command: structuredClone(c),
        quotedSource: structuredClone(sale.source),
        payer: { ...sale.payer },
        revenue: { ...sale.revenue },
        amount: sale.amount,
        acceptBy: sale.acceptBy,
        ...(controlEffect ? { controlEffect } : {}),
      },
    },
  };
}
export function assertResourceSale(s: ResourceSale) {
  assertResourceSaleSource(s.source, s.createdAt);
  if (
    !principalId(s.id) ||
    s.id.length > 60 ||
    !s.title.trim() ||
    s.title.length > 120 ||
    !s.terms.trim() ||
    s.terms.length > RESOURCE_SALES_POLICY.maxTermsChars ||
    !validResourceSaleAccount(s.payer) ||
    !validResourceSaleAccount(s.revenue) ||
    tradeFactsEqual(s.payer, s.revenue) ||
    !time(s.createdAt) ||
    !time(s.at) ||
    s.at < s.createdAt ||
    !time(s.acceptBy) ||
    s.acceptBy <= s.createdAt ||
    s.acceptBy !== s.source.offer.expiresAt ||
    s.acceptBy > s.createdAt + RESOURCE_SALES_POLICY.maxWindowMs ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 1 ||
    !Number.isFinite(s.amount) ||
    s.amount <= 0 ||
    s.amount > RESOURCE_SALES_POLICY.maxAmount ||
    !['offered', 'settled', 'withdrawn', 'declined', 'expired'].includes(s.status) ||
    !resourceSaleSourceDeliverable(s.source) ||
    s.paidMicros !== (s.status === 'settled' ? tradeMoneyMicros(s.amount) : 0) ||
    (s.status === 'settled') !== !!s.acceptedAuthorization
  )
    throw Error('invalid-resource-sale-record');
  const offer: ResourceSaleCommand = {
    type: 'offer',
    id: s.id,
    title: s.title,
    terms: s.terms,
    resource: { kind: s.source.kind, id: s.source.id, expectedRevision: s.source.revision },
    payer: s.payer,
    revenue: s.revenue,
    amount: s.amount,
    acceptBy: s.acceptBy,
  };
  assertPrincipalAuthorization(
    s.offeredAuthorization,
    s.source.seller,
    resourceSaleRequest({ policy: RESOURCE_SALES_POLICY, sales: {} }, offer, s.source),
    s.offeredAuthorization.actorId,
  );
  if (s.acceptedAuthorization) {
    const accepted: ResourceSaleCommand = {
      type: 'accept',
      id: s.id,
      expectedRevision: s.revision - 1,
    };
    assertPrincipalAuthorization(
      s.acceptedAuthorization,
      s.source.offer.target,
      resourceSaleRequest(
        { policy: RESOURCE_SALES_POLICY, sales: { [s.id]: s } },
        accepted,
        s.source,
      ),
      s.acceptedAuthorization.actorId,
    );
  }
}
/** Even a declined/withdrawn price cannot make its original paid handover into a free gift. */
export function resourceSaleForControl(
  state: ResourceSalesState | undefined,
  kind: string,
  id: string,
  controlVersion: number,
) {
  return Object.values(state?.sales ?? {}).find(
    (s) =>
      s.source.kind === kind && s.source.id === id && s.source.controlVersion === controlVersion,
  );
}

function assertResourceSalePhysicalSource(s: ResourceSaleSource) {
  const ids = (v: readonly string[]) =>
    v.length <= 128 && v.every(principalId) && new Set(v).size === v.length;
  if (s.kind === 'premises') {
    if (
      s.version !== 'premises-sale-source-v1' ||
      !Number.isSafeInteger(s.condition) ||
      s.condition < 0 ||
      s.condition > 1000 ||
      !['operational', 'closed', 'demolished'].includes(s.buildingStatus) ||
      !Number.isSafeInteger(s.blueprint.floorArea) ||
      s.blueprint.floorArea <= 0 ||
      !Number.isSafeInteger(s.blueprint.capacity) ||
      s.blueprint.capacity <= 0 ||
      !s.blueprint.primaryUse.trim() ||
      Object.values(s.blueprint.fixtures).some((n) => !Number.isSafeInteger(n) || n < 0) ||
      s.openProjects.length > 128 ||
      s.openProjects.some(
        (r) => !principalId(r.id) || !Number.isSafeInteger(r.revision) || r.revision < 1,
      )
    )
      throw Error('invalid-resource-sale-premises-source');
  } else if (s.kind === 'stock') {
    if (
      s.version !== 'stock-sale-source-v1' ||
      !['open', 'settling', 'closed'].includes(s.stockStatus) ||
      !ids(s.contributors) ||
      !ids(s.readers) ||
      Object.keys(s.inventory).length > 128 ||
      Object.entries(s.inventory).some(
        ([name, n]) =>
          !name.trim() || name.length > 160 || !Number.isFinite(n) || n < 0 || n > 1e12,
      )
    )
      throw Error('invalid-resource-sale-stock-source');
  } else if (s.kind === 'vehicle') {
    const c = s.cargoCapacity;
    if (
      s.version !== 'vehicle-sale-source-v1' ||
      !Number.isSafeInteger(s.seats) ||
      s.seats <= 0 ||
      !ids(s.authorized) ||
      typeof s.busy !== 'boolean' ||
      (c &&
        (c.version !== 'vehicle-cargo-capacity-v1' ||
          !Number.isFinite(c.units) ||
          c.units < 0 ||
          !['scenario-seed', 'authorized-extension'].includes(c.source) ||
          !principalId(c.sourceId)))
    )
      throw Error('invalid-resource-sale-vehicle-source');
  } else throw Error('resource-sale-kind-not-connected');
}
export function resourceSaleSourceDeliverable(s: ResourceSaleSource) {
  if (s.kind === 'premises')
    return s.buildingStatus === 'operational' && s.condition > 0 && !s.openProjects.length;
  if (s.kind === 'stock') return s.stockStatus === 'open';
  return !s.busy;
}
