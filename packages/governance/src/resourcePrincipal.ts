import {
  assertPrincipalAuthorization,
  type PrincipalAuthorization,
  type PrincipalControlRequest,
  type PrincipalOperationRequest,
  type PrincipalRequest,
  type PrincipalValue,
} from '@aivilization/authority';
import {
  PUBLIC_RESOURCE_CUSTODY_GRANT,
  PUBLIC_RESOURCE_SALES_GRANT,
  PUBLIC_RESOURCE_SALES_GRANT_V2,
  PUBLIC_PERIODIC_OBLIGATIONS_GRANT,
  PUBLIC_PRINCIPAL_PERMITS_GRANT,
  PUBLIC_PRINCIPAL_TRADE_GRANT,
  PUBLIC_CONSTRUCTION_TRADE_GRANT,
  PUBLIC_VEHICLE_PRINCIPALS_GRANT,
  PUBLIC_SERVICE_PRINCIPALS_GRANT,
  PUBLIC_SERVICE_CREATION_GRANT,
  PUBLIC_CONSTRUCTION_PRINCIPALS_GRANT,
  type PublicGovernanceState,
} from './model';
import { preparePublicExecution } from './decisions';
import { assertPublicGrant, publicEqual } from './validation';
/** Trusted scope extension only. It neither transfers an asset nor grants a resident an executor role. */
export function enablePublicResourceCustodyAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (s.grant.resourceCustody) throw Error('public-resource-custody-already-enabled');
  const grant = {
    ...s.grant,
    actions: [
      ...new Set([...s.grant.actions, 'control-resource' as const, 'manage-resource' as const]),
    ],
    resourceCustody: PUBLIC_RESOURCE_CUSTODY_GRANT,
  };
  assertPublicGrant(grant);
  return { ...s, grant };
}
/** Produces an exact proof only. Application must atomically commit the asset and consume this approved decision. */
export function enablePublicServiceCreationAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (!s.grant.services || s.grant.serviceCreation)
    throw Error('invalid-public-service-creation-activation');
  const grant = { ...s.grant, serviceCreation: PUBLIC_SERVICE_CREATION_GRANT };
  assertPublicGrant(grant);
  return { ...s, grant };
}
type PublicResourceInput<R extends PrincipalRequest> = {
  state: PublicGovernanceState;
  actorId: string;
  at: number;
  proposalId: string;
  expectedProposalRevision: number;
  request: R;
};
function authorizePublicResource<R extends PrincipalRequest>(
  input: PublicResourceInput<R>,
):
  | { accepted: true; authorization: PrincipalAuthorization<R> }
  | { accepted: false; reason: string } {
  const s = input.state;
  if (
    !s.grant.resourceCustody &&
    !s.grant.vehicles &&
    !s.grant.services &&
    !s.grant.periodicObligations
  )
    return { accepted: false, reason: 'public-resource-custody-not-enabled' };
  const ready = preparePublicExecution(
    s,
    input.actorId,
    input.at,
    input.proposalId,
    input.expectedProposalRevision,
  );
  if (!ready.accepted) return ready;
  if (
    !('request' in ready.action) ||
    ready.action.kind !== ('operation' in input.request ? 'manage-resource' : 'control-resource') ||
    ready.action.expectedRevision !== input.request.resourceRevision ||
    !publicEqual(ready.action.request, input.request)
  )
    return { accepted: false, reason: 'public-resource-operation-mismatch' };
  if ('operation' in input.request && input.request.resourceKind === 'resource-sale') {
    const args = input.request.operation.arguments;
    const source = args.quotedSource ?? args.source;
    const kind =
      source && typeof source === 'object' && !Array.isArray(source)
        ? (source as Readonly<Record<string, PrincipalValue>>).kind
        : undefined;
    if (
      (kind === 'stock' || kind === 'vehicle') &&
      (s.grant.resourceSales?.version !== PUBLIC_RESOURCE_SALES_GRANT_V2.version ||
        ready.proposal.resourceSalesScopeVersion !== PUBLIC_RESOURCE_SALES_GRANT_V2.version)
    )
      return { accepted: false, reason: 'public-resource-sales-current-scope-consent-required' };
  }
  if (
    'operation' in input.request &&
    input.request.resourceKind === 'periodic-obligation' &&
    (s.grant.periodicObligations?.version !== PUBLIC_PERIODIC_OBLIGATIONS_GRANT.version ||
      ready.proposal.periodicObligationsScopeVersion !== PUBLIC_PERIODIC_OBLIGATIONS_GRANT.version)
  )
    return { accepted: false, reason: 'public-periodic-current-scope-consent-required' };
  if (
    'operation' in input.request &&
    input.request.operation.capability.startsWith('construction-trades.') &&
    (s.grant.constructionTrade?.version !== PUBLIC_CONSTRUCTION_TRADE_GRANT.version ||
      ready.proposal.constructionTradeScopeVersion !== PUBLIC_CONSTRUCTION_TRADE_GRANT.version)
  )
    return { accepted: false, reason: 'public-construction-trade-current-scope-consent-required' };
  const authorization: PrincipalAuthorization<R> = {
    actorId: input.actorId,
    principal: { kind: 'public', id: s.grant.id },
    request: structuredClone(input.request),
    source: {
      kind: 'public',
      proposalId: ready.proposal.id,
      procedureRevision: ready.proposal.procedureRevision,
    },
  };
  assertPrincipalAuthorization(
    authorization,
    { kind: 'public', id: s.grant.id },
    input.request,
    input.actorId,
  );
  return { accepted: true, authorization };
}

