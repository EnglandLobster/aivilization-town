import {
  MATERIAL_EXTRACTION_POLICY,
  assertMaterialSourceOrigin,
  validMaterialSource,
  type MaterialExtractionEvent,
} from './extractionModel';
import type { MaterialsState } from './model';
export function applyMaterialExtractionEvent(
  s: MaterialsState,
  e: MaterialExtractionEvent,
): MaterialsState {
  if (e.type === 'MaterialExtractionEnabled') {
    if (e.origin !== undefined) assertMaterialSourceOrigin(e.origin);
    if (
      s.extraction ||
      Object.keys(e.policy).length !== Object.keys(MATERIAL_EXTRACTION_POLICY).length ||
      Object.entries(MATERIAL_EXTRACTION_POLICY).some(
        ([k, v]) => e.policy[k as keyof typeof MATERIAL_EXTRACTION_POLICY] !== v,
      ) ||
      !e.sources.length ||
      e.sources.length > e.policy.maxSources ||
      new Set(e.sources.map((v) => v.id)).size !== e.sources.length ||
      e.sources.some(
        (v) =>
          !validMaterialSource(v, s.policy.maxQuantity) ||
          v.revision !== 1 ||
          v.remaining !== v.initialQuantity,
      )
    )
      throw Error('invalid-material-extraction-activation');
    return {
      ...s,
      extraction: {
        policy: { ...e.policy },
        ...(e.origin ? { origin: { ...e.origin } } : {}),
        sources: Object.fromEntries(e.sources.map((v) => [v.id, { ...v }])),
      },
    };
  }
  const v = e.source,
    old = s.extraction?.sources[v.id];
  if (
    !s.extraction ||
    !old ||
    !validMaterialSource(v, s.policy.maxQuantity) ||
    v.revision !== old.revision + 1 ||
    v.at < old.at ||
    (
      [
        'id',
        'locationId',
        'commodity',
        'initialQuantity',
        'workMs',
        'energyCost',
        'satietyCost',
        'capacity',
      ] as const
    ).some((k) => v[k] !== old[k])
  )
    throw Error('invalid-material-source-change');
  return { ...s, extraction: { ...s.extraction, sources: { ...s.extraction.sources, [v.id]: v } } };
}
