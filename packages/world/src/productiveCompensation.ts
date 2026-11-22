import { quoteWorldLaborCompensation } from './laborCompensationSource';
import type { ControlAuthorizationPort } from '@aivilization/authority';
import { asAgentId } from '@aivilization/sim-core';
import {
  applyEnterpriseDomainEvent,
  decideEnableEarnedPayroll,
  decideAssignProductionEmployment,
  productionEmploymentWage,
} from '@aivilization/enterprise';
import type { MaterialEvent, MaterialProduction, MaterialReceipt } from '@aivilization/materials';
import type { WorldProjection } from './projection';
import type { WorldCommandPolicies } from './agentActions';
import {
  decideEarnedCompensation,
  applyEarnedCompensationProof,
  type EarnedWorkFact,
} from './earnedCompensation';
import type {
  ProductiveClaimContext,
  ProductiveMaterialEmployment,
} from './productiveEmploymentModel';

export function productionEmployer(w: WorldProjection, id: string) {
  const employers = Object.values(w.enterprises).filter((e) =>
    Object.hasOwn(e.productionEmployment?.assignments ?? {}, id),
  );
  if (employers.length > 1) throw Error('production-has-multiple-employers');
  return employers[0];
}
function source(events: readonly MaterialEvent[]) {
  const jobs = events.flatMap((e) =>
    e.type === 'MaterialProductionChanged' ? [e.production] : [],
  );
  const receipts = events.flatMap((e) => (e.type === 'MaterialReceiptRecorded' ? [e.receipt] : []));
  return { job: jobs[0], receipt: receipts[0] };
}
function workFact(
  record: ProductiveClaimContext,
  job: MaterialProduction,
  receipt: MaterialReceipt,
  priorMs: number,
): EarnedWorkFact {
  const effort = receipt.efforts.filter(
    (e) => e.actorId === record.actorId && e.productionId === record.productionId,
  );
  return {
    actorId: record.actorId,
    startedAt: record.startedAt,
    plannedMs: record.until - record.startedAt,
    settledAt: receipt.at,
    elapsedMs: priorMs + effort.reduce((sum, e) => sum + e.workMs, 0),
    ended:
      !job.session ||
      job.session.actorId !== record.actorId ||
      job.session.startedAt !== record.startedAt,
  };
}
export function prepareProductiveCompensation(input: {
  readonly authorize?: ControlAuthorizationPort;
  readonly projection: WorldProjection;
  readonly events: readonly MaterialEvent[];
  readonly actorId: string;
  readonly eventId: string;
  readonly nextSequence: number;
  readonly enterpriseId?: string;
  readonly policies?: WorldCommandPolicies;
}): ProductiveMaterialEmployment | undefined {
  const w = input.projection,
    { job, receipt } = source(input.events);
  if (input.enterpriseId) {
    if (
      !w.productiveEmployment ||
      !job ||
      !receipt ||
      !['create-production', 'create-extraction'].includes(receipt.operation)
    )
      throw Error('productive-employer-only-on-enabled-task-creation');
    let e = w.enterprises[input.enterpriseId];
    if (!e) throw Error('production-employer-missing');
    if (productionEmployer(w, job.id)) throw Error('production-employer-already-assigned');
    const events: Extract<
      ProductiveMaterialEmployment,
      { operation: 'assign' }
    >['events'][number][] = [];
    if (!e.earnedPayroll) {
      const d = decideEnableEarnedPayroll(e);
      if (!d.accepted) throw Error(d.reason);
      events.push(d.event);
      e = applyEnterpriseDomainEvent(e, d.event);
    }
    const d = decideAssignProductionEmployment({
      enterprise: e,
      ...(input.authorize ? { authorize: input.authorize } : {}),
      actorId: asAgentId(input.actorId),
      productionId: job.id,
      at: w.clock.now,
      authorizedWorkMs: job.quantity * job.recipe.workMs,
      workers: job.workers.map(asAgentId),
    });
    if (!d.accepted) throw Error(d.reason);
    events.push(d.event);
    return { operation: 'assign', enterpriseId: e.enterpriseId, events };
  }
  if (!w.productiveEmployment || !w.residentLabor || !job || !receipt) return undefined;
  const employer = productionEmployer(w, job.id);
  if (!employer) return undefined;
  const priorJob = w.materials?.productions[job.id];
  if (receipt.operation === 'start-production') {
    const session = job.session,
      policies = input.policies;
    if (!session || !policies) throw Error('productive-payroll-start-context-required');
    const wage = productionEmploymentWage(employer, job.id, asAgentId(input.actorId));
    if (wage === undefined) throw Error('current-authorized-production-employment-required');
    const record: ProductiveClaimContext = {
      id: `production-wage-${input.nextSequence}`,
      actorId: input.actorId,
      enterpriseId: employer.enterpriseId,
      productionId: job.id,
      startedAt: session.startedAt,
      until: session.until,
      terms: quoteWorldLaborCompensation({
        configuration: w.residentLabor.configuration,
        durationMs: session.until - session.startedAt,
        quotedWage: wage,
        wageSource: 'recorded-employment-offer',
        ...(policies.tax ? { tax: policies.tax } : {}),
      }),
      lastReceiptId: receipt.id,
      withheldMicros: 0,
    };
    if (record.terms.taxMicros && w.treasury === undefined)
      throw Error('labor-tax-treasury-required');
    return {
      operation: 'work',
      record,
      compensation: decideEarnedCompensation({
        enterprise: employer,
        claimId: record.id,
        terms: record.terms,
        previouslyWithheldMicros: 0,
        pay: false,
        transactionId: `${input.eventId}:pay`,
        work: workFact(record, job, receipt, 0),
      }),
    };
  }
  if (!priorJob?.session) return undefined;
  const records = Object.values(w.productiveEmployment.claims).filter(
    (c) =>
      c.productionId === job.id &&
      c.startedAt === priorJob.session!.startedAt &&
      c.actorId === priorJob.session!.actorId,
  );
  if (records.length !== 1) throw Error('productive-work-claim-source-missing');
  const prior = records[0]!,
    claim = employer.earnedPayroll?.claims[prior.id];
  if (!claim || claim.status !== 'active') throw Error('active-productive-claim-required');
  const work = workFact(prior, job, receipt, claim.elapsedMs);
  const compensation = decideEarnedCompensation({
    enterprise: employer,
    claimId: prior.id,
    terms: prior.terms,
    previouslyWithheldMicros: prior.withheldMicros,
    pay: work.ended || receipt.at % w.residentLabor.configuration.policy.cadenceMs === 0,
    transactionId: `${input.eventId}:pay`,
    work,
  });
  return {
    operation: 'work',
    record: { ...prior, lastReceiptId: receipt.id, withheldMicros: compensation.withheldMicros },
    compensation,
  };
}

