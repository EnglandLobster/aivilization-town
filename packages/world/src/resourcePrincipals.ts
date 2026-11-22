import { applyPrincipalResourceControlEffects } from './resourcePrincipalControlEffects';
import { decidePremisesPrincipalControl } from '@aivilization/premises';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import {
  RESOURCE_PRINCIPAL_POLICY,
  assertResourcePrincipalPolicy,
  type PrincipalControlRequest,
  type PrincipalControlChanged,
} from '@aivilization/authority';
import { applyMaterialCommit, decideMaterialPrincipalControl } from '@aivilization/materials';
import { enablePublicResourceCustodyAuthority } from '@aivilization/governance';
import { createEventEnvelope } from '@aivilization/sim-core';
import {
  authorizeWorldPrincipalControl,
  assertWorldPrincipalControlSource,
  worldPrincipalAvailable,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
type Context = {
  collective?: PrincipalCollectivePort;
  projection: WorldProjection;
  requestId: string;
  simulationId: string;
  nextSequence: number;
};

export function enableResourcePrincipalsEvent(input: Context): WorldEvent {
  const e: WorldEvent = createEventEnvelope({
    id: `${input.requestId}:principals-enabled`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentResourcePrincipalsEnabled',
    payload: { policy: RESOURCE_PRINCIPAL_POLICY },
  });
  applyResourcePrincipalsProjection(input.projection, e);
  return e;
}
export function decideWorldPrincipalControl(
  input: Context & {
    actorId: string;
    request: PrincipalControlRequest;
    publicExecution?: PublicPrincipalExecution;
  },
) {
  const w = input.projection;
  if (!w.materials?.resourcePrincipals)
    return { accepted: false as const, reason: 'resource-principals-not-enabled' };
  if (!['stock', 'premises'].includes(input.request.resourceKind))
    return { accepted: false as const, reason: 'principal-resource-kind-not-connected' };
  if (input.request.resourceKind === 'premises' && !w.premises?.resourcePrincipals)
    return { accepted: false as const, reason: 'principal-resource-kind-not-connected' };
  const ports = {
    actorId: input.actorId,
    at: w.clock.now,
    request: input.request,
    available: (p: Parameters<typeof worldPrincipalAvailable>[1]) =>
      worldPrincipalAvailable(w, p, input.collective),
    authorize: (
      principal: Parameters<typeof authorizeWorldPrincipalControl>[0]['principal'],
      request: PrincipalControlRequest,
    ) =>
      authorizeWorldPrincipalControl({
        world: w,
        actorId: input.actorId,
        principal,
        request,
        ...(input.publicExecution ? { publicExecution: input.publicExecution } : {}),
        ...(input.collective ? { collective: input.collective } : {}),
      }),
  };
  const d =
    input.request.resourceKind === 'stock' && w.materials
      ? decideMaterialPrincipalControl({ ...ports, state: w.materials })
      : w.premises
        ? (() => {
            const r = decidePremisesPrincipalControl({ ...ports, state: w.premises });
            return r.accepted ? { accepted: true as const, events: [r.event] } : r;
          })()
        : { accepted: false as const, reason: 'premises-not-enabled' };
  if (!d.accepted) return d;
  const change = d.events[0];
  if (
    d.events.length !== 1 ||
    (change?.type !== 'MaterialPrincipalControlChanged' &&
      change?.type !== 'PremisesPrincipalControlChanged')
  )
    throw Error('invalid-principal-control-decision');
  return { accepted: true as const, change: change.change };
}
export function residentPrincipalControlEvent(
  input: Context & { actorId: string; request: PrincipalControlRequest },
) {
  const d = decideWorldPrincipalControl(input);
  if (!d.accepted) return d;
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: `${input.requestId}:principal-control`,
        simulationId: input.simulationId,
        sequence: input.nextSequence,
        occurredAt: input.projection.clock.now,
        type: 'ResidentResourcePrincipalControlCommitted' as const,
        payload: { actorId: input.actorId, change: d.change },
      }),
    ],
  };
}
export function applyWorldPrincipalControl(
  w: WorldProjection,
  actorId: string,
  change: PrincipalControlChanged,
  publicExecution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection {
  if (
    !w.materials?.resourcePrincipals ||
    change.control.at !== w.clock.now ||
    !['stock', 'premises'].includes(change.request.resourceKind)
  )
    throw Error('invalid-world-principal-control');
  assertWorldPrincipalControlSource(
    w,
    change.control.authorization,
    change.request,
    actorId,
    publicExecution,
    collective,
  );
  return applyPrincipalResourceControlEffects(w, change);
}

export function applyResourcePrincipalsProjection(
  w: WorldProjection,
  e: WorldEvent,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  if (e.type === 'ResidentResourcePrincipalsEnabled') {
    assertResourcePrincipalPolicy(e.payload.policy);
    if (
      !w.materials ||
      w.materials.resourcePrincipals ||
      !w.publicGovernance ||
      e.occurredAt !== w.clock.now
    )
      throw Error('invalid-resource-principals-activation');
    return {
      ...w,
      materials: applyMaterialCommit(w.materials, [
        { type: 'MaterialResourcePrincipalsEnabled', policy: e.payload.policy },
      ]).state,
      publicGovernance: {
        ...w.publicGovernance,
        authority: enablePublicResourceCustodyAuthority(w.publicGovernance.authority),
      },
    };
  }
  if (e.type === 'ResidentResourcePrincipalControlCommitted') {
    if (e.occurredAt !== w.clock.now) throw Error('invalid-resource-principals-time');
    return applyWorldPrincipalControl(
      w,
      e.payload.actorId,
      e.payload.change,
      undefined,
      collective,
    );
  }
  return undefined;
}
