import { createEventEnvelope } from '@aivilization/sim-core';
import { samePrincipalRequest, type PrincipalOperationRequest } from '@aivilization/authority';
import { enablePublicConstructionPrincipalsAuthority } from '@aivilization/governance';
import {
  applyPremisesCommit,
  PREMISES_PRINCIPALS_POLICY,
  premisesPrincipalRequest,
} from '@aivilization/premises';
import {
  residentConstructionEvent,
  residentPremisesEvent,
  type PremisesAuthorization,
} from './residentPremises';
import { decodePrincipalPremisesOperation } from './premisesPrincipalCommandCodec';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import type { PublicPrincipalExecution } from './resourcePrincipalAuthority';
type Context = {
  projection: WorldProjection;
  requestId: string;
  simulationId: string;
  nextSequence: number;
};
export function applyPremisesPrincipalActivation(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentPremisesResourcePrincipalsEnabled') return undefined;
  if (
    !w.premises ||
    w.premises.resourcePrincipals ||
    !w.materials?.resourcePrincipals ||
    !w.publicGovernance?.authority.grant.resourceCustody ||
    e.occurredAt !== w.clock.now
  )
    throw Error('invalid-premises-principals-activation');
  return {
    ...w,
    premises: applyPremisesCommit(w.premises, [
      { type: 'PremisesResourcePrincipalsEnabled', policy: e.payload.policy },
    ]).state,
    publicGovernance: {
      ...w.publicGovernance,
      authority: enablePublicConstructionPrincipalsAuthority(w.publicGovernance.authority),
    },
  };
}
export function enablePremisesPrincipalsEvent(input: Context): WorldEvent {
  const e: WorldEvent = createEventEnvelope({
    id: `${input.requestId}:premises-principals-enabled`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentPremisesResourcePrincipalsEnabled',
    payload: { policy: PREMISES_PRINCIPALS_POLICY },
  });
  applyPremisesPrincipalActivation(input.projection, e);
  return e;
}
export function residentPrincipalPremisesOperation(
  input: Context & {
    actorId: string;
    request: PrincipalOperationRequest;
    collective?: PrincipalCollectivePort;
    publicPrincipalExecution?: PublicPrincipalExecution;
    authorization: PremisesAuthorization;
  },
) {
  const s = input.projection.premises,
    no = (reason: string) => ({ accepted: false as const, reason });
  if (!s?.resourcePrincipals) return no('premises-principals-not-enabled');
  try {
    const c = decodePrincipalPremisesOperation(input.request),
      expected = premisesPrincipalRequest(s, c);
    if (!samePrincipalRequest(expected, input.request))
      return no('principal-premises-version-or-resource-conflict');
    const context = { ...input, principal: true };
    return c.type === 'create-construction'
      ? residentConstructionEvent({
          ...context,
          command: { type: 'create', construction: c.construction },
        })
      : c.type === 'cancel-construction'
        ? residentConstructionEvent({
            ...context,
            command: { type: 'cancel', id: c.id, revision: c.expectedRevision },
          })
        : residentPremisesEvent({
            ...context,
            id: c.id,
            revision: c.expectedRevision,
            command: c.command,
          });
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-principal-premises-operation');
  }
}
