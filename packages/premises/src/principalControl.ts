import {
  RESOURCE_PRINCIPAL_POLICY,
  decidePrincipalControl,
  applyPrincipalControl,
  resourcePrincipalSnapshot,
  type PrincipalControlRequest,
  type PrincipalAuthorizationPort,
  type ResourcePrincipal,
} from '@aivilization/authority';
import type { PremisesState, PremisesEvent } from './model';
/** Bilateral control only: preserve every physical, author, use and obligation fact. */
export function decidePremisesPrincipalControl(input: {
  state: PremisesState;
  actorId: string;
  at: number;
  request: PrincipalControlRequest;
  authorize: PrincipalAuthorizationPort;
  available: (principal: ResourcePrincipal) => boolean;
}) {
  const s = input.state,
    r = input.request,
    no = (reason: string) => ({ accepted: false as const, reason });
  if (!s.resourcePrincipals) return no('premises-principals-not-enabled');
  const b = s.buildings[r.resourceId];
  if (r.resourceKind !== 'premises' || !b || (b.status === 'demolished' && b.footprintReleased))
    return no('principal-premises-unavailable');
  if (b.revision !== r.resourceRevision || b.revision >= Number.MAX_SAFE_INTEGER)
    return no('principal-premises-revision-conflict');
  if (input.at < b.at) return no('invalid-premises-time');
  if (Object.values(s.projects).some((p) => p.buildingId === b.id && p.status === 'open'))
    return no('premises-construction-in-progress');
  try {
    const d = decidePrincipalControl({
      ...input,
      policy: RESOURCE_PRINCIPAL_POLICY,
      snapshot: resourcePrincipalSnapshot(b),
    });
    if (!d.accepted) return d;
    return {
      accepted: true as const,
      event: { type: 'PremisesPrincipalControlChanged' as const, change: d.event },
    };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-premises-principal-control');
  }
}
export function applyPremisesPrincipalControl(
  s: PremisesState,
  e: Extract<PremisesEvent, { type: 'PremisesPrincipalControlChanged' }>,
): PremisesState {
  const r = e.change.request,
    b = s.buildings[r.resourceId];
  if (
    !s.resourcePrincipals ||
    r.resourceKind !== 'premises' ||
    !b ||
    r.resourceRevision !== b.revision ||
    b.revision >= Number.MAX_SAFE_INTEGER ||
    (b.status === 'demolished' && b.footprintReleased) ||
    e.change.control.at < b.at ||
    Object.values(s.projects).some((p) => p.buildingId === b.id && p.status === 'open')
  )
    throw Error('invalid-premises-principal-control');
  const control = applyPrincipalControl(resourcePrincipalSnapshot(b), e.change);
  return {
    ...s,
    buildings: {
      ...s.buildings,
      [b.id]: { ...b, control, revision: b.revision + 1, at: control.at },
    },
  };
}
