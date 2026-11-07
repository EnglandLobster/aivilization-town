import { createEventEnvelope } from '@aivilization/sim-core';
import {
  enablePublicHousingAuthority,
  publicEqual,
  type PublicProposal,
} from '@aivilization/governance';
import {
  publicHousingAt,
  publicHousingPolicies,
  initialPublicHousing,
  inheritedPublicHousingTerms,
  assertPublicHousingState,
  applyPublicHousingEvent,
  type PublicHousingChanged,
} from '@aivilization/society';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { WorldCommandPolicies } from './agentActions';
export function enablePublicHousingEvent(input: {
  projection: WorldProjection;
  policies: WorldCommandPolicies;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  const w = input.projection,
    p = input.policies;
  if (
    w.publicHousing ||
    !w.publicGovernance ||
    !w.housingChoice ||
    !p.residentialUpkeep ||
    !p.residentialTierUpgrade
  )
    throw Error('public-housing-requires-public-authority-choice-and-policy');
  if (p.timeSettlementAmortization) throw Error('public-housing-requires-exact-time-settlement');
  enablePublicHousingAuthority(w.publicGovernance.authority);
  const state = initialPublicHousing({
    at: w.clock.now,
    terms: inheritedPublicHousingTerms(
      p.residentialUpkeep,
      p.residentialTierUpgrade,
      w.housingChoice.availableTiers,
    ),
    sourceVersion: p.residentialUpkeep.policyVersion ?? 'unversioned-inherited-housing-policy',
    ...(p.residentialUpkeep.arrearsDowngradeThresholdHours === undefined
      ? {}
      : {
          legacyArrearsDowngradeThresholdHours: p.residentialUpkeep.arrearsDowngradeThresholdHours,
        }),
  });
  return createEventEnvelope({
    id: input.requestId,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: w.clock.now,
    type: 'ResidentPublicHousingEnabled',
    payload: { state },
  });
}
export function applyPublicHousingActivation(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentPublicHousingEnabled') return undefined;
  const s = e.payload.state;
  assertPublicHousingState(s);
  if (
    w.publicHousing ||
    !w.publicGovernance ||
    !w.housingChoice ||
    e.occurredAt !== w.clock.now ||
    s.revisions.length !== 1 ||
    s.revisions[0]!.effectiveAt !== w.clock.now ||
    !publicEqual(
      s.revisions[0]!.terms.standards.map((t) => t.tier).sort((a, b) => a - b),
      [...w.housingChoice.availableTiers].sort((a, b) => a - b),
    )
  )
    throw Error('invalid-public-housing-activation');
  return {
    ...w,
    publicGovernance: {
      ...w.publicGovernance,
      authority: enablePublicHousingAuthority(w.publicGovernance.authority),
    },
    publicHousing: structuredClone(s),
  };
}
export function applyApprovedHousing(
  w: WorldProjection,
  p: PublicProposal,
  actorId: string,
  change: PublicHousingChanged,
): WorldProjection {
  if (
    !w.publicHousing ||
    !w.publicGovernance?.authority.grant.housing ||
    p.action.kind !== 'set-housing' ||
    change.previousRevision !== p.action.expectedRevision ||
    change.policy.effectiveAt !== w.clock.now ||
    !publicEqual(change.policy.terms, p.action.terms) ||
    !publicEqual(change.policy.source, {
      kind: 'public-decision',
      proposalId: p.id,
      actorId,
      procedureRevision: p.procedureRevision,
    })
  )
    throw Error('public-housing-effect-mismatch');
  return { ...w, publicHousing: applyPublicHousingEvent(w.publicHousing, change) };
}
/** Price and eligibility are institutional facts. Physical capacity, private leases and physiology stay in their own domains. */
export function publicHousingWorldPolicies(
  w: WorldProjection,
  policies: WorldCommandPolicies,
): WorldCommandPolicies {
  if (!w.publicHousing) return policies;
  if (policies.timeSettlementAmortization)
    throw Error('public-housing-requires-exact-time-settlement');
  const current = publicHousingAt(w.publicHousing, w.clock.now);
  if (!current) throw Error('missing-active-public-housing-policy');
  const p = publicHousingPolicies(current);
  return { ...policies, residentialUpkeep: p.upkeep, residentialTierUpgrade: p.upgrade };
}
export function publicHousingSource(w: WorldProjection): {
  readonly publicHousingRevision?: number;
} {
  if (!w.publicHousing) return {};
  const current = publicHousingAt(w.publicHousing, w.clock.now);
  if (!current) throw Error('missing-active-public-housing-policy');
  return { publicHousingRevision: current.revision };
}
/** Validate recorded source versions, not a fresh decision under today's prices. */
export function assertPublicHousingEventSource(w: WorldProjection, e: WorldEvent): void {
  if (e.type === 'ResidentialTierDowngraded' && w.publicHousing)
    throw Error('forced-housing-standard-change-disabled');
  if (
    e.type !== 'ResidentialTierUpgraded' &&
    e.type !== 'ResidentialUpkeepCharged' &&
    e.type !== 'ResidentialUpkeepArrearsUpdated'
  )
    return;
  if (e.payload.publicHousingRevision !== publicHousingSource(w).publicHousingRevision)
    throw Error('housing-event-policy-source-mismatch');
}
