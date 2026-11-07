import {
  prepareEarnedWageEstatePayment,
  applyEarnedWageEstatePayment,
  assertEndedEstateWageCreditor,
} from './earnedWageEstate';
import { createEventEnvelope } from '@aivilization/sim-core';
import { decideEarnedCompensation, applyEarnedCompensationProof } from './earnedCompensation';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
type WageRequest = {
  projection: WorldProjection;
  actorId: string;
  id: string;
  expectedRevision: number;
  requestId: string;
  simulationId: string;
  nextSequence: number;
};
export function claimServiceWageEvent(input: WageRequest): WorldEvent {
  return wageEvent(input, false);
}
/** Internal settlement of an original ended debt; no departed-resident command is impersonated. */
export function settleDepartedServiceWageEvent(input: Omit<WageRequest, 'actorId'>): WorldEvent {
  return wageEvent({ ...input, actorId: 'system' }, true);
}
function wageEvent(input: WageRequest, departed: boolean): WorldEvent {
  const w = input.projection,
    c = w.serviceEmployment?.claims[input.id];
  if (!c || (!departed && (c.actorId !== input.actorId || !w.agents[c.actorId])))
    throw Error('own-service-wage-required');
  const enterprise = w.enterprises[c.enterpriseId],
    claim = enterprise?.earnedPayroll?.claims[c.id];
  if (!enterprise || claim?.revision !== input.expectedRevision)
    throw Error('earned-wage-revision-conflict');
  if (departed) assertEndedEstateWageCreditor(w, c.actorId, claim);
  const id = `${input.requestId}:service-wage`,
    compensation = decideEarnedCompensation({
      enterprise,
      claimId: c.id,
      terms: c.terms,
      previouslyWithheldMicros: c.withheldMicros,
      pay: true,
      transactionId: `${id}:pay`,
    });
  const verified = departed
    ? applyEarnedCompensationProof({
        enterprise,
        claimId: c.id,
        actorId: c.actorId,
        terms: c.terms,
        previousWithheldMicros: c.withheldMicros,
        payload: compensation,
        transactionId: `${id}:pay`,
      })
    : undefined;
  const estatePayment = verified
    ? prepareEarnedWageEstatePayment(w, {
        actorId: c.actorId,
        enterpriseId: c.enterpriseId,
        claimId: c.id,
        claimRevision: verified.enterprise.earnedPayroll!.claims[c.id]!.revision,
        transactionId: `${id}:pay`,
        paidMicros: verified.paidMicros,
        tax: verified.tax,
      })
    : undefined;
  return createEventEnvelope({
    id,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: w.clock.now,
    type: 'ResidentServiceWagePaid',
    payload: {
      actorId: input.actorId,
      claimId: c.id,
      compensation,
      ...(estatePayment ? { estatePayment } : {}),
    },
  });
}
export function applyServiceWagePaid(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentServiceWagePaid') return undefined;
  const p = e.payload,
    c = w.serviceEmployment?.claims[p.claimId];
  if (
    !c ||
    (p.estatePayment ? p.actorId !== 'system' : c.actorId !== p.actorId) ||
    e.occurredAt !== w.clock.now
  )
    throw Error('own-service-wage-required');
  const enterprise = w.enterprises[c.enterpriseId],
    actor = w.agents[c.actorId];
  if (!enterprise || (!actor && !p.estatePayment))
    throw Error('service-creditor-or-enterprise-missing');
  const claim = enterprise.earnedPayroll?.claims[c.id];
  if (p.estatePayment) assertEndedEstateWageCreditor(w, c.actorId, claim);
  const a = applyEarnedCompensationProof({
    enterprise,
    claimId: c.id,
    actorId: c.actorId,
    terms: c.terms,
    previousWithheldMicros: c.withheldMicros,
    payload: p.compensation,
    transactionId: `${e.id}:pay`,
  });
  if (a.tax && w.treasury === undefined) throw Error('labor-tax-treasury-required');
  const residentExits = p.estatePayment
    ? applyEarnedWageEstatePayment(
        w,
        {
          actorId: c.actorId,
          enterpriseId: c.enterpriseId,
          claimId: c.id,
          claimRevision: a.enterprise.earnedPayroll!.claims[c.id]!.revision,
          transactionId: `${e.id}:pay`,
          paidMicros: a.paidMicros,
          tax: a.tax,
        },
        p.estatePayment,
      )
    : undefined;

  return {
    ...w,
    enterprises: { ...w.enterprises, [c.enterpriseId]: a.enterprise },
    ...(residentExits ? { residentExits } : {}),
    agents: actor
      ? {
          ...w.agents,
          [c.actorId]: { ...actor, balance: actor.balance + (a.paidMicros - a.tax) / 1e6 },
        }
      : w.agents,
    ...(a.tax ? { treasury: w.treasury! + a.tax / 1e6 } : {}),
    serviceEmployment: {
      ...w.serviceEmployment,
      claims: { ...w.serviceEmployment.claims, [c.id]: { ...c, withheldMicros: a.withheld } },
    },
  };
}
