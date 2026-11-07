import { publicHousingAt } from '@aivilization/society';
import type { WorldProjection } from '@aivilization/world';
import { numberArg, pageItems, ToolRefusal } from './arguments';
/** A bounded exact query, never an automatically injected tariff table. */
export function publicHousingQuery(w: WorldProjection, args: Record<string, unknown>) {
  const s = w.publicHousing;
  if (!s) throw new ToolRefusal('public-housing-not-enabled');
  const active = publicHousingAt(s, w.clock.now)!;
  const revision = numberArg(args, 'revision', active.revision),
    selected = s.revisions.find((p) => p.revision === revision);
  if (!selected) throw new ToolRefusal('public-housing-revision-not-found');
  return {
    policyVersion: s.policyVersion,
    activeRevision: active.revision,
    latestRevision: s.revisions.at(-1)!.revision,
    revision: selected.revision,
    effectiveAt: selected.effectiveAt,
    source: selected.source,
    terms: { landValueCoefficientPerHour: selected.terms.landValueCoefficientPerHour },
    standards: pageItems(selected.terms.standards, args),
    arrearsMode: s.arrearsMode,
    legacyArrearsDowngradeThresholdHours: s.legacyArrearsDowngradeThresholdHours,
    proposalShape: {
      kind: 'set-housing',
      expectedRevision: active.revision,
      terms: 'Copy terms plus ALL pages into terms.standards before editing.',
    },
    scope:
      'Initial external housing service tariff and upgrade eligibility only. Effective on approved execution. No private rent, physical capacity, body, debt forgiveness or new service tiers.',
    ownStandardWith: 'town housing standard',
    historyWith: 'town governance housing --revision <revision>',
    procedureWith: 'town governance status',
  };
}
