import type { WorldProjection } from '@aivilization/world';
/** Fixed-size navigation only; source quantities and recipe tables are active queries. */
export function physicalProductionContext(w: WorldProjection) {
  return {
    version: w.materials?.extraction?.policy.version ?? null,
    timing:
      'Only actual labor produces usable goods; residential wealth tier does not grant processing ability.',
    processingWith: 'town production recipes / create / start',
    rawMaterialsWith: 'town sources list / read; town production gather / start',
    currentJobsWith: 'town production list / read',
    leaveWith: 'town production leave',
    legacyProduction: 'business produce is disabled in this explicitly enabled mode',
  };
}
