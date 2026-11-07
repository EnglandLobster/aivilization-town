import type { Inventory } from '@aivilization/economy';
import { materialId, type MaterialRecipe, type MaterialsState } from './model';

export const MATERIAL_EXTRACTION_POLICY = {
  version: 'resident-extraction-v1',
  source: 'explicit-finite-scenario-endowment',
  access: 'scenario-open-access',
  maxSources: 64,
  regeneration: 'none',
  legacyProduction: 'disabled',
  reservationDurationMs: 86400000,
} as const;
export type MaterialSourceOrigin = {
  readonly version: 'declared-material-endowment-v1';
  readonly id: string;
  readonly kind: 'new-operator-endowment';
  readonly description: string;
};
export function assertMaterialSourceOrigin(value: unknown): asserts value is MaterialSourceOrigin {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('version' in value) ||
    value.version !== 'declared-material-endowment-v1' ||
    !('kind' in value) ||
    value.kind !== 'new-operator-endowment' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !materialId(value.id) ||
    !('description' in value) ||
    typeof value.description !== 'string' ||
    !value.description.trim() ||
    value.description.length > 2000 ||
    Object.keys(value).length !== 4
  )
    throw Error('invalid-material-source-origin');
}
export type MaterialSourceSeed = {
  readonly id: string;
  readonly locationId: string;
  readonly commodity: string;
  readonly initialQuantity: number;
  readonly workMs: number;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly capacity: number;
};
export type MaterialSource = MaterialSourceSeed & {
  readonly remaining: number;
  readonly revision: number;
  readonly at: number;
};
export type MaterialExtractionState = {
  readonly policy: typeof MATERIAL_EXTRACTION_POLICY;
  readonly origin?: MaterialSourceOrigin;
  readonly sources: Readonly<Record<string, MaterialSource>>;
};
export type MaterialExtractionEvent =
  | {
      readonly type: 'MaterialExtractionEnabled';
      readonly origin?: MaterialSourceOrigin;
      readonly policy: typeof MATERIAL_EXTRACTION_POLICY;
      readonly sources: readonly MaterialSource[];
    }
  | { readonly type: 'MaterialSourceChanged'; readonly source: MaterialSource };
export function validMaterialSource(s: MaterialSource, maximum: number) {
  return (
    materialId(s.id) &&
    materialId(s.locationId) &&
    typeof s.commodity === 'string' &&
    s.commodity.trim().length > 0 &&
    s.commodity.length <= 128 &&
    !Object.hasOwn(Object.prototype, s.commodity) &&
    [s.initialQuantity, s.workMs, s.capacity, s.revision].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) &&
    s.initialQuantity <= maximum &&
    Number.isSafeInteger(s.remaining) &&
    s.remaining >= 0 &&
    s.remaining <= s.initialQuantity &&
    Number.isSafeInteger(s.at) &&
    s.at >= 0 &&
    [s.energyCost, s.satietyCost].every((n) => Number.isFinite(n) && n >= 0)
  );
}
export function materialSourceRecipe(s: MaterialSource): MaterialRecipe {
  const unit: Inventory = { [s.commodity]: 1 };
  return {
    id: s.id,
    version: MATERIAL_EXTRACTION_POLICY.version,
    inputs: unit,
    outputs: unit,
    workMs: s.workMs,
    energyCost: s.energyCost,
    satietyCost: s.satietyCost,
    minResidentialTier: 1,
  };
}
/** Public aggregate only: never expose other workers, private jobs, stock IDs or schedules. */
export function materialSourceLaborCapacity(
  s: MaterialsState,
  sourceId: string,
  at: number,
  excludeProductionId?: string,
) {
  if (!Number.isSafeInteger(at) || at < 0) throw Error('invalid-material-time');
  const source = s.extraction?.sources[sourceId];
  if (!source) return undefined;
  const inUse = Object.values(s.productions).filter(
    (p) =>
      p.id !== excludeProductionId && p.sourceId === sourceId && p.session && p.session.until > at,
  ).length;
  return {
    version: 'material-source-labor-capacity-v1' as const,
    capacity: source.capacity,
    inUse,
    available: Math.max(0, source.capacity - inUse),
  };
}
/** Physical source capacity, separate from indoor workstations. Existing sessions retain their own slot. */
export function materialSourceWorkAvailable(
  s: MaterialsState,
  productionId: string,
  actorId: string,
  at: number,
) {
  const job = s.productions[productionId],
    source = job?.sourceId && s.extraction?.sources[job.sourceId];
  if (!source) return false;
  if (job.session?.actorId === actorId) return true;
  return (materialSourceLaborCapacity(s, source.id, at, productionId)?.available ?? 0) > 0;
}

export function matchesMaterialSourceRecipe(
  recipe: MaterialRecipe,
  source: MaterialSource,
  /** A recipe already shortened by recorded learning-by-doing expertise. */
  scaled?: MaterialRecipe,
) {
  const expected = scaled ?? materialSourceRecipe(source);
  return (
    (['id', 'version', 'workMs', 'energyCost', 'satietyCost', 'minResidentialTier'] as const).every(
      (k) => recipe[k] === expected[k],
    ) &&
    [recipe.inputs, recipe.outputs].every(
      (v) => Object.keys(v).length === 1 && v[source.commodity] === 1,
    )
  );
}
