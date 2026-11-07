import { jobTiers, occupations, commodities } from '@aivilization/content';
import {
  calculateEffectiveKnowledgeThreshold,
  evaluateOccupationRequirements,
  type OccupationApplicationDecision,
  type OccupationApplicationAgentState,
} from './occupation';
import type { RecruitmentCyclePolicy } from './recruitment';

export const PUBLIC_EMPLOYMENT_POLICY = {
  version: 'resident-public-employment-rules-v1',
  maxRevisions: 10000,
  maxQuota: 100,
  maxCapacity: 10000,
  maxHousingBands: 32,
} as const;
export type EmploymentRankingField = 'knowledge' | 'housing' | 'submitted';
export type PublicOccupationRule = {
  readonly occupationName: string;
  readonly minimumResidentialTier: number;
  readonly educationFloor: number;
  readonly eligibilityShare: number;
  readonly prerequisiteCommodity: string | null;
};
export type PublicEmploymentTerms = {
  readonly occupations: readonly PublicOccupationRule[];
  readonly quotaByResidentialTier: readonly number[];
  readonly ranking: readonly EmploymentRankingField[];
  readonly defaultOccupationCapacity: number;
  readonly occupationCapacityOverrides: Readonly<Record<string, number>>;
};
export type PublicEmploymentRevision = {
  readonly revision: number;
  readonly recordedAt: number;
  readonly effectiveCycle: number;
  readonly terms: PublicEmploymentTerms;
  readonly source:
    | { readonly kind: 'inherited-scenario'; readonly version: string }
    | {
        readonly kind: 'public-decision';
        readonly proposalId: string;
        readonly actorId: string;
        readonly procedureRevision: number;
      };
};
export type PublicEmploymentState = {
  readonly policyVersion: typeof PUBLIC_EMPLOYMENT_POLICY.version;
  readonly cycleDurationMs: number;
  readonly revisions: readonly PublicEmploymentRevision[];
};
export type PublicEmploymentChanged = {
  readonly type: 'PublicEmploymentPolicyScheduled';
  readonly policyVersion: typeof PUBLIC_EMPLOYMENT_POLICY.version;
  readonly previousRevision: number;
  readonly policy: PublicEmploymentRevision;
};
const array = (v: unknown): boolean => Array.isArray(v);
const integer = (v: number, min: number, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(v) && v >= min && v <= max;
const exact = (v: object, keys: readonly string[]) =>
  !!v &&
  !array(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const names = new Set<string>(occupations.map((o) => o.name));
const items = new Set<string>(commodities.map((o) => o.name));
export function assertPublicEmploymentTerms(t: PublicEmploymentTerms) {
  if (
    !exact(t, [
      'occupations',
      'quotaByResidentialTier',
      'ranking',
      'defaultOccupationCapacity',
      'occupationCapacityOverrides',
    ]) ||
    !array(t.occupations) ||
    t.occupations.length !== names.size ||
    new Set(t.occupations.map((o) => o.occupationName)).size !== names.size
  )
    throw Error('invalid-public-employment-terms');
  for (const o of t.occupations)
    if (
      !exact(o, [
        'occupationName',
        'minimumResidentialTier',
        'educationFloor',
        'eligibilityShare',
        'prerequisiteCommodity',
      ]) ||
      !names.has(o.occupationName) ||
      !integer(o.minimumResidentialTier, 1, 32) ||
      !Number.isFinite(o.educationFloor) ||
      o.educationFloor < 0 ||
      o.educationFloor > 1_000_000 ||
      !Number.isFinite(o.eligibilityShare) ||
      o.eligibilityShare <= 0 ||
      o.eligibilityShare > 1 ||
      (o.prerequisiteCommodity !== null && !items.has(o.prerequisiteCommodity))
    )
      throw Error('invalid-public-occupation-rule');
  if (
    !array(t.quotaByResidentialTier) ||
    !t.quotaByResidentialTier.length ||
    t.quotaByResidentialTier.length > PUBLIC_EMPLOYMENT_POLICY.maxHousingBands ||
    t.quotaByResidentialTier.some((n) => !integer(n, 0, PUBLIC_EMPLOYMENT_POLICY.maxQuota))
  )
    throw Error('invalid-public-employment-quota');
  if (
    !array(t.ranking) ||
    t.ranking.length > 3 ||
    new Set(t.ranking).size !== t.ranking.length ||
    t.ranking.some((f) => !['knowledge', 'housing', 'submitted'].includes(f))
  )
    throw Error('invalid-public-employment-ranking');
  if (
    !integer(t.defaultOccupationCapacity, 0, PUBLIC_EMPLOYMENT_POLICY.maxCapacity) ||
    !t.occupationCapacityOverrides ||
    typeof t.occupationCapacityOverrides !== 'object' ||
    array(t.occupationCapacityOverrides) ||
    Object.entries(t.occupationCapacityOverrides).some(
      ([name, n]) => !names.has(name) || !integer(n, 0, PUBLIC_EMPLOYMENT_POLICY.maxCapacity),
    )
  )
    throw Error('invalid-public-employment-capacity');
}
/** Copies the effective old requirements exactly; activation is not already a reform or a resident vote. */
export function inheritedPublicEmploymentTerms(
  quota: readonly number[],
  cycle: RecruitmentCyclePolicy,
): PublicEmploymentTerms {
  const t: PublicEmploymentTerms = {
    occupations: occupations.map((o) => {
      const tier = jobTiers.find((t) => t.tier === o.jobTier)!;
      return {
        occupationName: o.name,
        minimumResidentialTier: Math.max(o.minResidentialTier, tier.minResidentialTier),
        educationFloor: Math.max(o.educationFloor, tier.minEducationScore),
        eligibilityShare: o.eligibilityShare,
        prerequisiteCommodity: tier.prerequisiteCommodity,
      };
    }),
    quotaByResidentialTier: [...quota],
    ranking: ['knowledge', 'housing', 'submitted'],
    defaultOccupationCapacity: cycle.defaultOccupationCapacity,
    occupationCapacityOverrides: { ...cycle.occupationCapacityOverrides },
  };
  assertPublicEmploymentTerms(t);
  return t;
}
export function initialPublicEmployment(input: {
  at: number;
  cycleDurationMs: number;
  terms: PublicEmploymentTerms;
  sourceVersion: string;
}): PublicEmploymentState {
  if (!integer(input.at, 0) || !integer(input.cycleDurationMs, 1) || !input.sourceVersion.trim())
    throw Error('invalid-public-employment-source');
  assertPublicEmploymentTerms(input.terms);
  return {
    policyVersion: PUBLIC_EMPLOYMENT_POLICY.version,
    cycleDurationMs: input.cycleDurationMs,
    revisions: [
      {
        revision: 1,
        recordedAt: input.at,
        effectiveCycle: Math.floor(input.at / input.cycleDurationMs),
        terms: structuredClone(input.terms),
        source: { kind: 'inherited-scenario', version: input.sourceVersion },
      },
    ],
  };
}
export function assertPublicEmploymentState(s: PublicEmploymentState) {
  if (
    s.policyVersion !== PUBLIC_EMPLOYMENT_POLICY.version ||
    !integer(s.cycleDurationMs, 1) ||
    !array(s.revisions) ||
    !s.revisions.length ||
    s.revisions.length > PUBLIC_EMPLOYMENT_POLICY.maxRevisions
  )
    throw Error('invalid-public-employment-state');
  for (const [i, p] of s.revisions.entries()) {
    assertPublicEmploymentTerms(p.terms);
    if (
      p.revision !== i + 1 ||
      !integer(p.recordedAt, 0) ||
      !integer(p.effectiveCycle, 0) ||
      p.effectiveCycle !== Math.floor(p.recordedAt / s.cycleDurationMs) + (i === 0 ? 0 : 1) ||
      (i > 0 &&
        (p.recordedAt < s.revisions[i - 1]!.recordedAt ||
          p.effectiveCycle < s.revisions[i - 1]!.effectiveCycle))
    )
      throw Error('invalid-public-employment-revision');
    if (
      i === 0
        ? p.source.kind !== 'inherited-scenario' || !p.source.version.trim()
        : p.source.kind !== 'public-decision' ||
          !p.source.proposalId.trim() ||
          !p.source.actorId.trim() ||
          !integer(p.source.procedureRevision, 1)
    )
      throw Error('invalid-public-employment-authority-source');
  }
}
export function publicEmploymentAtCycle(
  s: PublicEmploymentState,
  cycle: number,
): PublicEmploymentRevision | undefined {
  if (!integer(cycle, 0)) throw Error('invalid-public-employment-cycle');
  for (let i = s.revisions.length - 1; i >= 0; i--)
    if (s.revisions[i]!.effectiveCycle <= cycle) return s.revisions[i];
  return undefined;
}
export function schedulePublicEmployment(input: {
  state: PublicEmploymentState;
  at: number;
  expectedRevision: number;
  terms: PublicEmploymentTerms;
  source: Extract<PublicEmploymentRevision['source'], { kind: 'public-decision' }>;
}): PublicEmploymentChanged {
  assertPublicEmploymentState(input.state);
  assertPublicEmploymentTerms(input.terms);
  const previous = input.state.revisions[input.state.revisions.length - 1]!;
  if (input.expectedRevision !== previous.revision)
    throw Error('public-employment-revision-conflict');
  const event: PublicEmploymentChanged = {
    type: 'PublicEmploymentPolicyScheduled',
    policyVersion: PUBLIC_EMPLOYMENT_POLICY.version,
    previousRevision: previous.revision,
    policy: {
      revision: previous.revision + 1,
      recordedAt: input.at,
      effectiveCycle: Math.floor(input.at / input.state.cycleDurationMs) + 1,
      terms: structuredClone(input.terms),
      source: input.source,
    },
  };
  applyPublicEmploymentEvent(input.state, event);
  return event;
}
export function applyPublicEmploymentEvent(
  s: PublicEmploymentState,
  e: PublicEmploymentChanged,
): PublicEmploymentState {
  if (
    e.type !== 'PublicEmploymentPolicyScheduled' ||
    e.policyVersion !== s.policyVersion ||
    e.previousRevision !== s.revisions[s.revisions.length - 1]!.revision ||
    e.policy.revision !== e.previousRevision + 1
  )
    throw Error('public-employment-event-source-mismatch');
  const next = { ...s, revisions: [...s.revisions, structuredClone(e.policy)] };
  assertPublicEmploymentState(next);
  return next;
}
export function publicEmploymentQuota(
  terms: PublicEmploymentTerms,
  residentialTier: number,
): number {
  if (!integer(residentialTier, 1)) throw Error('invalid-public-employment-housing-tier');
  return terms.quotaByResidentialTier[
    Math.min(residentialTier - 1, terms.quotaByResidentialTier.length - 1)
  ]!;
}
/** Only institutional admission changes. No qualification, inventory, body or employment fact is written here. */
export function evaluatePublicOccupation(input: {
  terms: PublicEmploymentTerms;
  occupationName: string;
  agent: OccupationApplicationAgentState;
  populationEducationScores: readonly number[];
}): OccupationApplicationDecision {
  const rule = input.terms.occupations.find((o) => o.occupationName === input.occupationName),
    occupation = occupations.find((o) => o.name === input.occupationName);
  if (!rule || !occupation) throw Error(`unknown occupation ${input.occupationName}`);
  const threshold = calculateEffectiveKnowledgeThreshold({
    educationScores: input.populationEducationScores,
    educationFloor: rule.educationFloor,
    eligibilityShare: rule.eligibilityShare,
  });
  return evaluateOccupationRequirements({
    occupationName: occupation.name,
    jobTier: occupation.jobTier,
    agent: input.agent,
    minimumResidentialTier: rule.minimumResidentialTier,
    effectiveEducationThreshold: threshold,
    prerequisiteCommodity: rule.prerequisiteCommodity,
  });
}

/** Each completed cycle resolves against its own frozen institution, including during a multi-cycle advance. */
export function publicRecruitmentPolicy(
  state: PublicEmploymentState,
  cycle: number,
): RecruitmentCyclePolicy | undefined {
  const p = publicEmploymentAtCycle(state, cycle);
  if (!p) return undefined;
  return {
    policyVersion: PUBLIC_EMPLOYMENT_POLICY.version,
    cycleDurationMs: state.cycleDurationMs,
    employerRanking: p.terms.ranking,
    defaultOccupationCapacity: p.terms.defaultOccupationCapacity,
    occupationCapacityOverrides: p.terms.occupationCapacityOverrides,
  };
}
