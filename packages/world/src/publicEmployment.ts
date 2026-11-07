import { createEventEnvelope } from '@aivilization/sim-core';
import {
  enablePublicEmploymentAuthority,
  publicEqual,
  type PublicProposal,
} from '@aivilization/governance';
import {
  publicEmploymentAtCycle,
  publicRecruitmentPolicy,
  initialPublicEmployment,
  inheritedPublicEmploymentTerms,
  assertPublicEmploymentState,
  applyPublicEmploymentEvent,
  type PublicEmploymentChanged,
} from '@aivilization/society';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { WorldCommandPolicies } from './agentActions';

export function enablePublicEmploymentEvent(input: {
  projection: WorldProjection;
  policies: WorldCommandPolicies;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  const w = input.projection,
    p = input.policies.jobApplication;
  if (w.publicEmployment || !w.publicGovernance || !p?.recruitmentCycle)
    throw Error('public-employment-requires-public-authority-and-recruitment');
  enablePublicEmploymentAuthority(w.publicGovernance.authority);
  const state = initialPublicEmployment({
    at: w.clock.now,
    cycleDurationMs: p.recruitmentCycle.cycleDurationMs,
    terms: inheritedPublicEmploymentTerms(p.quotaByResidentialTier, p.recruitmentCycle),
    sourceVersion: p.recruitmentCycle.policyVersion,
  });
  return createEventEnvelope({
    id: `${input.requestId}:employment`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: w.clock.now,
    type: 'ResidentPublicEmploymentEnabled',
    payload: { state },
  });
}
export function applyPublicEmploymentActivation(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentPublicEmploymentEnabled') return undefined;
  const s = e.payload.state;
  assertPublicEmploymentState(s);
  if (
    w.publicEmployment ||
    !w.publicGovernance ||
    e.occurredAt !== w.clock.now ||
    s.revisions.length !== 1 ||
    s.revisions[0]!.recordedAt !== w.clock.now
  )
    throw Error('invalid-public-employment-activation');
  return {
    ...w,
    publicGovernance: {
      ...w.publicGovernance,
      authority: enablePublicEmploymentAuthority(w.publicGovernance.authority),
    },
    publicEmployment: structuredClone(s),
  };
}
/** Validate the exact frozen authorization and recorded institutional fact. Replay never reruns a ballot. */
export function applyApprovedEmployment(
  w: WorldProjection,
  p: PublicProposal,
  actorId: string,
  change: PublicEmploymentChanged,
): WorldProjection {
  if (
    !w.publicEmployment ||
    !w.publicGovernance?.authority.grant.employment ||
    p.action.kind !== 'set-employment' ||
    change.previousRevision !== p.action.expectedRevision ||
    change.policy.recordedAt !== w.clock.now ||
    !publicEqual(change.policy.terms, p.action.terms) ||
    !publicEqual(change.policy.source, {
      kind: 'public-decision',
      proposalId: p.id,
      actorId,
      procedureRevision: p.procedureRevision,
    })
  )
    throw Error('public-employment-effect-mismatch');
  return { ...w, publicEmployment: applyPublicEmploymentEvent(w.publicEmployment, change) };
}

/** Preserve the caller's population read model, but bind recruitment cadence to the recorded institution. */
export function publicEmploymentWorldPolicies(
  w: WorldProjection,
  policies: WorldCommandPolicies,
): WorldCommandPolicies {
  if (!w.publicEmployment) return policies;
  const p = policies.jobApplication;
  if (!p) throw Error('public-employment-requires-application-policy');
  const current = publicEmploymentAtCycle(
    w.publicEmployment,
    Math.floor(w.clock.now / w.publicEmployment.cycleDurationMs),
  );
  if (!current) throw Error('missing-active-public-employment-policy');
  return {
    ...policies,
    jobApplication: {
      ...p,
      quotaByResidentialTier: current.terms.quotaByResidentialTier,
      recruitmentCycle: publicRecruitmentPolicy(
        w.publicEmployment,
        Math.floor(w.clock.now / w.publicEmployment.cycleDurationMs),
      )!,
    },
  };
}

/** Admission/settlement events identify the frozen institution they actually used. Legacy events carry no invented source. */
export function assertPublicEmploymentEventSource(w: WorldProjection, e: WorldEvent): void {
  if (
    e.type !== 'JobApplicationSubmitted' &&
    e.type !== 'JobApplicationResolved' &&
    e.type !== 'RecruitmentCycleCompleted'
  )
    return;
  const s = w.publicEmployment,
    revision = e.payload.publicEmploymentRevision;
  if (!s) {
    if (revision !== undefined) throw Error('employment-event-without-institution');
    return;
  }
  const policy = publicEmploymentAtCycle(s, e.payload.cycleNumber);
  if (revision !== policy?.revision) throw Error('employment-event-policy-source-mismatch');
  if (
    e.type === 'JobApplicationSubmitted' &&
    Math.floor(e.occurredAt / s.cycleDurationMs) !== e.payload.cycleNumber
  )
    throw Error('employment-application-cycle-mismatch');
  if (
    e.type !== 'JobApplicationSubmitted' &&
    policy &&
    e.occurredAt !== (e.payload.cycleNumber + 1) * s.cycleDurationMs
  )
    throw Error('employment-resolution-cycle-mismatch');
}
