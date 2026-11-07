import { tradeSourceStartFailure } from '@aivilization/commerce';
import {
  PREMISES_RIGHTS_POLICY,
  decidePremisesRights,
  expirePremisesRights,
  type PremisesRightsCommand,
  type PremisesRightsEvent,
  type PremisesRightsPolicy,
} from '@aivilization/premises';
import { createEventEnvelope } from '@aivilization/sim-core';
import { applyWorldEvent, type WorldProjection } from './projection';
import { settleResidentPremisesProvisions } from './residentPremisesProvision';
import {
  residentPremisesRightsPorts,
  type PremisesRightsAuthorization,
} from './premisesRightsPorts';
export type ResidentPremisesRightsPayload = {
  readonly policyVersion: 'resident-premises-rights-v1';
  readonly actorId: string;
  readonly events: readonly PremisesRightsEvent[];
};
type Context = {
  projection: WorldProjection;
  actorId: string;
  simulationId: string;
  requestId: string;
  nextSequence: number;
  authorization: PremisesRightsAuthorization;
};
function wrap(input: Omit<Context, 'authorization'>, events: readonly PremisesRightsEvent[]) {
  return {
    accepted: true as const,
    events: events.length
      ? [
          createEventEnvelope({
            id: `${input.requestId}:premises-rights`,
            simulationId: input.simulationId,
            sequence: input.nextSequence,
            occurredAt: input.projection.clock.now,
            type: 'ResidentPremisesRightsCommitted',
            payload: {
              policyVersion: PREMISES_RIGHTS_POLICY.version,
              actorId: input.actorId,
              events,
            } satisfies ResidentPremisesRightsPayload,
          }),
        ]
      : [],
  };
}
export function residentPremisesRightsEvent(input: Context & { command: PremisesRightsCommand }) {
  if (
    input.command.type === 'accept' &&
    tradeSourceStartFailure(input.projection.residentTrade, {
      kind: 'permit',
      id: input.command.id,
    })
  )
    return { accepted: false as const, reason: 'permit-paid-acceptance-required' };
  const provisionEvents =
    input.command.type === 'release'
      ? settleResidentPremisesProvisions({ ...input, permitIds: [input.command.id] })
      : [];
  const projection = provisionEvents.reduce(applyWorldEvent, input.projection);
  const s = projection.premisesRights;
  if (!s) return { accepted: false as const, reason: 'premises-rights-not-enabled' };
  const d = decidePremisesRights(
    s,
    input.actorId,
    projection.clock.now,
    input.command,
    residentPremisesRightsPorts(projection, input.authorization),
  );
  if (!d.accepted) return d;
  const result = wrap(
    { ...input, projection, nextSequence: input.nextSequence + provisionEvents.length },
    d.events,
  );
  return { accepted: true as const, events: [...provisionEvents, ...result.events] };
}
export function enableResidentPremisesRightsEvent(
  input: Omit<Context, 'actorId' | 'authorization'> & { policy: PremisesRightsPolicy },
) {
  if (!input.projection.premises) return { accepted: false as const, reason: 'premises-required' };
  if (input.projection.premisesRights)
    return { accepted: false as const, reason: 'premises-rights-already-enabled' };
  return wrap({ ...input, actorId: 'system' }, [
    { type: 'PremisesRightsEnabled', policy: input.policy },
  ]);
}
export function advanceResidentPremisesRights(input: Omit<Context, 'actorId' | 'authorization'>) {
  const provisionEvents = settleResidentPremisesProvisions(input),
    projection = provisionEvents.reduce(applyWorldEvent, input.projection);
  return [
    ...provisionEvents,
    ...wrap(
      {
        ...input,
        projection,
        nextSequence: input.nextSequence + provisionEvents.length,
        actorId: 'system',
      },
      expirePremisesRights(projection.premisesRights, projection.clock.now),
    ).events,
  ];
}
