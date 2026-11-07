import {
  decidePrincipalControl,
  applyPrincipalControl,
  effectiveController,
  samePrincipal,
  resourcePrincipalSnapshot,
  assertResourcePrincipalPolicy,
  type PrincipalControlRequest,
  type PrincipalAuthorizationPort,
  type ResourcePrincipal,
} from '@aivilization/authority';
import { no, type MaterialsState, type MaterialDecision, type MaterialEvent } from './model';

/** Transfer custody only. Workers, inventory, reservations, ACL and historical author remain intact. */
export function decideMaterialPrincipalControl(input: {
  state: MaterialsState;
  actorId: string;
  at: number;
  request: PrincipalControlRequest;
  authorize: PrincipalAuthorizationPort;
  available: (principal: ResourcePrincipal) => boolean;
}): MaterialDecision {
  const { state: s, request: r } = input;
  if (!s.resourcePrincipals) return no('material-resource-principals-not-enabled');
  if (r.resourceKind !== 'stock') return no('unsupported-material-principal-resource');
  const stock = s.stocks[r.resourceId];
  if (!stock || stock.status === 'closed') return no('material-stock-unavailable');
  if (stock.revision !== r.resourceRevision || stock.revision >= Number.MAX_SAFE_INTEGER)
    return no('material-stock-revision-conflict');
  if (input.at < stock.at) return no('invalid-material-time');
  try {
    const decision = decidePrincipalControl({
      ...input,
      policy: s.resourcePrincipals,
      snapshot: resourcePrincipalSnapshot(stock),
    });
    if (!decision.accepted) return decision;
    if (
      r.command.type === 'accept' &&
      Object.values(s.stocks).filter(
        (v) =>
          v.status !== 'closed' &&
          samePrincipal(effectiveController(v), decision.event.control.controller),
      ).length >= s.policy.maxStocksPerController
    )
      return no('material-stock-limit');
    return {
      accepted: true,
      events: [{ type: 'MaterialPrincipalControlChanged', change: decision.event }],
    };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-material-principal-control');
  }
}

export function applyMaterialPrincipalEvent(
  s: MaterialsState,
  event: Extract<
    MaterialEvent,
    { type: 'MaterialResourcePrincipalsEnabled' | 'MaterialPrincipalControlChanged' }
  >,
): MaterialsState {
  if (event.type === 'MaterialResourcePrincipalsEnabled') {
    if (s.resourcePrincipals) throw Error('material-resource-principals-already-enabled');
    assertResourcePrincipalPolicy(event.policy);
    return { ...s, resourcePrincipals: structuredClone(event.policy) };
  }
  if (!s.resourcePrincipals) throw Error('material-resource-principals-not-enabled');
  const request = event.change.request,
    old = s.stocks[request.resourceId];
  if (
    request.resourceKind !== 'stock' ||
    !old ||
    old.status === 'closed' ||
    request.resourceRevision !== old.revision ||
    old.revision >= Number.MAX_SAFE_INTEGER ||
    event.change.control.at < old.at
  )
    throw Error('invalid-material-principal-event');
  const control = applyPrincipalControl(resourcePrincipalSnapshot(old), event.change);
  if (
    request.command.type === 'accept' &&
    Object.values(s.stocks).filter(
      (v) => v.status !== 'closed' && samePrincipal(effectiveController(v), control.controller),
    ).length >= s.policy.maxStocksPerController
  )
    throw Error('material-stock-limit');
  return {
    ...s,
    stocks: {
      ...s.stocks,
      [old.id]: { ...old, control, revision: old.revision + 1, at: control.at },
    },
  };
}
