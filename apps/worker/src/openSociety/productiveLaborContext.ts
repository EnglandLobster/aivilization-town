import type { WorldProjection } from '@aivilization/world';
export function ownProductiveLaborRecords(w: WorldProjection, actorId: string) {
  return Object.values(w.productiveEmployment?.claims ?? {}).filter((c) => c.actorId === actorId);
}
export function productiveLaborDetails(w: WorldProjection, id: string) {
  const record = w.productiveEmployment?.claims[id];
  if (!record) return undefined;
  return {
    source: record,
    terms: record.terms,
    claim: w.enterprises[record.enterpriseId]?.earnedPayroll?.claims[id],
    withheldMicros: record.withheldMicros,
    readProductionWith: `town production read --id ${record.productionId}`,
    stopWith: `town production leave --id ${record.productionId} --expected-revision PRODUCTION_REVISION`,
    claimWith: 'town business claim-wage --id ID --expected-revision CLAIM_REVISION',
  };
}
export function activeProductiveLaborContext(w: WorldProjection, actorId: string) {
  const records = ownProductiveLaborRecords(w, actorId).filter(
    (c) => w.enterprises[c.enterpriseId]?.earnedPayroll?.claims[c.id]?.status === 'active',
  );
  if (records.length > 1) throw Error('multiple-active-productive-claims');
  const c = records[0];
  if (!c) return undefined;
  const claim = w.enterprises[c.enterpriseId]!.earnedPayroll!.claims[c.id]!,
    job = w.materials!.productions[c.productionId]!;
  return {
    id: c.id,
    revision: job.revision,
    enterpriseId: c.enterpriseId,
    productionId: c.productionId,
    sourceKind: 'material-production',
    startedAt: c.startedAt,
    until: c.until,
    settledAt: claim.settledAt,
    elapsedMs: claim.elapsedMs,
    earned: claim.earnedMicros / 1e6,
    paidGross: claim.paidMicros / 1e6,
    stopWith: `town production leave --id ${c.productionId} --expected-revision ${job.revision}`,
  };
}