export const authorizePublicResourceControl = (
  input: PublicResourceInput<PrincipalControlRequest>,
) => authorizePublicResource(input);
export const authorizePublicResourceOperation = (
  input: PublicResourceInput<PrincipalOperationRequest>,
) => authorizePublicResource(input);

/** Explicit finite fiscal commitment authority; no asset scope, election or new treasury cash. */
export function enablePublicPeriodicObligationsAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (s.grant.periodicObligations) throw Error('public-periodic-obligations-already-enabled');
  const grant = {
    ...s.grant,
    periodicObligations: PUBLIC_PERIODIC_OBLIGATIONS_GRANT,
    actions: [...new Set([...s.grant.actions, 'manage-resource' as const])],
  };
  assertPublicGrant(grant);
  return { ...s, grant };
}

export function enablePublicConstructionPrincipalsAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (!s.grant.resourceCustody || s.grant.construction)
    throw Error('invalid-public-construction-activation');
  const grant = { ...s.grant, construction: PUBLIC_CONSTRUCTION_PRINCIPALS_GRANT };
  assertPublicGrant(grant);
  return { ...s, grant };
}

export function enablePublicPrincipalPermitsAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (!s.grant.construction || s.grant.principalPermits)
    throw Error('invalid-public-principal-permits-activation');
  const grant = { ...s.grant, principalPermits: PUBLIC_PRINCIPAL_PERMITS_GRANT };
  assertPublicGrant(grant);
  return { ...s, grant };
}

export function enablePublicPrincipalTradeAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (!s.grant.principalPermits || s.grant.principalTrade)
    throw Error('invalid-public-principal-trade-activation');
  const grant = { ...s.grant, principalTrade: PUBLIC_PRINCIPAL_TRADE_GRANT };
  assertPublicGrant(grant);
  return { ...s, grant };
}

export function enablePublicVehiclePrincipalsAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (s.grant.vehicles) throw Error('public-vehicle-principals-already-enabled');
  const grant = {
    ...s.grant,
    vehicles: PUBLIC_VEHICLE_PRINCIPALS_GRANT,
    actions: [
      ...new Set([...s.grant.actions, 'control-resource' as const, 'manage-resource' as const]),
    ],
  };
  assertPublicGrant(grant);
  return { ...s, grant };
}

export function enablePublicServicePrincipalsAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (s.grant.services) throw Error('public-service-principals-already-enabled');
  const grant = {
    ...s.grant,
    services: PUBLIC_SERVICE_PRINCIPALS_GRANT,
    actions: [
      ...new Set([...s.grant.actions, 'control-resource' as const, 'manage-resource' as const]),
    ],
  };
  assertPublicGrant(grant);
  return { ...s, grant };
}

/** Fiscal asset acquisition/disposition is a separate explicit scope; ordinary management is insufficient. */
export function enablePublicResourceSalesAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (!s.grant.construction || s.grant.resourceSales)
    throw Error('invalid-public-resource-sales-activation');
  const grant = { ...s.grant, resourceSales: PUBLIC_RESOURCE_SALES_GRANT };
  assertPublicGrant(grant);
  return { ...s, grant };
}
/** Preserve old proposals and their captured scope; extension cannot expand previous ballots. */
export function extendPublicResourceSalesAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (s.grant.resourceSales?.version !== PUBLIC_RESOURCE_SALES_GRANT.version || !s.grant.vehicles)
    throw Error('invalid-public-resource-sales-extension');
  const grant = { ...s.grant, resourceSales: PUBLIC_RESOURCE_SALES_GRANT_V2 };
  assertPublicGrant(grant);
  return { ...s, grant };
}

/** Procurement is distinct from public physical construction authority and cannot expand old ballots. */
export function enablePublicConstructionTradeAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (!s.grant.construction || s.grant.constructionTrade)
    throw Error('invalid-public-construction-trade-activation');
  const grant = { ...s.grant, constructionTrade: PUBLIC_CONSTRUCTION_TRADE_GRANT };
  assertPublicGrant(grant);
  return { ...s, grant };
}
