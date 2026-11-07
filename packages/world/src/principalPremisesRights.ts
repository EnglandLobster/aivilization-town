import {
  settleResidentPremisesProvisions,
  applyPremisesProvisionSettlements,
  type PremisesProvisionSettlement,
} from './residentPremisesProvision';
import {
  samePrincipal,
  samePrincipalRequest,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import { enablePublicPrincipalPermitsAuthority } from '@aivilization/governance';
import { tradeSourceStartFailure } from '@aivilization/commerce';
import { createEventEnvelope } from '@aivilization/sim-core';
import {
  PRINCIPAL_PREMISES_RIGHTS_POLICY,
  applyPrincipalPremisesRightsEvent,
  decidePrincipalPremisesRights,
  principalPermitRequest,
  isPrincipalPremisesPermit,
  type PrincipalPremisesRightsEvent,
  type PrincipalPremisesRightsPorts,
} from '@aivilization/premises';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import {
  authorizeWorldPrincipalOperation,
  assertWorldPrincipalOperationSource,
  worldPrincipalAvailable,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
import { decodePrincipalPermitOperation } from './principalPermitCommandCodec';
import { premisesPermitConflict, premisesPermitReleaseBlocked } from './premisesRightsPorts';
export type ResidentPrincipalPremisesRightsPayload = {
  readonly policyVersion: typeof PRINCIPAL_PREMISES_RIGHTS_POLICY.version;
  readonly actorId: string;
  readonly events: readonly PrincipalPremisesRightsEvent[];
  readonly provisionSettlements?: readonly PremisesProvisionSettlement[];
};
type Context = {
  projection: WorldProjection;
  requestId: string;
  simulationId: string;
  nextSequence: number;
};
export function principalPremisesRightsPorts(
  w: WorldProjection,
  actorId: string,
  collective?: PrincipalCollectivePort,
  execution?: PublicPrincipalExecution,
): PrincipalPremisesRightsPorts {
  return {
    building: (id) => w.premises?.buildings[id],
    exists: (id) => !!w.agents[id],
    available: (p) => worldPrincipalAvailable(w, p, collective),
    authorize: (p, r) => authorizeWorldPrincipalOperation(w, actorId, p, r, execution, collective),
    conflict: (t, at) => premisesPermitConflict(w, t, at),
    releaseBlocked: (p) => premisesPermitReleaseBlocked(w, p),
  };
}
function wrap(
  input: Context,
  actorId: string,
  events: readonly PrincipalPremisesRightsEvent[],
  provisionSettlements: readonly PremisesProvisionSettlement[] = [],
): WorldEvent {
  return createEventEnvelope({
    id: `${input.requestId}:principal-permits`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentPrincipalPremisesRightsCommitted',
    payload: {
      policyVersion: PRINCIPAL_PREMISES_RIGHTS_POLICY.version,
      actorId,
      events,
      ...(provisionSettlements.length ? { provisionSettlements } : {}),
    },
  });
}
export function enablePrincipalPremisesRightsEvent(input: Context): WorldEvent {
  const e = wrap(input, 'system', [
    { type: 'PrincipalPremisesRightsEnabled', policy: PRINCIPAL_PREMISES_RIGHTS_POLICY },
  ]);
  applyPrincipalPremisesRightsProjection(input.projection, e);
  return e;
}
export function residentPrincipalPermitOperation(
  input: Context & {
    actorId: string;
    request: PrincipalOperationRequest;
    collective?: PrincipalCollectivePort;
    publicPrincipalExecution?: PublicPrincipalExecution;
  },
) {
  const no = (reason: string) => ({ accepted: false as const, reason }),
    w = input.projection;
  let s = w.premisesRights;
  if (!s?.principalPolicy) return no('principal-permits-not-enabled');
  try {
    const command = decodePrincipalPermitOperation(input.request);
    const settlements =
      command.type === 'release'
        ? settleResidentPremisesProvisions({ ...input, permitIds: [command.id] }).flatMap((e) =>
            e.type === 'ResidentPremisesProvisionCommitted' ? e.payload.events : [],
          )
        : [];
    const working = settlements.length
      ? applyPremisesProvisionSettlements(w, settlements, w.clock.now)
      : w;
    s = working.premisesRights!;
    const ports = principalPremisesRightsPorts(
      working,
      input.actorId,
      input.collective,
      input.publicPrincipalExecution,
    );
    if (!samePrincipalRequest(principalPermitRequest(s, command, ports), input.request))
      return no('principal-permit-version-or-resource-conflict');
    if (
      command.type === 'accept' &&
      tradeSourceStartFailure(w.residentTrade, { kind: 'permit', id: command.id })
    )
      return no('permit-paid-acceptance-required');
    const d = decidePrincipalPremisesRights(s, input.actorId, w.clock.now, command, ports);
    if (!d.accepted) return d;
    const event = wrap(input, input.actorId, d.events, settlements);
    applyPrincipalPremisesRightsProjection(
      w,
      event,
      input.publicPrincipalExecution,
      input.collective,
    );
    return { accepted: true as const, events: [event] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-principal-permit-operation');
  }
}
/** Current source evidence is verified against the pre-event world, then immutable facts update the sole permit registry. */
export function applyPrincipalPremisesRightsProjection(
  w: WorldProjection,
  e: WorldEvent,
  execution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  if (e.type !== 'ResidentPrincipalPremisesRightsCommitted') return undefined;
  const payload = e.payload;
  let s = w.premisesRights;
  if (
    !s ||
    !w.premises?.resourcePrincipals ||
    e.occurredAt !== w.clock.now ||
    payload.policyVersion !== PRINCIPAL_PREMISES_RIGHTS_POLICY.version ||
    payload.events.length !== 1
  )
    throw Error('invalid-principal-permits-commit');
  const event = payload.events[0]!;
  if (event.type === 'PrincipalPremisesRightsEnabled') {
    if (
      payload.actorId !== 'system' ||
      s.principalPolicy ||
      payload.provisionSettlements?.length ||
      !w.publicGovernance?.authority.grant.construction
    )
      throw Error('invalid-principal-permits-activation');
    return {
      ...w,
      premisesRights: applyPrincipalPremisesRightsEvent(s, event),
      publicGovernance: {
        ...w.publicGovernance,
        authority: enablePublicPrincipalPermitsAuthority(w.publicGovernance.authority),
      },
    };
  }
  if (
    !w.agents[payload.actorId] ||
    event.at !== e.occurredAt ||
    event.authorization.actorId !== payload.actorId
  )
    throw Error('invalid-principal-permits-signature');
  if (
    event.type === 'PrincipalPremisesPermitAccepted' &&
    tradeSourceStartFailure(w.residentTrade, { kind: 'permit', id: event.id })
  )
    throw Error('permit-paid-acceptance-required');
  assertWorldPrincipalOperationSource(w, event.authorization, execution, collective);
  if (event.type === 'PrincipalPremisesPermitTradeAccepted')
    throw Error('principal-permit-trade-requires-atomic-payment');
  const command = decodePrincipalPermitOperation(event.authorization.request),
    ports = principalPremisesRightsPorts(w, payload.actorId, collective, execution);
  if (!samePrincipalRequest(principalPermitRequest(s, command, ports), event.authorization.request))
    throw Error('principal-permit-source-version-mismatch');
  const terms = event.type === 'PrincipalPremisesPermitOffered' ? event.terms : s.permits[event.id];
  if (!terms || !isPrincipalPremisesPermit(terms) || terms.users.some((id) => !w.agents[id]))
    throw Error('principal-permit-users-missing');
  if (
    event.type === 'PrincipalPremisesPermitOffered' ||
    event.type === 'PrincipalPremisesPermitAccepted'
  ) {
    const b = w.premises.buildings[terms.buildingId];
    if (
      !b ||
      b.control.policyVersion !== 'resource-principals-v2' ||
      b.status !== 'operational' ||
      b.condition <= 0 ||
      b.control.offer ||
      !samePrincipal(b.control.controller, terms.issuer) ||
      b.control.version !== terms.issuerVersion ||
      !worldPrincipalAvailable(w, terms.grantee, collective)
    )
      throw Error('principal-permit-control-evidence-mismatch');
    if (
      event.type === 'PrincipalPremisesPermitOffered' &&
      (b.revision !== event.authorization.request.resourceRevision ||
        (terms.scopes.includes('reside') && b.blueprint.primaryUse !== 'residence'))
    )
      throw Error('principal-permit-building-evidence-mismatch');
    if (
      event.type === 'PrincipalPremisesPermitAccepted' &&
      premisesPermitConflict(w, terms, w.clock.now)
    )
      throw Error('permit-existing-obligation-conflict');
  }
  if (
    event.type === 'PrincipalPremisesPermitClosed' &&
    event.reason === 'released' &&
    premisesPermitReleaseBlocked(w, s.permits[event.id]!)
  )
    throw Error('permit-active-work-must-end-first');
  if (payload.provisionSettlements) {
    if (
      !payload.provisionSettlements.length ||
      event.type !== 'PrincipalPremisesPermitClosed' ||
      event.reason !== 'released' ||
      payload.provisionSettlements.some((q) => q.permitId !== event.id)
    )
      throw Error('unrelated-principal-permit-provision-settlement');
    s = applyPremisesProvisionSettlements(
      w,
      payload.provisionSettlements,
      w.clock.now,
    ).premisesRights!;
  }
  return { ...w, premisesRights: applyPrincipalPremisesRightsEvent(s, event) };
}
