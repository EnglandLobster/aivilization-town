import type { MaterialEvent, MaterialRecipe, MaterialsState } from './model';

/**
 * Learning by doing: a person who has spent more real working time making the same outputs
 * needs proportionally less time and bodily effort per unit (an experience curve). Comparative
 * advantage then comes from each resident's own history instead of seeded skill labels, which is
 * the minimal condition under which dividing work between people beats doing everything alone.
 */
export const MATERIAL_EXPERTISE_POLICY = {
  version: 'resident-learning-by-doing-v1',
  /**
   * Experience that makes the first doubling: ten minutes of real work on the same outputs.
   * Units take one to five simulated minutes and bodies allow tens of minutes of work per day,
   * so a few days of focus (30-70 minutes of practice) reach a 0.64-0.5 multiplier.
   */
  referenceWorkMs: 600_000,
  /** Time and effort multiplier per doubling of experience (Wright's law). */
  progressRatio: 0.8,
  /** Experts never become faster than this share of the novice time. */
  floorMultiplier: 0.35,
} as const;
export type MaterialExpertisePolicy = typeof MATERIAL_EXPERTISE_POLICY;
export type MaterialExpertiseState = {
  readonly policy: MaterialExpertisePolicy;
  /** actorId -> skill key -> accumulated real working milliseconds. */
  readonly experienceMs: Readonly<Record<string, Readonly<Record<string, number>>>>;
};

/** Finite natural sources slowly recover; nothing grows beyond its original endowment. */
export const MATERIAL_REGROWTH_POLICY = {
  version: 'material-source-regrowth-v1',
  /** Share of a source's original quantity that regrows per simulated day while below it. */
  fractionPerDay: 0.2,
  dayMs: 86_400_000,
} as const;
export type MaterialRegrowthPolicy = typeof MATERIAL_REGROWTH_POLICY;
export type MaterialRegrowthState = {
  readonly policy: MaterialRegrowthPolicy;
  readonly lastAt: number;
  /** Fractional regrowth not yet a whole unit, per source. */
  readonly carry: Readonly<Record<string, number>>;
};
export type MaterialGrowthEvent =
  | { readonly type: 'MaterialExpertiseEnabled'; readonly policy: MaterialExpertisePolicy }
  | {
      readonly type: 'MaterialRegrowthEnabled';
      readonly policy: MaterialRegrowthPolicy;
      readonly at: number;
    }
  | {
      readonly type: 'MaterialSourcesRegrown';
      readonly at: number;
      readonly carry: Readonly<Record<string, number>>;
    };
export type MaterialProductionExpertise = {
  readonly version: MaterialExpertisePolicy['version'];
  readonly multiplier: number;
};

const samePolicy = <T extends object>(a: T, b: T) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([k, v]) => (b as Record<string, unknown>)[k] === v);
const round10 = (n: number) => Math.round(n * 1e10) / 1e10;

/** Skill is about what is made, so extraction and processing of the same output share it. */
export function materialSkillKey(recipe: Pick<MaterialRecipe, 'outputs'>): string {
  return Object.keys(recipe.outputs).sort().join('+');
}
export function materialExpertiseMultiplier(
  policy: MaterialExpertisePolicy,
  experienceMs: number,
): number {
  const experience = Number.isFinite(experienceMs) && experienceMs > 0 ? experienceMs : 0;
  const curve = Math.pow(
    (policy.referenceWorkMs + experience) / policy.referenceWorkMs,
    Math.log2(policy.progressRatio),
  );
  return round10(Math.max(policy.floorMultiplier, Math.min(1, curve)));
}
export function residentMaterialExperience(
  s: MaterialsState,
  actorId: string,
  recipe: Pick<MaterialRecipe, 'outputs'>,
): number {
  return s.expertise?.experienceMs[actorId]?.[materialSkillKey(recipe)] ?? 0;
}
/** A shared batch runs at the pace its least experienced listed worker would need. */
export function materialBatchExpertise(
  s: MaterialsState,
  recipe: MaterialRecipe,
  workers: readonly string[],
): MaterialProductionExpertise | undefined {
  const expertise = s.expertise;
  if (!expertise || !workers.length) return undefined;
  const multiplier = Math.max(
    ...workers.map((w) =>
      materialExpertiseMultiplier(expertise.policy, residentMaterialExperience(s, w, recipe)),
    ),
  );
  return multiplier < 1 ? { version: expertise.policy.version, multiplier } : undefined;
}
export function applyMaterialExpertise(recipe: MaterialRecipe, multiplier: number): MaterialRecipe {
  return {
    ...recipe,
    workMs: Math.max(1, Math.round(recipe.workMs * multiplier)),
    energyCost: round10(recipe.energyCost * multiplier),
    satietyCost: round10(recipe.satietyCost * multiplier),
  };
}
export function validProductionExpertise(s: MaterialsState, e: MaterialProductionExpertise) {
  const policy = s.expertise?.policy;
  return (
    !!policy &&
    e.version === policy.version &&
    Number.isFinite(e.multiplier) &&
    e.multiplier >= policy.floorMultiplier &&
    e.multiplier < 1 &&
    Object.keys(e).length === 2
  );
}

