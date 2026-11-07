import type { WorldProjection } from '@aivilization/world';
export function ownServiceLaborRecords(w: WorldProjection, actorId: string) {
  return Object.values(w.serviceEmployment?.claims ?? {}).filter((c) => c.actorId === actorId);
}
export function serviceLaborDetails(w: WorldProjection, id: string) {
  const record = w.serviceEmployment?.claims[id];
  if (!record) return undefined;
  return {
    source: record,
    terms: record.terms,
    claim: w.enterprises[record.enterpriseId]?.earnedPayroll?.claims[id],
    withheldMicros: record.withheldMicros,
    readServiceWith: `town engagements read --id ${record.serviceId}`,
    stopWith: `town engagements leave --id ${record.serviceId} --expected-revision SERVICE_REVISION`,
    claimWith: 'town business claim-wage --id ID --expected-revision CLAIM_REVISION',
  };
}
export function activeServiceLaborContext(w: WorldProjection, actorId: string) {
  const records = ownServiceLaborRecords(w, actorId).filter(
    (c) => w.enterprises[c.enterpriseId]?.earnedPayroll?.claims[c.id]?.status === 'active',
  );
  if (records.length > 1) throw Error('multiple-active-service-wage-claims');
  const c = records[0];
  if (!c) return undefined;
  const claim = w.enterprises[c.enterpriseId]!.earnedPayroll!.claims[c.id]!,
    e = w.serviceEngagements!.engagements[c.serviceId]!;
  return {
    id: c.id,
    sourceKind: 'actual-service',
    serviceId: c.serviceId,
    revision: e.revision,
    enterpriseId: c.enterpriseId,
    wageBasis: c.authorization.wageBasis,
    startedAt: c.startedAt,
    until: c.until,
    settledAt: claim.settledAt,
    elapsedMs: claim.elapsedMs,
    earned: claim.earnedMicros / 1e6,
    paidGross: claim.paidMicros / 1e6,
    readWith: `town city observe --view labor --section ${c.id}`,
    stopWith: `town engagements leave --id ${c.serviceId} --expected-revision ${e.revision}`,
  };
}
