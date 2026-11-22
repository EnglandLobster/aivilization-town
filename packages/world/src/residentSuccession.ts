import {
  SUCCESSION_CONTROL_EXECUTION_POLICY as POLICY,
  applySuccessionControlExecutionEvent,
  assertSuccessionControlExecutionsState,
  assertSuccessionControlOfferSource,
  prepareSuccessionControlOffer,
  applySuccessionEvent,
  decideSuccessionArrangement,
  type SuccessionEvent,
  type SuccessionCommand,
  type SuccessionControlExecutionEvent,
  type SuccessionControlOfferInput,
} from '@aivilization/society';
import {
  successionControlOfferTerms,
  SUCCESSION_CONTROL_OFFER_SOURCE_VERSION,
  samePrincipalRequest,
  type PrincipalControlChanged,
  type PrincipalControlRequest,
  type PrincipalAuthorization,
} from '@aivilization/authority';
import { decideMaterialPrincipalControl } from '@aivilization/materials';
import { decidePremisesPrincipalControl } from '@aivilization/premises';
import { tradeFactsEqual as equal } from '@aivilization/commerce';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import { assertResidentExitSnapshot } from './residentExitPreservation';
import { residentSuccessionPorts } from './residentSuccessionResources';
import { applyPrincipalResourceControlEffects } from './resourcePrincipalControlEffects';
import { worldPrincipalAvailable } from './resourcePrincipalAuthority';
export type ResidentSuccessionPayload =
  | {
      readonly policyVersion: typeof POLICY.version;
      readonly kind: 'enable';
      readonly actorId: 'system';
      readonly event: Extract<
        SuccessionControlExecutionEvent,
        { type: 'SuccessionControlExecutionsEnabled' }
      >;
    }
  | {
      readonly policyVersion: typeof POLICY.version;
      readonly kind: 'arrangement';
      readonly actorId: string;
      readonly event: SuccessionEvent;
    }
  | {
      readonly policyVersion: typeof POLICY.version;
      readonly kind: 'control-offer';
      readonly actorId: string;
      readonly event: Extract<
        SuccessionControlExecutionEvent,
        { type: 'SuccessionControlOfferRecorded' }
      >;
      readonly change: PrincipalControlChanged;
    };
