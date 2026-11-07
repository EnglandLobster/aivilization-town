import { pageItems, ToolRefusal } from './arguments';
import { ownProductiveLaborRecords, productiveLaborDetails } from './productiveLaborContext';
import { publicLaborDetails, activePublicLaborContext } from './publicLaborContext';
import type { WorldProjection } from '@aivilization/world';
import { activeProductiveLaborContext } from './productiveLaborContext';
/** Own work/creditor facts only; the employer's other employees and their finances stay out of this preview. */
export function ownLaborContext(world: WorldProjection, actorId: string) {
  const state = world.residentLabor;
  if (!state && !world.publicLabor) return undefined;
  const id = state?.process.activeByActor[actorId],
    s = id ? state?.process.sessions[id] : undefined;
  const claim = s ? world.enterprises[s.enterpriseId]?.earnedPayroll?.claims[s.id] : undefined;
  const unpaidMicros = Object.values(world.enterprises)
    .flatMap((e) => Object.values(e.earnedPayroll?.claims ?? {}))
    .filter((c) => c.actorId === actorId)
    .reduce((sum, c) => sum + c.earnedMicros - c.paidMicros, 0);
  return {
    ...(state?.configuration.compensationSource === 'accepted-enterprise-labor-terms-v1'
      ? {
          termsRequired: true,
          termsWith: 'town business labor-terms --enterprise-id ENTERPRISE_ID',
        }
      : {}),
    policyVersion:
      world.publicLabor?.configuration.policy.version ?? state!.configuration.policy.version,
    scope: world.publicLabor
      ? 'actual-private-and-prefunded-initial-public-work'
      : 'enterprise-employment-only-public-scenario-work-retains-its-recorded-policy',
    active: s
      ? {
          id: s.id,
          revision: s.revision,
          enterpriseId: s.enterpriseId,
          startedAt: s.startedAt,
          until: s.until,
          settledAt: s.settledAt,
          elapsedMs: s.elapsedMs,
          earned: (claim?.earnedMicros ?? 0) / 1e6,
          paidGross: (claim?.paidMicros ?? 0) / 1e6,
          stopWith: 'town life stop-work',
        }
      : (activePublicLaborContext(world, actorId) ??
        activeProductiveLaborContext(world, actorId) ??
        null),
    ownUnpaid: unpaidMicros / 1e6,
    readWith: 'town city observe --view labor',
    rulesWith: 'town city observe --view rules --section labor',
    claimWith: 'town business claim-wage',
  };
}

export function readOwnLabor(
  world: WorldProjection,
  actorId: string,
  id: string,
  args: Readonly<Record<string, unknown>>,
) {
  const labor = world.residentLabor;
  if (!labor && !world.publicLabor) throw new ToolRefusal('resident-labor-not-enabled');
  if (id) {
    const s = labor?.process.sessions[id];
    if (s?.actorId === actorId)
      return {
        session: s,
        terms: labor!.termsBySession[s.id],
        claim: world.enterprises[s.enterpriseId]?.earnedPayroll?.claims[s.id],
        withheldMicros: labor!.withheldMicrosBySession[s.id] ?? 0,
        claimWith: 'town business claim-wage --id ID --expected-revision CLAIM_REVISION',
      };
    const publicWork = publicLaborDetails(world, id);
    if (publicWork?.session.actorId === actorId) return publicWork;
    const productive = productiveLaborDetails(world, id);
    if (productive?.source.actorId === actorId) return productive;
    throw new ToolRefusal('own-labor-not-found');
  }
  const entries = [
    ...Object.values(labor?.process.sessions ?? {})
      .filter((s) => s.actorId === actorId)
      .map((s) => ({
        id: s.id,
        revision: s.revision,
        startedAt: s.startedAt,
        status: s.status,
        elapsedMs: s.elapsedMs,
        enterpriseId: s.enterpriseId,
        sourceKind: 'enterprise-work',
      })),
    ...ownProductiveLaborRecords(world, actorId).map((c) => {
      const claim = world.enterprises[c.enterpriseId]!.earnedPayroll!.claims[c.id]!;
      return {
        id: c.id,
        revision: claim.revision,
        startedAt: c.startedAt,
        status: claim.status,
        elapsedMs: claim.elapsedMs,
        enterpriseId: c.enterpriseId,
        sourceKind: 'source-work',
      };
    }),
    ...Object.values(world.publicLabor?.process.sessions ?? {})
      .filter((s) => s.actorId === actorId)
      .map((s) => ({
        id: s.id,
        revision: s.revision,
        startedAt: s.startedAt,
        status: s.status,
        elapsedMs: s.elapsedMs,
        sourceKind: 'initial-public-employment-regime',
      })),
  ];
  return pageItems(
    entries
      .sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(({ startedAt: _, ...entry }) => {
        void _;
        return { ...entry, readWith: `town city observe --view labor --section ${entry.id}` };
      }),
    args,
  );
}