/** Pure regrowth decision; whole units only, the fraction is carried forward explicitly. */
export function regrowMaterialSources(s: MaterialsState, at: number): readonly MaterialEvent[] {
  const regrowth = s.regrowth,
    sources = s.extraction?.sources;
  if (!regrowth || !sources || !Number.isSafeInteger(at) || at <= regrowth.lastAt) return [];
  const below = Object.values(sources)
    .filter((source) => source.remaining < source.initialQuantity)
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  // Nothing to grow and nothing carried: no event, so full sources do not fill the journal.
  if (!below.length && !Object.keys(regrowth.carry).length) return [];
  const changed: MaterialEvent[] = [];
  const carry: Record<string, number> = {};
  for (const source of below) {
    // A source already regrowing continues from the last evaluation; one that dropped below its
    // original quantity since then starts growing from that change, not retroactively.
    const since =
      regrowth.carry[source.id] !== undefined
        ? regrowth.lastAt
        : Math.max(regrowth.lastAt, Math.min(source.at, at));
    const amount =
      (regrowth.carry[source.id] ?? 0) +
      (source.initialQuantity * regrowth.policy.fractionPerDay * (at - since)) /
        regrowth.policy.dayMs;
    const whole = Math.min(Math.floor(amount), source.initialQuantity - source.remaining);
    const remaining = source.remaining + whole;
    if (remaining < source.initialQuantity) carry[source.id] = round10(amount - whole);
    if (whole > 0 && source.revision < Number.MAX_SAFE_INTEGER)
      changed.push({
        type: 'MaterialSourceChanged',
        source: {
          ...source,
          remaining,
          revision: source.revision + 1,
          at: Math.max(at, source.at),
        },
      });
  }
  return [...changed, { type: 'MaterialSourcesRegrown', at, carry }];
}

export function applyMaterialGrowthEvent(
  s: MaterialsState,
  e: MaterialGrowthEvent,
): MaterialsState {
  if (e.type === 'MaterialExpertiseEnabled') {
    if (s.expertise || !samePolicy(e.policy, MATERIAL_EXPERTISE_POLICY))
      throw Error('invalid-material-expertise-activation');
    return { ...s, expertise: { policy: { ...e.policy }, experienceMs: {} } };
  }
  if (e.type === 'MaterialRegrowthEnabled') {
    if (
      s.regrowth ||
      !s.extraction ||
      !samePolicy(e.policy, MATERIAL_REGROWTH_POLICY) ||
      !Number.isSafeInteger(e.at) ||
      e.at < 0
    )
      throw Error('invalid-material-regrowth-activation');
    return { ...s, regrowth: { policy: { ...e.policy }, lastAt: e.at, carry: {} } };
  }
  if (
    !s.regrowth ||
    !Number.isSafeInteger(e.at) ||
    e.at <= s.regrowth.lastAt ||
    Object.entries(e.carry).some(
      ([id, v]) => !s.extraction?.sources[id] || !Number.isFinite(v) || v < 0 || v >= 1,
    )
  )
    throw Error('invalid-material-regrowth-event');
  return { ...s, regrowth: { ...s.regrowth, lastAt: e.at, carry: { ...e.carry } } };
}

/** Experience is the committed working time recorded in receipts, never a resident claim. */
export function recordMaterialExperience(
  s: MaterialsState,
  efforts: readonly {
    readonly actorId: string;
    readonly productionId: string;
    readonly workMs: number;
  }[],
): MaterialsState {
  if (!s.expertise || !efforts.length) return s;
  const experienceMs = { ...s.expertise.experienceMs };
  for (const effort of efforts) {
    const job = s.productions[effort.productionId];
    if (!job || !(effort.workMs > 0)) continue;
    const key = materialSkillKey(job.recipe);
    const own = experienceMs[effort.actorId] ?? {};
    experienceMs[effort.actorId] = { ...own, [key]: (own[key] ?? 0) + effort.workMs };
  }
  return { ...s, expertise: { ...s.expertise, experienceMs } };
}