export function applyProductiveMaterialCompensation(input: {
  readonly before: WorldProjection;
  readonly after: WorldProjection;
  readonly events: readonly MaterialEvent[];
  readonly employment?: ProductiveMaterialEmployment;
  readonly eventId: string;
}): WorldProjection {
  const w = input.before,
    p = input.employment,
    { job, receipt } = source(input.events);
  if (!p) {
    if (
      w.productiveEmployment &&
      job &&
      receipt &&
      productionEmployer(w, job.id) &&
      (receipt.operation === 'start-production' || w.materials?.productions[job.id]?.session)
    )
      throw Error('productive-material-needs-payroll-proof');
    return input.after;
  }
  if (!w.productiveEmployment || !job || !receipt)
    throw Error('invalid-productive-compensation-source');
  if (p.operation === 'assign') {
    if (
      w.materials?.productions[job.id] ||
      productionEmployer(w, job.id) ||
      !['create-production', 'create-extraction'].includes(receipt.operation) ||
      p.events.length < 1 ||
      p.events.length > 2
    )
      throw Error('invalid-production-employer-assignment');
    let enterprise = w.enterprises[p.enterpriseId];
    if (!enterprise) throw Error('production-employer-missing');
    let assignments = 0;
    for (const event of p.events) {
      if (event.type === 'EnterpriseProductionEmploymentAssigned') {
        assignments++;
        const a = event.assignment;
        if (
          a.productionId !== job.id ||
          a.authorizedBy !== receipt.actorId ||
          a.at !== receipt.at ||
          a.authorizedWorkMs !== job.quantity * job.recipe.workMs ||
          Object.keys(a.wageOffers).sort().join('\0') !== [...job.workers].sort().join('\0')
        )
          throw Error('production-assignment-source-mismatch');
      } else if (event.type !== 'EnterpriseEarnedPayrollEnabled')
        throw Error('invalid-production-assignment-event');
      enterprise = applyEnterpriseDomainEvent(enterprise, event);
    }
    if (assignments !== 1) throw Error('production-assignment-required');
    return {
      ...input.after,
      enterprises: { ...input.after.enterprises, [p.enterpriseId]: enterprise },
    };
  }
  const c = p.record,
    old = w.productiveEmployment.claims[c.id],
    employer = productionEmployer(w, job.id);
  if (
    !employer ||
    employer.enterpriseId !== c.enterpriseId ||
    c.productionId !== job.id ||
    c.lastReceiptId !== receipt.id ||
    c.withheldMicros !== p.compensation.withheldMicros
  )
    throw Error('productive-claim-source-mismatch');
  if (!old) {
    const session = job.session;
    if (
      receipt.operation !== 'start-production' ||
      receipt.actorId !== c.actorId ||
      !session ||
      session.actorId !== c.actorId ||
      session.startedAt !== c.startedAt ||
      session.until !== c.until ||
      productionEmploymentWage(employer, job.id, asAgentId(c.actorId)) === undefined ||
      c.terms.wageSource !== 'recorded-employment-offer'
    )
      throw Error('productive-claim-start-mismatch');
  } else {
    const sourceSession = w.materials?.productions[job.id]?.session;
    if (
      old.lastReceiptId === receipt.id ||
      !sourceSession ||
      sourceSession.actorId !== c.actorId ||
      sourceSession.startedAt !== c.startedAt ||
      sourceSession.until !== c.until ||
      ['actorId', 'enterpriseId', 'productionId', 'startedAt', 'until'].some(
        (k) => old[k as keyof ProductiveClaimContext] !== c[k as keyof ProductiveClaimContext],
      ) ||
      JSON.stringify(old.terms) !== JSON.stringify(c.terms)
    )
      throw Error('productive-claim-immutable-source-mismatch');
  }
  const prior = employer.earnedPayroll?.claims[c.id];
  const applied = applyEarnedCompensationProof({
    enterprise: employer,
    claimId: c.id,
    actorId: c.actorId,
    terms: c.terms,
    previousWithheldMicros: old?.withheldMicros ?? 0,
    payload: p.compensation,
    transactionId: `${input.eventId}:pay`,
    work: workFact(c, job, receipt, prior?.elapsedMs ?? 0),
  });
  if (applied.tax && w.treasury === undefined) throw Error('labor-tax-treasury-required');
  const actor = input.after.agents[c.actorId];
  if (!actor) throw Error('productive-worker-missing');
  return {
    ...input.after,
    enterprises: { ...input.after.enterprises, [c.enterpriseId]: applied.enterprise },
    agents: {
      ...input.after.agents,
      [c.actorId]: { ...actor, balance: actor.balance + (applied.paidMicros - applied.tax) / 1e6 },
    },
    ...(applied.tax ? { treasury: input.after.treasury! + applied.tax / 1e6 } : {}),
    productiveEmployment: {
      ...w.productiveEmployment,
      claims: { ...w.productiveEmployment.claims, [c.id]: structuredClone(c) },
    },
  };
}
