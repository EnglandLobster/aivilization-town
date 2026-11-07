import { productionRecipes } from '@aivilization/content';
import { createMaterialsPolicy } from '@aivilization/materials';
/** Explicit experimental processing model: legacy material ratios/costs, one source second = one simulation minute; no instant rewards or wealth gate. */
export const MATERIALS_POLICY = createMaterialsPolicy(
  productionRecipes
    .filter((r) => Object.keys(r.inputs).length > 0)
    .map((r) => ({
      id: r.output.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      version: 'resident-processing-v1',
      inputs: r.inputs,
      outputs: { [r.output]: 1 },
      workMs: Math.max(60000, Math.ceil(r.timeCostSeconds * 60000)),
      energyCost: r.energyCost,
      satietyCost: r.satietyCost,
      minResidentialTier: 1,
    })),
);
