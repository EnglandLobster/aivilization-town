import type { WorldProjection } from '@aivilization/world';
/** At most three identifiers/deadlines; public original text, full ballots and old history remain explicit queries. */
export function publicGovernanceContext(world: WorldProjection, actorId: string, limit: number) {
  const s = world.publicGovernance?.authority;
  if (!s) return undefined;
  const at = world.clock.now;
  const pending = Object.values(s.proposals)
    .filter((p) => {
      if (p.procedureRevision !== s.procedureRevision) return false;
      if (p.status === 'voting')
        return p.procedure.electorate.includes(actorId) && !p.votes[actorId];
      const executors =
        p.procedure.executors === 'electorate' ? p.procedure.electorate : p.procedure.executors;
      return p.status === 'approved' && at < p.expiresAt && executors.includes(actorId);
    })
    .sort(
      (a, b) =>
        (a.status === 'voting' ? a.closesAt : a.expiresAt) -
          (b.status === 'voting' ? b.closesAt : b.expiresAt) || a.id.localeCompare(b.id, 'en'),
    );
  return {
    version: s.policy.version,
    jurisdictionId: s.grant.id,
    procedureRevision: s.procedureRevision,
    enactedPolicyRevision: world.governance?.revision ?? 0,
    pending: pending.slice(0, Math.max(0, Math.min(3, limit))).map((p) => ({
      id: p.id,
      revision: p.revision,
      status: p.status,
      kind: p.action.kind,
      closesAt: p.closesAt,
      expiresAt: p.expiresAt,
      readWith: 'town governance read',
    })),
    total: pending.length,
    expandedBy: 'town governance list',
    rulesWith: 'town governance status',
    fiscalWith: 'town city observe --view fiscal',
    ...(world.publicHousing ? { housingRulesWith: 'town governance housing' } : {}),
    ...(world.publicEmployment ? { employmentRulesWith: 'town governance employment' } : {}),
    note: 'Procedure facts only. Participation is optional; read exact terms before choosing.',
  };
}
