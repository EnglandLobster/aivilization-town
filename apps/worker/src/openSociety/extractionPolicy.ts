import { productionRecipes } from '@aivilization/content';
import {
  assertMaterialSourceOrigin,
  type MaterialSourceOrigin,
  type MaterialSourceSeed,
} from '@aivilization/materials';
import type { WorldProjection } from '@aivilization/world';
export const EXTRACTION_SEED_VERSION = 'explicit-finite-material-sources-v1';
/** Explicit coarse initial resource area; no inferred history, automatic regeneration or duplicate legacy pool. */
export function seedOpenMaterialSources(world: WorldProjection): readonly MaterialSourceSeed[] {
  const location = Object.values(world.locations)
    .filter((l) => l.kind === 'production')
    .sort((a, b) => a.locationId.localeCompare(b.locationId, 'en'))[0];
  if (!location) throw Error('finite-material-sources-require-production-location');
  return productionRecipes
    .filter((r) => Object.keys(r.inputs).length === 0)
    .map((r) => ({
      id: `source-${r.output.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      locationId: location.locationId,
      commodity: r.output,
      initialQuantity: 100,
      workMs: Math.max(60000, Math.ceil(r.timeCostSeconds * 60000)),
      energyCost: r.energyCost,
      satietyCost: r.satietyCost,
      capacity: 2,
    }));
}

/** The declaration is operator input, not resident text or inferred source history. */
export function parseMaterialEndowment(value: unknown): {
  origin: MaterialSourceOrigin;
  sources: MaterialSourceSeed[];
} {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'origin,sources' ||
    !('origin' in value) ||
    !('sources' in value) ||
    !Array.isArray(value.sources)
  )
    throw Error('invalid-material-endowment-declaration');
  assertMaterialSourceOrigin(value.origin);
  const sources = value.sources.map((s: unknown): MaterialSourceSeed => {
    if (
      !s ||
      typeof s !== 'object' ||
      Array.isArray(s) ||
      Object.keys(s).sort().join(',') !==
        'capacity,commodity,energyCost,id,initialQuantity,locationId,satietyCost,workMs' ||
      !('id' in s) ||
      typeof s.id !== 'string' ||
      !('locationId' in s) ||
      typeof s.locationId !== 'string' ||
      !('commodity' in s) ||
      typeof s.commodity !== 'string' ||
      !('initialQuantity' in s) ||
      typeof s.initialQuantity !== 'number' ||
      !('workMs' in s) ||
      typeof s.workMs !== 'number' ||
      !('energyCost' in s) ||
      typeof s.energyCost !== 'number' ||
      !('satietyCost' in s) ||
      typeof s.satietyCost !== 'number' ||
      !('capacity' in s) ||
      typeof s.capacity !== 'number'
    )
      throw Error('invalid-material-endowment-source');
    return {
      id: s.id,
      locationId: s.locationId,
      commodity: s.commodity,
      initialQuantity: s.initialQuantity,
      workMs: s.workMs,
      energyCost: s.energyCost,
      satietyCost: s.satietyCost,
      capacity: s.capacity,
    };
  });
  return { origin: { ...value.origin }, sources };
}
