import { commodities } from '@aivilization/content';
import type { ResidentialTierUpgradePolicy, ResidentialUpkeepPolicy } from './residential';
/** Public authorization changes this initial service tariff, never private rent or physical premises. */
export const PUBLIC_HOUSING_POLICY = {
  version: 'resident-public-housing-v1',
  maxRevisions: 10000,
  maxStandards: 32,
  maxPrice: 1_000_000_000,
  arrearsMode: 'record-without-forced-standard-change',
} as const;
export type PublicHousingStandard = {
  readonly tier: number;
  readonly upkeepPerHour: number;
  readonly upgrade: null | {
    readonly currencyCost: number;
    readonly minEducationScore: number;
    readonly inventoryCosts: Readonly<Record<string, number>>;
  };
};
export type PublicHousingTerms = {
  readonly standards: readonly PublicHousingStandard[];
  readonly landValueCoefficientPerHour: number;
};
export type PublicHousingSource =
  | { readonly kind: 'inherited-scenario'; readonly version: string }
  | {
      readonly kind: 'public-decision';
      readonly proposalId: string;
      readonly actorId: string;
      readonly procedureRevision: number;
    };
export type PublicHousingRevision = {
  readonly revision: number;
  readonly effectiveAt: number;
  readonly terms: PublicHousingTerms;
  readonly source: PublicHousingSource;
};
export type PublicHousingState = {
  readonly policyVersion: typeof PUBLIC_HOUSING_POLICY.version;
  readonly arrearsMode: typeof PUBLIC_HOUSING_POLICY.arrearsMode;
  /** Legacy enforcement is provenance, not silently re-enabled under a resident price revision. */
  readonly legacyArrearsDowngradeThresholdHours: number | null;
  readonly revisions: readonly PublicHousingRevision[];
};
export type PublicHousingChanged = {
  readonly type: 'PublicHousingPolicyEnacted';
  readonly policyVersion: typeof PUBLIC_HOUSING_POLICY.version;
  readonly previousRevision: number;
  readonly policy: PublicHousingRevision;
};
const isArray = (v: unknown): boolean => Array.isArray(v);
const exact = (v: object, keys: readonly string[]) =>
  !!v &&
  !isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
