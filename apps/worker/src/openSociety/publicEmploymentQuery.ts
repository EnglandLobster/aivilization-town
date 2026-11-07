import { publicEmploymentAtCycle, publicEmploymentQuota } from '@aivilization/society';
import type { WorldProjection } from '@aivilization/world';
import { numberArg, pageItems, stringArg, ToolRefusal } from './arguments';
/** Only explicit queries expand occupation terms; ordinary context carries a pointer. */
export function publicEmploymentQuery(
  w: WorldProjection,
  actorId: string,
  args: Record<string, unknown>,
) {
  const s = w.publicEmployment;
  if (!s) throw new ToolRefusal('public-employment-not-enabled');
  const cycle = Math.floor(w.clock.now / s.cycleDurationMs),
    active = publicEmploymentAtCycle(s, cycle)!,
    next = publicEmploymentAtCycle(s, cycle + 1)!,
    latest = s.revisions[s.revisions.length - 1]!;
  const section = stringArg(args, 'section', 'rules');
  if (section !== 'rules' && section !== 'applications')
    throw new ToolRefusal('invalid-employment-query-section');
  if (section === 'applications') {
    if (args.revision !== undefined)
      throw new ToolRefusal('employment-applications-not-policy-revision');
    const own = w.jobApplications
      .filter((a) => a.agentId === actorId)
      .sort(
        (a, b) =>
          b.submittedAt - a.submittedAt ||
          (a.applicationId < b.applicationId ? -1 : a.applicationId > b.applicationId ? 1 : 0),
      );
    return {
      section,
      currentCycle: cycle,
      nextCycleAt: (cycle + 1) * s.cycleDurationMs,
      applications: pageItems(
        own.map((a) => ({ ...a })),
        args,
      ),
      scope:
        'Your recorded public job applications only. Pending is not admission; missing historical fields remain unknown. Policy revision selection does not reinterpret applications.',
      rulesWith: 'town governance employment',
    };
  }
  const revision = numberArg(args, 'revision', active.revision),
    selected = s.revisions.find((p) => p.revision === revision);
  if (!selected) throw new ToolRefusal('public-employment-revision-not-found');
  const { occupations, ...terms } = selected.terms;
  return {
    policyVersion: s.policyVersion,
    cycleDurationMs: s.cycleDurationMs,
    capacityScope: 'new-admissions-per-occupation-within-each-cycle',
    capacityMeaning:
      "Capacity limits this cycle's accepted applications, not the total number of existing job holders.",
    currentCycle: cycle,
    activeRevision: active.revision,
    nextCycleRevision: next.revision,
    latestRevision: latest.revision,
    revision: selected.revision,
    recordedAt: selected.recordedAt,
    effectiveCycle: selected.effectiveCycle,
    source: selected.source,
    terms,
    occupations: pageItems(occupations, args),
    ownApplications: {
      allowed: publicEmploymentQuota(active.terms, w.agents[actorId]!.residentialTier),
      used: w.jobApplications.filter((a) => a.agentId === actorId && a.cycleNumber === cycle)
        .length,
    },
    applicationsWith: 'town governance employment --section applications',
    proposalShape: {
      kind: 'set-employment',
      expectedRevision: latest.revision,
      terms:
        'Copy the complete terms plus every paged occupation into terms.occupations, then edit your proposed values.',
    },
    scope:
      'Initial public jobs only. Changes start next cycle; they neither retry an application nor change qualifications, private employment or wages.',
    historyWith: 'town governance employment --revision <revision>',
    procedureWith: 'town governance status',
  };
}
