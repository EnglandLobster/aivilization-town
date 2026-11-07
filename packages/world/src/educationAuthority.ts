import { createEventEnvelope } from '@aivilization/sim-core';
import {
  EDUCATION_AUTHORITY_VERSION,
  evaluateAutomaticPromotion,
  recognizeInitialQualification,
  validateEducationSystemPolicy,
  type EducationSystemPolicy,
  type QualificationOrigin,
} from '@aivilization/society';
import type { WorldEvent } from './events';
import type { WorldProjection } from './projection';
import type { WorldCommandPolicies } from './agentActions';
export type EducationAuthorityState = {
  readonly policyVersion: typeof EDUCATION_AUTHORITY_VERSION;
  readonly institution: EducationSystemPolicy;
  readonly enabledAt: number;
};
export type EducationAuthorityEnabledPayload = EducationAuthorityState & {
  readonly mode: 'scenario' | 'legacy';
  readonly origins: Readonly<Record<string, QualificationOrigin>>;
};
export function assertEducationAuthorityState(w: WorldProjection): void {
  if (!w.educationAuthority) return;
  if (w.educationAuthority.policyVersion !== EDUCATION_AUTHORITY_VERSION)
    throw Error('unsupported-education-authority');
  validateEducationSystemPolicy(w.educationAuthority.institution);
  for (const a of Object.values(w.agents)) {
    if (
      a.educationLevel === undefined ||
      !Number.isInteger(a.educationLevel) ||
      a.educationLevel < 0 ||
      a.educationLevel > 5 ||
      !a.qualificationOrigin ||
      a.qualificationOrigin.institutionPolicyVersion !==
        w.educationAuthority.institution.policyVersion
    )
      throw Error('missing-authoritative-qualification');
  }
}
export function enableEducationAuthorityEvent(input: {
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicies;
  readonly mode: 'scenario' | 'legacy';
  readonly simulationId: string;
  readonly requestId: string;
  readonly nextSequence: number;
}): WorldEvent {
  const w = input.projection,
    institution = input.policies.educationSystem;
  if (
    w.educationAuthority ||
    !w.residentStudy ||
    !w.residentRest ||
    !institution?.enabled ||
    (input.mode === 'scenario' && w.clock.now !== 0)
  )
    throw Error('education-authority-needs-explicit-elapsed-study-institution');
  if (!educationAuthorityFactsEqual(institution, w.residentStudy.configuration.education))
    throw Error('education-institution-policy-mismatch');
  const origins = Object.fromEntries(
    Object.entries(w.agents).map(([id, a]) => [
      id,
      recognizeInitialQualification({
        educationScore: a.educationScore,
        ...(a.educationLevel === undefined ? {} : { educationLevel: a.educationLevel }),
        at: w.clock.now,
        mode: input.mode,
        policy: institution,
      }),
    ]),
  );
  return createEventEnvelope({
    id: `${input.requestId}:education-authority`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: w.clock.now,
    type: 'ResidentEducationAuthorityEnabled',
    payload: {
      policyVersion: EDUCATION_AUTHORITY_VERSION,
      institution: structuredClone(institution),
      enabledAt: w.clock.now,
      mode: input.mode,
      origins,
    } satisfies EducationAuthorityEnabledPayload,
  });
}
export function applyEducationAuthorityProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentEducationAuthorityEnabled') return undefined;
  const p = e.payload;
  if (
    w.educationAuthority ||
    !w.residentStudy ||
    !w.residentRest ||
    p.policyVersion !== EDUCATION_AUTHORITY_VERSION ||
    p.enabledAt !== w.clock.now ||
    e.occurredAt !== w.clock.now ||
    !['scenario', 'legacy'].includes(p.mode) ||
    (p.mode === 'scenario' && w.clock.now !== 0) ||
    !educationAuthorityFactsEqual(p.institution, w.residentStudy.configuration.education)
  )
    throw Error('invalid-education-authority-activation');
  if (Object.keys(p.origins).length !== Object.keys(w.agents).length)
    throw Error('qualification-activation-membership-mismatch');
  const agents = Object.fromEntries(
    Object.entries(w.agents).map(([id, a]) => {
      const expected = recognizeInitialQualification({
        educationScore: a.educationScore,
        ...(a.educationLevel === undefined ? {} : { educationLevel: a.educationLevel }),
        at: e.occurredAt,
        mode: p.mode,
        policy: p.institution,
      });
      if (!educationAuthorityFactsEqual(p.origins[id], expected))
        throw Error('invalid-qualification-origin');
      return [id, { ...a, educationLevel: expected.level, qualificationOrigin: expected }];
    }),
  );
  return {
    ...w,
    agents,
    educationAuthority: {
      policyVersion: p.policyVersion,
      institution: structuredClone(p.institution),
      enabledAt: p.enabledAt,
    },
  };
}
/** Validate recorded recognition against its previously recorded source, not current score-derived grades. */
export function assertFormalPromotion(
  w: WorldProjection,
  e: Extract<WorldEvent, { type: 'EducationLevelChanged' }>,
): void {
  if (!w.educationAuthority) return;
  const p = e.payload,
    a = w.agents[p.agentId],
    policy = w.educationAuthority.institution;
  if (
    !a ||
    a.educationLevel !== p.previousLevel ||
    p.nextLevel !== p.previousLevel + 1 ||
    p.nextLevel > 5
  )
    throw Error('invalid-formal-promotion');
  if (p.reason === 'compulsory-automatic-promotion') {
    if (
      evaluateAutomaticPromotion({ level: p.previousLevel, score: a.educationScore, policy }) !==
        p.nextLevel ||
      p.track !== undefined ||
      e.occurredAt % w.residentStudy!.configuration.source.formalPromotionCadenceMs !== 0
    )
      throw Error('unearned-compulsory-promotion');
  } else {
    const admitted = w.educationExamApplications.find(
      (x) =>
        x.agentId === p.agentId &&
        x.targetLevel === p.nextLevel &&
        x.status === 'admitted' &&
        x.resolvedAt === e.occurredAt &&
        p.reason === `education-exam-admission:cycle-${x.cycleNumber}`,
    );
    if (!admitted || admitted.admittedTrack !== p.track)
      throw Error('formal-promotion-requires-recorded-admission');
  }
}

/** Journal JSON may reorder object keys; authority facts compare by value, never insertion order. */
export function educationAuthorityFactsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.entries(left),
    b = Object.entries(right);
  return (
    a.length === b.length &&
    a.every(
      ([key, value]) =>
        Object.hasOwn(right, key) &&
        educationAuthorityFactsEqual(value, (right as Record<string, unknown>)[key]),
    )
  );
}