const price = (n: number) => Number.isFinite(n) && n >= 0 && n <= PUBLIC_HOUSING_POLICY.maxPrice;
const items = new Set<string>(commodities.map((c) => c.name));
export function assertPublicHousingTerms(t: PublicHousingTerms) {
  if (
    !exact(t, ['standards', 'landValueCoefficientPerHour']) ||
    !price(t.landValueCoefficientPerHour) ||
    !isArray(t.standards) ||
    !t.standards.length ||
    t.standards.length > PUBLIC_HOUSING_POLICY.maxStandards ||
    new Set(t.standards.map((s) => s.tier)).size !== t.standards.length
  )
    throw Error('invalid-public-housing-terms');
  for (const s of t.standards) {
    if (
      !exact(s, ['tier', 'upkeepPerHour', 'upgrade']) ||
      !positive(s.tier) ||
      s.tier > 32 ||
      !price(s.upkeepPerHour) ||
      (s.tier === 1 && s.upgrade !== null)
    )
      throw Error('invalid-public-housing-standard');
    const u = s.upgrade;
    if (
      u !== null &&
      (!exact(u, ['currencyCost', 'minEducationScore', 'inventoryCosts']) ||
        !price(u.currencyCost) ||
        !price(u.minEducationScore) ||
        !u.inventoryCosts ||
        typeof u.inventoryCosts !== 'object' ||
        isArray(u.inventoryCosts) ||
        Object.entries(u.inventoryCosts).some(([item, n]) => !items.has(item) || !price(n)))
    )
      throw Error('invalid-public-housing-upgrade');
  }
}
export function inheritedPublicHousingTerms(
  upkeep: ResidentialUpkeepPolicy,
  upgrade: ResidentialTierUpgradePolicy,
  tiers: readonly number[],
): PublicHousingTerms {
  const terms: PublicHousingTerms = {
    landValueCoefficientPerHour: upkeep.landValueCoefficientPerHour ?? 0,
    standards: tiers.map((tier) => {
      const fee = upkeep.costs.find((c) => c.residentialTier === tier),
        u = upgrade.costs.find((c) => c.targetResidentialTier === tier);
      if (!fee) throw Error('housing-standard-without-upkeep-source');
      return {
        tier,
        upkeepPerHour: fee.currencyCostPerHour,
        upgrade:
          tier === 1 ||
          (upgrade.maxResidentialTier !== undefined && tier > upgrade.maxResidentialTier) ||
          !u
            ? null
            : {
                currencyCost: u.currencyCost ?? 0,
                minEducationScore: u.minEducationScore ?? 0,
                inventoryCosts: { ...u.inventoryCosts },
              },
      };
    }),
  };
  assertPublicHousingTerms(terms);
  return terms;
}
export function initialPublicHousing(input: {
  at: number;
  terms: PublicHousingTerms;
  sourceVersion: string;
  legacyArrearsDowngradeThresholdHours?: number;
}): PublicHousingState {
  const s: PublicHousingState = {
    policyVersion: PUBLIC_HOUSING_POLICY.version,
    arrearsMode: PUBLIC_HOUSING_POLICY.arrearsMode,
    legacyArrearsDowngradeThresholdHours: input.legacyArrearsDowngradeThresholdHours ?? null,
    revisions: [
      {
        revision: 1,
        effectiveAt: input.at,
        terms: structuredClone(input.terms),
        source: { kind: 'inherited-scenario', version: input.sourceVersion },
      },
    ],
  };
  assertPublicHousingState(s);
  return s;
}
export function assertPublicHousingState(s: PublicHousingState) {
  if (
    s.policyVersion !== PUBLIC_HOUSING_POLICY.version ||
    s.arrearsMode !== PUBLIC_HOUSING_POLICY.arrearsMode ||
    (s.legacyArrearsDowngradeThresholdHours !== null &&
      !price(s.legacyArrearsDowngradeThresholdHours)) ||
    !isArray(s.revisions) ||
    !s.revisions.length ||
    s.revisions.length > PUBLIC_HOUSING_POLICY.maxRevisions
  )
    throw Error('invalid-public-housing-state');
  const tiers = s.revisions[0]!.terms.standards.map((t) => t.tier)
    .sort((a, b) => a - b)
    .join(',');
  for (const [i, p] of s.revisions.entries()) {
    assertPublicHousingTerms(p.terms);
    if (
      p.revision !== i + 1 ||
      !time(p.effectiveAt) ||
      (i > 0 && p.effectiveAt < s.revisions[i - 1]!.effectiveAt) ||
      p.terms.standards
        .map((t) => t.tier)
        .sort((a, b) => a - b)
        .join(',') !== tiers
    )
      throw Error('invalid-public-housing-revision');
    if (
      i === 0
        ? p.source.kind !== 'inherited-scenario' || !p.source.version.trim()
        : p.source.kind !== 'public-decision' ||
          !p.source.proposalId.trim() ||
          !p.source.actorId.trim() ||
          !positive(p.source.procedureRevision)
    )
      throw Error('invalid-public-housing-authority-source');
  }
}
export function publicHousingAt(
  s: PublicHousingState,
  at: number,
): PublicHousingRevision | undefined {
  if (!time(at)) throw Error('invalid-public-housing-time');
  for (let i = s.revisions.length - 1; i >= 0; i--)
    if (s.revisions[i]!.effectiveAt <= at) return s.revisions[i];
  return undefined;
}
export function enactPublicHousing(input: {
  state: PublicHousingState;
  at: number;
  expectedRevision: number;
  terms: PublicHousingTerms;
  source: Extract<PublicHousingSource, { kind: 'public-decision' }>;
}): PublicHousingChanged {
  assertPublicHousingState(input.state);
  assertPublicHousingTerms(input.terms);
  const previous = input.state.revisions.at(-1)!;
  if (previous.revision !== input.expectedRevision) throw Error('public-housing-revision-conflict');
  const e: PublicHousingChanged = {
    type: 'PublicHousingPolicyEnacted',
    policyVersion: PUBLIC_HOUSING_POLICY.version,
    previousRevision: previous.revision,
    policy: {
      revision: previous.revision + 1,
      effectiveAt: input.at,
      terms: structuredClone(input.terms),
      source: structuredClone(input.source),
    },
  };
  applyPublicHousingEvent(input.state, e);
  return e;
}
export function applyPublicHousingEvent(
  s: PublicHousingState,
  e: PublicHousingChanged,
): PublicHousingState {
  if (
    e.type !== 'PublicHousingPolicyEnacted' ||
    e.policyVersion !== s.policyVersion ||
    e.previousRevision !== s.revisions.at(-1)!.revision ||
    e.policy.revision !== e.previousRevision + 1
  )
    throw Error('public-housing-event-source-mismatch');
  const next = { ...s, revisions: [...s.revisions, structuredClone(e.policy)] };
  assertPublicHousingState(next);
  return next;
}
export function publicHousingPolicies(p: PublicHousingRevision): {
  upkeep: ResidentialUpkeepPolicy;
  upgrade: ResidentialTierUpgradePolicy;
} {
  assertPublicHousingTerms(p.terms);
  return {
    upkeep: {
      policyVersion: PUBLIC_HOUSING_POLICY.version,
      costs: p.terms.standards.map((s) => ({
        residentialTier: s.tier,
        currencyCostPerHour: s.upkeepPerHour,
      })),
      landValueCoefficientPerHour: p.terms.landValueCoefficientPerHour,
    },
    upgrade: {
      maxResidentialTier: Math.max(...p.terms.standards.map((s) => s.tier)),
      costs: p.terms.standards.flatMap((s) =>
        s.upgrade
          ? [
              {
                targetResidentialTier: s.tier,
                ...s.upgrade,
                inventoryCosts: { ...s.upgrade.inventoryCosts },
              },
            ]
          : [],
      ),
    },
  };
}