type Context = {
  readonly projection: WorldProjection;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
};
function enabled(w: WorldProjection) {
  if (!w.residentExits || !w.successionControlExecutions)
    throw Error('succession-control-executions-not-enabled');
  assertResidentExitSnapshot(w);
  assertResidentSuccessionSnapshot(w);
  return w.residentExits;
}
export function assertResidentSuccessionSnapshot(w: WorldProjection) {
  if (!w.successionControlExecutions) return;
  if (!w.residentExits) throw Error('succession-real-exit-state-required');
  assertSuccessionControlExecutionsState(w.successionControlExecutions);
  for (const r of Object.values(w.successionControlExecutions.records)) {
    const a = w.residentExits.arrangements.arrangements[r.arrangementId],
      departure = w.residentExits.records[r.ownerId];
    if (
      !a ||
      a.status !== 'triggered' ||
      a.revision !== r.arrangementRevision ||
      a.termsRevision !== r.termsRevision ||
      a.ownerId !== r.ownerId ||
      a.executorId !== r.executorId ||
      a.beneficiaryId !== r.beneficiaryId ||
      a.trigger?.fact.eventId !== r.populationEventId ||
      !departure ||
      departure.populationEventId !== r.populationEventId ||
      departure.at > r.at ||
      !a.bindings.some(
        (b) =>
          b.kind === r.kind &&
          b.id === r.resourceId &&
          b.entitlementVersion === r.controlVersion &&
          b.duty === 'control-handover',
      )
    )
      throw Error('succession-execution-actual-arrangement-and-population-required');
  }
}
function wrap(input: Context, payload: ResidentSuccessionPayload) {
  const e = createEventEnvelope({
    id: `${input.requestId}:succession`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentSuccessionCommitted' as const,
    payload,
  });
  applyResidentSuccessionProjection(input.projection, e);
  return e;
}
export function enableResidentSuccessionEvent(input: Context) {
  return wrap(input, {
    policyVersion: POLICY.version,
    kind: 'enable',
    actorId: 'system',
    event: { type: 'SuccessionControlExecutionsEnabled', policy: POLICY },
  });
}
export function residentSuccessionArrangementEvent(
  input: Context & { readonly actorId: string; readonly command: SuccessionCommand },
) {
  try {
    const state = enabled(input.projection);
    const d = decideSuccessionArrangement(
      state.arrangements,
      input.actorId,
      input.projection.clock.now,
      input.command,
      residentSuccessionPorts(input.projection),
    );
    if (!d.accepted) return d;
    if (d.events.length !== 1) throw Error('succession-single-arrangement-event-required');
    return {
      accepted: true as const,
      events: [
        wrap(input, {
          policyVersion: POLICY.version,
          kind: 'arrangement',
          actorId: input.actorId,
          event: d.events[0]!,
        }),
      ],
    };
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-succession-arrangement',
    };
  }
}
function proofFor(
  w: WorldProjection,
  event: Extract<SuccessionControlExecutionEvent, { type: 'SuccessionControlOfferRecorded' }>,
) {
  const r = event.record,
    a = w.residentExits!.arrangements.arrangements[r.arrangementId]!;
  const source = {
    kind: 'succession' as const,
    policyVersion: SUCCESSION_CONTROL_OFFER_SOURCE_VERSION,
    executionId: r.id,
    arrangementId: r.arrangementId,
    arrangementRevision: r.arrangementRevision,
    termsRevision: r.termsRevision,
    populationEventId: r.populationEventId,
    beneficiaryId: r.beneficiaryId,
    executedAt: r.at,
    executeBefore: a.trigger!.executeBefore,
  };
  const request: PrincipalControlRequest = {
    resourceKind: r.kind,
    resourceId: r.resourceId,
    resourceRevision: r.sourceRevision,
    controlVersion: r.controlVersion,
    command: {
      type: 'offer',
      target: { kind: 'resident', id: r.beneficiaryId },
      expiresAt: r.expiresAt,
      terms: successionControlOfferTerms(source),
    },
  };
  const authorization: PrincipalAuthorization = {
    actorId: r.executorId,
    principal: { kind: 'resident', id: r.ownerId },
    request,
    source,
  };
  return { request, authorization };
}
export function residentSuccessionControlOfferEvent(
  input: Context & { readonly actorId: string; readonly offer: SuccessionControlOfferInput },
) {
  try {
    const w = input.projection,
      state = enabled(w),
      d = prepareSuccessionControlOffer(
        state.arrangements,
        w.successionControlExecutions!,
        input.actorId,
        w.clock.now,
        input.offer,
        residentSuccessionPorts(w),
      );
    if (!d.accepted) return d;
    if (d.event.type !== 'SuccessionControlOfferRecorded')
      throw Error('succession-control-offer-event-required');
    const { request, authorization } = proofFor(w, d.event);
    const ports = {
      actorId: input.actorId,
      at: w.clock.now,
      request,
      authorize: (principal: PrincipalAuthorization['principal'], r: PrincipalControlRequest) =>
        equal(principal, authorization.principal) && samePrincipalRequest(r, request)
          ? authorization
          : undefined,
      available: (p: PrincipalAuthorization['principal']) => worldPrincipalAvailable(w, p),
    };
    let change: PrincipalControlChanged;
    if (request.resourceKind === 'stock' && w.materials) {
      const own = decideMaterialPrincipalControl({ ...ports, state: w.materials });
      if (!own.accepted) return own;
      const e = own.events[0];
      if (own.events.length !== 1 || e?.type !== 'MaterialPrincipalControlChanged')
        throw Error('succession-single-resource-effect-required');
      change = e.change;
    } else if (request.resourceKind === 'premises' && w.premises) {
      const own = decidePremisesPrincipalControl({ ...ports, state: w.premises });
      if (!own.accepted) return own;
      if (own.event.type !== 'PremisesPrincipalControlChanged')
        throw Error('succession-single-resource-effect-required');
      change = own.event.change;
    } else
      return {
        accepted: false as const,
        reason: 'succession-owning-resource-adapter-not-connected',
      };
    return {
      accepted: true as const,
      events: [
        wrap(input, {
          policyVersion: POLICY.version,
          kind: 'control-offer',
          actorId: input.actorId,
          event: d.event,
          change,
        }),
      ],
    };
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-succession-control-offer',
    };
  }
}
function assertArrangementSource(
  w: WorldProjection,
  p: Extract<ResidentSuccessionPayload, { kind: 'arrangement' }>,
) {
  if (!w.agents[p.actorId]) throw Error('succession-current-personal-actor-required');
  const e = p.event,
    ports = residentSuccessionPorts(w);
  if (e.type === 'SuccessionArrangementCreated' || e.type === 'SuccessionArrangementRevised') {
    const terms = e.type === 'SuccessionArrangementCreated' ? e.arrangement : e.terms,
      sources =
        e.type === 'SuccessionArrangementCreated' ? e.arrangement.ownershipAtConsent : e.ownership;
    if (
      terms.ownerId !== p.actorId ||
      !ports.residentAvailable(terms.executorId) ||
      !ports.residentAvailable(terms.beneficiaryId) ||
      sources.length !== terms.bindings.length ||
      sources.some((f, i) => !equal(f, ports.resource(terms.bindings[i]!)))
    )
      throw Error('succession-arrangement-actual-resource-source-required');
    if ((e.type === 'SuccessionArrangementCreated' ? e.arrangement.at : e.at) !== w.clock.now)
      throw Error('succession-actual-arrangement-time-required');
  } else if (e.type === 'SuccessionConsentRecorded') {
    const a = w.residentExits!.arrangements.arrangements[e.id];
    if (
      e.consent.actorId !== p.actorId ||
      e.consent.at !== w.clock.now ||
      !a ||
      !ports.residentAvailable(a.ownerId)
    )
      throw Error('succession-actual-independent-consent-required');
  } else if (e.type === 'SuccessionArrangementWithdrawn') {
    if (e.actorId !== p.actorId || e.at !== w.clock.now)
      throw Error('succession-actual-owner-withdrawal-required');
  } else throw Error('succession-population-facts-need-atomic-exit');
}
export function applyResidentSuccessionProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentSuccessionCommitted') return undefined;
  const p = e.payload;
  if (
    p.policyVersion !== POLICY.version ||
    e.occurredAt !== w.clock.now ||
    !equal(
      Object.keys(p).sort(),
      [
        'policyVersion',
        'kind',
        'actorId',
        'event',
        ...(p.kind === 'control-offer' ? ['change'] : []),
      ].sort(),
    )
  )
    throw Error('invalid-succession-world-packet');
  if (p.kind === 'enable') {
    if (
      p.actorId !== 'system' ||
      p.event.type !== 'SuccessionControlExecutionsEnabled' ||
      !w.residentExits ||
      w.successionControlExecutions ||
      Object.keys(w.residentExits.records).length
    )
      throw Error('succession-explicit-empty-activation-required');
    const next = {
      ...w,
      successionControlExecutions: applySuccessionControlExecutionEvent(undefined, p.event),
    };
    assertResidentSuccessionSnapshot(next);
    return next;
  }
  const state = enabled(w);
  if (p.kind === 'arrangement') {
    assertArrangementSource(w, p);
    const next = {
      ...w,
      residentExits: { ...state, arrangements: applySuccessionEvent(state.arrangements, p.event) },
    };
    assertResidentExitSnapshot(next);
    assertResidentSuccessionSnapshot(next);
    return next;
  }
  if (
    p.kind !== 'control-offer' ||
    p.event.type !== 'SuccessionControlOfferRecorded' ||
    p.actorId !== p.event.record.executorId ||
    p.event.record.at !== w.clock.now
  )
    throw Error('invalid-succession-control-execution-packet');
  assertSuccessionControlOfferSource(
    state.arrangements,
    p.event.record,
    residentSuccessionPorts(w),
  );
  const { request, authorization } = proofFor(w, p.event);
  if (!equal(p.change.request, request) || !equal(p.change.control.authorization, authorization))
    throw Error('succession-control-actual-effect-scope-mismatch');
  const successionControlExecutions = applySuccessionControlExecutionEvent(
      w.successionControlExecutions,
      p.event,
    ),
    effects = applyPrincipalResourceControlEffects(w, p.change),
    next = { ...effects, successionControlExecutions };
  assertResidentExitSnapshot(next);
  assertResidentSuccessionSnapshot(next);
  return next;
}
