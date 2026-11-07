import {
  AGREED_LABOR_SOURCE,
  quoteWorldLaborCompensation,
  assertAgreedLaborCompensation,
} from './laborCompensationSource';
import { asAgentId } from '@aivilization/sim-core';
import { applyEnterpriseDomainEvent, serviceEmploymentTerms } from '@aivilization/enterprise';
import { calculateLaborPay } from '@aivilization/society';
import {
  serviceFactsEqual,
  type ServiceEngagement,
  type ServiceEngagementEvent,
  type ServiceAttendanceBody,
} from '@aivilization/services';
import type { WorldProjection } from './projection';
import type { WorldCommandPolicies } from './agentActions';
import {
  decideEarnedCompensation,
  applyEarnedCompensationProof,
  type EarnedWorkFact,
} from './earnedCompensation';
import type {
  ServiceClaimContext,
  ServiceCompensation,
  ServiceEnterpriseAccounting,
} from './serviceEmploymentModel';

export function serviceEmployer(w: WorldProjection, id: string) {
  const employers = Object.values(w.enterprises).filter((e) => {
    const c = e.serviceBusiness?.contracts[id];
    return c && c.phase !== 'revoked' && c.authorization.wageBasis !== 'none';
  });
  if (employers.length > 1) throw Error('service-has-multiple-employers');
  return employers[0];
}
function changed(events: readonly ServiceEngagementEvent[]) {
  return events.find((e) => e.type === 'ServiceEngagementChanged')?.engagement;
}
function activeRecord(w: WorldProjection, service: ServiceEngagement) {
  return Object.values(w.serviceEmployment?.claims ?? {}).find(
    (c) =>
      c.serviceId === service.id &&
      c.actorId === service.providerId &&
      c.startedAt === service.providerPresence?.startedAt,
  );
}
function fact(
  w: WorldProjection,
  c: ServiceClaimContext,
  after: ServiceEngagement,
  attendance?: ServiceAttendanceBody,
): EarnedWorkFact {
  const before = w.serviceEngagements!.engagements[c.serviceId]!,
    prior = w.enterprises[c.enterpriseId]?.earnedPayroll?.claims[c.id];
  // Actual attendance waiting is accounted by a separate, source-verified elapsed interval.
  const elapsedMs =
    (prior?.elapsedMs ?? 0) +
    after.progressMs -
    before.progressMs +
    (c.authorization.wageBasis === 'attendance' ? (attendance?.attendedMs ?? 0) : 0);
  return {
    actorId: c.actorId,
    startedAt: c.startedAt,
    plannedMs: c.plannedMs,
    settledAt: after.at,
    elapsedMs,
    ended: !after.providerPresence || after.providerPresence.startedAt !== c.startedAt,
  };
}
export function prepareServiceCompensation(input: {
  projection: WorldProjection;
  events: readonly ServiceEngagementEvent[];
  financial: readonly ServiceEnterpriseAccounting[];
  attendance?: ServiceAttendanceBody;
  actorId: string;
  eventId: string;
  nextSequence: number;
  policies?: WorldCommandPolicies;
  expectedEmploymentRevision?: number;
}): ServiceCompensation | undefined {
  const w = input.projection,
    after = changed(input.events);
  if (!w.serviceEmployment || !after) return undefined;
  const employer = serviceEmployer(w, after.id),
    before = w.serviceEngagements?.engagements[after.id];
  if (!employer || !before) {
    if (input.expectedEmploymentRevision !== undefined)
      throw Error('no-service-employment-to-accept');
    return undefined;
  }
  const prior = activeRecord(w, before),
    started = !before.providerPresence && after.providerPresence;
  if (
    !started &&
    (!before.providerPresence ||
      (after.providerPresence &&
        after.progressMs === before.progressMs &&
        !(input.attendance?.attendedMs && prior?.authorization.wageBasis === 'attendance')))
  )
    return undefined;
  let record: ServiceClaimContext;
  if (started) {
    const authorization = serviceEmploymentTerms(
        employer,
        after.id,
        asAgentId(input.actorId),
        w.clock.now,
      ),
      contract = employer.serviceBusiness!.contracts[after.id]!,
      policies = input.policies;
    if (
      !authorization ||
      (w.residentLabor!.configuration.compensationSource === AGREED_LABOR_SOURCE &&
        !authorization.wageTerms) ||
      !policies ||
      input.actorId !== after.providerId ||
      input.expectedEmploymentRevision !== contract.revision
    )
      throw Error('exact-current-service-employment-acceptance-required');
    const plannedMs = Math.min(started.until - started.startedAt, authorization.maxWorkMs);
    record = {
      id: `service-wage-${input.nextSequence}`,
      serviceId: after.id,
      actorId: after.providerId,
      enterpriseId: employer.enterpriseId,
      startedAt: started.startedAt,
      until: started.until,
      plannedMs,
      authorizationRevision: contract.revision,
      authorization,
      terms: quoteWorldLaborCompensation({
        configuration: w.residentLabor!.configuration,
        enterprise: employer,
        actorId: input.actorId,
        at: started.startedAt,
        durationMs: plannedMs,
        legacyQuote: authorization.wageOffer!,
        legacySource: 'recorded-employment-offer',
        ...(policies.tax ? { tax: policies.tax } : {}),
      }),
      lastSourceId: input.eventId,
      withheldMicros: 0,
    };
  } else {
    if (!prior) throw Error('service-source-wage-claim-required');
    record = { ...prior, lastSourceId: input.eventId };
  }
  let fundedEmployer = employer;
  for (const f of input.financial)
    if (f.enterpriseId === employer.enterpriseId)
      fundedEmployer = applyEnterpriseDomainEvent(fundedEmployer, f.event);
  const work = fact(w, record, after, input.attendance);
  const compensation = decideEarnedCompensation({
    enterprise: fundedEmployer,
    claimId: record.id,
    terms: record.terms,
    previouslyWithheldMicros: record.withheldMicros,
    pay:
      !started && (work.ended || after.at % w.residentLabor!.configuration.policy.cadenceMs === 0),
    transactionId: `${input.eventId}:pay`,
    work,
  });
  if (record.terms.taxMicros && w.treasury === undefined)
    throw Error('labor-tax-treasury-required');
  return { record: { ...record, withheldMicros: compensation.withheldMicros }, compensation };
}
export function applyServiceCompensation(input: {
  before: WorldProjection;
  after: WorldProjection;
  events: readonly ServiceEngagementEvent[];
  attendance?: ServiceAttendanceBody;
  employment?: ServiceCompensation;
  actorId: string;
  eventId: string;
}): WorldProjection {
  const w = input.before,
    next = input.after,
    e = changed(input.events),
    p = input.employment;
  if (!p) {
    if (
      w.serviceEmployment &&
      e &&
      serviceEmployer(w, e.id) &&
      (!!e.providerPresence !== !!w.serviceEngagements?.engagements[e.id]?.providerPresence ||
        e.progressMs !== w.serviceEngagements?.engagements[e.id]?.progressMs ||
        (input.attendance?.attendedMs &&
          serviceEmployer(w, e.id)?.serviceBusiness?.contracts[e.id]?.authorization.wageBasis ===
            'attendance'))
    )
      throw Error('service-payroll-proof-required');
    return next;
  }
  if (!w.serviceEmployment || !w.residentLabor || !e)
    throw Error('service-employment-source-required');
  const c = p.record,
    old = w.serviceEmployment.claims[c.id],
    before = w.serviceEngagements?.engagements[e.id],
    employer = serviceEmployer(w, e.id);
  if (
    !employer ||
    c.serviceId !== e.id ||
    c.enterpriseId !== employer.enterpriseId ||
    c.actorId !== e.providerId ||
    c.lastSourceId !== input.eventId ||
    c.withheldMicros !== p.compensation.withheldMicros
  )
    throw Error('service-wage-source-mismatch');
  if (!old) {
    const presence = e.providerPresence,
      contract = employer.serviceBusiness!.contracts[e.id]!;
    if (
      before?.providerPresence ||
      !presence ||
      input.actorId !== c.actorId ||
      !serviceEmploymentTerms(employer, e.id, asAgentId(c.actorId), w.clock.now) ||
      c.startedAt !== presence.startedAt ||
      c.until !== presence.until ||
      (w.residentLabor.configuration.compensationSource === AGREED_LABOR_SOURCE &&
        !c.authorization.wageTerms) ||
      c.authorizationRevision !== contract.revision ||
      !serviceFactsEqual(c.authorization, contract.authorization) ||
      c.plannedMs !== Math.min(c.until - c.startedAt, c.authorization.maxWorkMs) ||
      (w.residentLabor.configuration.compensationSource !== AGREED_LABOR_SOURCE &&
        (c.terms.wageSource !== 'recorded-employment-offer' ||
          c.terms.grossMicros !==
            Math.round(
              calculateLaborPay(
                c.authorization.wageOffer!,
                c.plannedMs / 1000,
                w.residentLabor.configuration.pay,
              ) * 1e6,
            )))
    )
      throw Error('service-wage-start-mismatch');
    assertAgreedLaborCompensation({
      configuration: w.residentLabor.configuration,
      enterprise: employer,
      actorId: c.actorId,
      at: c.startedAt,
      durationMs: c.plannedMs,
      terms: c.terms,
    });
  } else if (
    !before?.providerPresence ||
    old.lastSourceId === input.eventId ||
    !serviceFactsEqual(
      { ...c, lastSourceId: old.lastSourceId, withheldMicros: old.withheldMicros },
      old,
    )
  )
    throw Error('service-wage-immutable-terms-mismatch');
  const applied = applyEarnedCompensationProof({
    enterprise: next.enterprises[c.enterpriseId]!,
    claimId: c.id,
    actorId: c.actorId,
    terms: c.terms,
    previousWithheldMicros: old?.withheldMicros ?? 0,
    payload: p.compensation,
    transactionId: `${input.eventId}:pay`,
    work: fact(w, c, e, input.attendance),
  });
  if (applied.tax && next.treasury === undefined) throw Error('labor-tax-treasury-required');
  const actor = next.agents[c.actorId];
  if (!actor) throw Error('service-worker-required');
  return {
    ...next,
    enterprises: { ...next.enterprises, [c.enterpriseId]: applied.enterprise },
    agents: {
      ...next.agents,
      [c.actorId]: { ...actor, balance: actor.balance + (applied.paidMicros - applied.tax) / 1e6 },
    },
    ...(applied.tax ? { treasury: next.treasury! + applied.tax / 1e6 } : {}),
    serviceEmployment: {
      ...w.serviceEmployment,
      claims: { ...w.serviceEmployment.claims, [c.id]: structuredClone(c) },
    },
  };
}
