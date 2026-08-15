import {
  commodities,
  productionRecipes,
  type CommodityConfig,
  type ProductionRecipe,
} from '@aivilization/content';
import { rollProbabilityPercent, type SeededRandom } from '@aivilization/sim-core';
import { getInventoryQuantity, type Inventory } from './inventory';

export type ProductionAgentState = {
  readonly residentialTier: number;
  readonly educationScore?: number;
  /**
   * Discrete education level (education-system-v4). When the efficiency policy
   * carries `educationLevelMultipliers`, the education factor is multiplied by
   * the level's multiplier; omitted keeps the legacy score-only factor.
   */
  readonly educationLevel?: number;
  readonly energy: number;
  readonly satiety: number;
  readonly health?: number;
  readonly availableLaborSeconds: number;
  readonly inventory: Inventory;
};

export type ProductionEfficiencyPhysiologyCap = {
  readonly residentialTier: number;
  readonly maxEnergy: number;
  readonly maxSatiety: number;
  readonly maxHealth: number;
};

export type ProductionEfficiencyPhysiologyCapPolicy = {
  readonly caps: readonly ProductionEfficiencyPhysiologyCap[];
};

export type ProductionEfficiencyPolicy = {
  readonly minEfficiency: number;
  readonly educationScoreForMaxEfficiency: number;
  /**
   * Per-level multiplier on the education efficiency factor
   * (production-efficiency-v2), indexed by discrete education level. The
   * multiplied factor is still clamped to [0, 1]. Applies only when the agent
   * state carries `educationLevel`; agents without a level keep the legacy
   * score-only factor, so continuous-score runs are unchanged.
   */
  readonly educationLevelMultipliers?: readonly number[];
  readonly physiologyCaps?: ProductionEfficiencyPhysiologyCapPolicy;
  readonly residentialTierForMaxEfficiency?: number;
};

export type ProductionEfficiencyDecision =
  | {
      readonly status: 'accepted';
      readonly efficiency: number;
    }
  | {
      readonly status: 'rejected';
      readonly reason: 'policy-invalid';
      readonly detail: string;
    };

export type ProductionRejectionReason =
  | 'commodity-not-producible'
  | 'residential-tier-too-low'
  | 'insufficient-input'
  | 'insufficient-energy'
  | 'insufficient-satiety'
  | 'insufficient-labor'
  | 'policy-invalid';

export type ProductionPlan =
  | {
      readonly status: 'accepted';
      readonly produced: Inventory;
      readonly consumedInputs: Inventory;
      readonly energyCost: number;
      readonly satietyCost: number;
      readonly laborSeconds: number;
      readonly productionEfficiency?: number;
    }
  | {
      readonly status: 'rejected';
      readonly reason: ProductionRejectionReason;
      readonly detail: string;
    };

export type ProductionRecipeOverride = {
  readonly output: string;
} & Partial<Omit<ProductionRecipe, 'output'>>;

export type ProductionCatalogInput = {
  readonly commodityCatalog?: readonly CommodityConfig[];
  readonly recipeCatalog?: readonly ProductionRecipe[];
  readonly recipeOverrides?: readonly ProductionRecipeOverride[];
};

export type ProductionDefinition = {
  readonly commodity: CommodityConfig;
  readonly recipe: ProductionRecipe;
};

export function planProduction(input: {
  readonly commodityName: string;
  readonly quantity: number;
  readonly agent: ProductionAgentState;
  readonly rng?: SeededRandom;
  readonly commodityCatalog?: readonly CommodityConfig[];
  readonly recipeCatalog?: readonly ProductionRecipe[];
  readonly recipeOverrides?: readonly ProductionRecipeOverride[];
  readonly productionEfficiency?: ProductionEfficiencyPolicy;
}): ProductionPlan {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return reject('commodity-not-producible', `quantity must be a positive integer`);
  }

  const definition = resolveProductionDefinition(input.commodityName, {
    ...(input.commodityCatalog === undefined ? {} : { commodityCatalog: input.commodityCatalog }),
    ...(input.recipeCatalog === undefined ? {} : { recipeCatalog: input.recipeCatalog }),
    ...(input.recipeOverrides === undefined ? {} : { recipeOverrides: input.recipeOverrides }),
  });

  if (definition === undefined) {
    return reject('commodity-not-producible', `${input.commodityName} has no production recipe`);
  }
  const { commodity, recipe } = definition;

  if (
    commodity.minResidentialTier !== null &&
    input.agent.residentialTier < commodity.minResidentialTier
  ) {
    return reject(
      'residential-tier-too-low',
      `${input.commodityName} requires residential tier ${commodity.minResidentialTier}`,
    );
  }

  const efficiencyDecision =
    input.productionEfficiency === undefined
      ? undefined
      : evaluateProductionEfficiency({
          agent: input.agent,
          policy: input.productionEfficiency,
        });
  if (efficiencyDecision?.status === 'rejected') {
    return reject(efficiencyDecision.reason, efficiencyDecision.detail);
  }
  const productionEfficiency = efficiencyDecision?.efficiency;

  const consumedInputs = multiplyInventory(recipe.inputs, input.quantity);
  for (const [itemName, requiredQuantity] of Object.entries(consumedInputs)) {
    const availableQuantity = getInventoryQuantity(input.agent.inventory, itemName);
    if (availableQuantity < requiredQuantity) {
      return reject(
        'insufficient-input',
        `${itemName} requires ${requiredQuantity}, available ${availableQuantity}`,
      );
    }
  }

  const energyCost = scaleProductionCost(recipe.energyCost * input.quantity, productionEfficiency);
  if (input.agent.energy < energyCost) {
    return reject(
      'insufficient-energy',
      `energy requires ${energyCost}, available ${input.agent.energy}`,
    );
  }

  const satietyCost = scaleProductionCost(
    recipe.satietyCost * input.quantity,
    productionEfficiency,
  );
  if (input.agent.satiety < satietyCost) {
    return reject(
      'insufficient-satiety',
      `satiety requires ${satietyCost}, available ${input.agent.satiety}`,
    );
  }

  const laborSeconds = scaleProductionCost(
    recipe.timeCostSeconds * input.quantity,
    productionEfficiency,
  );
  if (input.agent.availableLaborSeconds < laborSeconds) {
    return reject(
      'insufficient-labor',
      `labor requires ${laborSeconds}, available ${input.agent.availableLaborSeconds}`,
    );
  }

  const rewardCount = countRewards(recipe.rewardProbabilityPercent, input.quantity, input.rng);
  return {
    status: 'accepted',
    produced:
      rewardCount === 0
        ? { [input.commodityName]: input.quantity }
        : { [input.commodityName]: input.quantity, 'Gold Apple': rewardCount },
    consumedInputs,
    energyCost,
    satietyCost,
    laborSeconds,
    ...(productionEfficiency === undefined ? {} : { productionEfficiency }),
  };
}

export function evaluateProductionEfficiency(input: {
  readonly agent: Pick<
    ProductionAgentState,
    'residentialTier' | 'educationScore' | 'educationLevel' | 'energy' | 'satiety' | 'health'
  >;
  readonly policy: ProductionEfficiencyPolicy;
}): ProductionEfficiencyDecision {
  const minEfficiencyError = validateMinEfficiency(input.policy.minEfficiency);
  if (minEfficiencyError !== undefined) {
    return rejectEfficiency(minEfficiencyError);
  }
  if (!Number.isFinite(input.policy.educationScoreForMaxEfficiency)) {
    return rejectEfficiency('educationScoreForMaxEfficiency must be positive');
  }
  if (input.policy.educationScoreForMaxEfficiency <= 0) {
    return rejectEfficiency('educationScoreForMaxEfficiency must be positive');
  }
  const levelMultipliersError = validateEducationLevelMultipliers(
    input.policy.educationLevelMultipliers,
  );
  if (levelMultipliersError !== undefined) {
    return rejectEfficiency(levelMultipliersError);
  }
  if (
    input.policy.residentialTierForMaxEfficiency !== undefined &&
    !isPositiveFinite(input.policy.residentialTierForMaxEfficiency)
  ) {
    return rejectEfficiency('residentialTierForMaxEfficiency must be positive');
  }
  const physiologyCapsError = validatePhysiologyCapsPolicy(input.policy.physiologyCaps);
  if (physiologyCapsError !== undefined) {
    return rejectEfficiency(physiologyCapsError);
  }

  const educationScore = input.agent.educationScore ?? 0;
  if (!isNonNegativeFinite(educationScore)) {
    return rejectEfficiency('educationScore must be non-negative');
  }

  const educationFactor = evaluateEducationFactor({
    educationScore,
    ...(input.agent.educationLevel === undefined
      ? {}
      : { educationLevel: input.agent.educationLevel }),
    policy: input.policy,
  });
  if (typeof educationFactor !== 'number') {
    return rejectEfficiency(educationFactor);
  }

  const factors = [educationFactor];

  if (input.policy.physiologyCaps !== undefined) {
    const cap = input.policy.physiologyCaps.caps.find(
      (candidate) => candidate.residentialTier === input.agent.residentialTier,
    );
    if (cap === undefined) {
      return rejectEfficiency(
        `physiology cap missing for residentialTier ${input.agent.residentialTier}`,
      );
    }

    if (!isNonNegativeFinite(input.agent.energy)) {
      return rejectEfficiency('energy must be non-negative');
    }
    if (!isNonNegativeFinite(input.agent.satiety)) {
      return rejectEfficiency('satiety must be non-negative');
    }
    if (!isNonNegativeFinite(input.agent.health)) {
      return rejectEfficiency('health must be non-negative');
    }

    factors.push(
      capProgress(input.agent.energy, cap.maxEnergy),
      capProgress(input.agent.satiety, cap.maxSatiety),
      capProgress(input.agent.health, cap.maxHealth),
    );
  }

  if (input.policy.residentialTierForMaxEfficiency !== undefined) {
    if (!isNonNegativeFinite(input.agent.residentialTier)) {
      return rejectEfficiency('residentialTier must be non-negative');
    }
    factors.push(
      capProgress(input.agent.residentialTier, input.policy.residentialTierForMaxEfficiency),
    );
  }

  const progress =
    factors.reduce((sum, factor) => sum + factor, 0) / factors.length;
  return {
    status: 'accepted',
    efficiency: input.policy.minEfficiency + (1 - input.policy.minEfficiency) * progress,
  };
}

function validateEducationLevelMultipliers(
  multipliers: readonly number[] | undefined,
): string | undefined {
  if (multipliers === undefined) {
    return undefined;
  }
  if (multipliers.length === 0) {
    return 'educationLevelMultipliers must not be empty';
  }
  for (const multiplier of multipliers) {
    if (!isPositiveFinite(multiplier)) {
      return 'educationLevelMultipliers entries must be positive';
    }
  }
  return undefined;
}

/**
 * Education factor of the efficiency aggregate: the legacy score progress
 * (`min(1, score / educationScoreForMaxEfficiency)`), optionally scaled by the
 * agent's discrete-level multiplier and re-clamped to [0, 1]. Returns an error
 * string when a supplied level cannot index the multiplier table.
 */
function evaluateEducationFactor(input: {
  readonly educationScore: number;
  readonly educationLevel?: number;
  readonly policy: ProductionEfficiencyPolicy;
}): number | string {
  const progress = capProgress(input.educationScore, input.policy.educationScoreForMaxEfficiency);
  const multipliers = input.policy.educationLevelMultipliers;
  if (multipliers === undefined || input.educationLevel === undefined) {
    return progress;
  }
  if (!Number.isInteger(input.educationLevel) || input.educationLevel < 0) {
    return 'educationLevel must be a non-negative integer';
  }
  const multiplier = multipliers[input.educationLevel];
  if (multiplier === undefined) {
    return `educationLevelMultipliers has no entry for level ${input.educationLevel}`;
  }
  return Math.min(1, progress * multiplier);
}

function validatePhysiologyCapsPolicy(
  policy: ProductionEfficiencyPhysiologyCapPolicy | undefined,
): string | undefined {
  if (policy === undefined) {
    return undefined;
  }
  if (policy.caps.length === 0) {
    return 'physiologyCaps.caps must not be empty';
  }

  const residentialTiers = new Set<number>();
  for (const cap of policy.caps) {
    if (!Number.isInteger(cap.residentialTier) || cap.residentialTier <= 0) {
      return 'physiology cap residentialTier must be a positive integer';
    }
    if (residentialTiers.has(cap.residentialTier)) {
      return `duplicate physiology cap for residentialTier ${cap.residentialTier}`;
    }
    residentialTiers.add(cap.residentialTier);

    if (!isPositiveFinite(cap.maxEnergy)) {
      return 'physiology cap maxEnergy must be positive';
    }
    if (!isPositiveFinite(cap.maxSatiety)) {
      return 'physiology cap maxSatiety must be positive';
    }
    if (!isPositiveFinite(cap.maxHealth)) {
      return 'physiology cap maxHealth must be positive';
    }
  }
  return undefined;
}

function capProgress(value: number, maximum: number): number {
  return Math.min(1, value / maximum);
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

export function scaleProductionCost(
  cost: number,
  productionEfficiency: number | undefined,
): number {
  return productionEfficiency === undefined ? cost : cost / productionEfficiency;
}

export function resolveProductionDefinition(
  commodityName: string,
  input: ProductionCatalogInput = {},
): ProductionDefinition | undefined {
  const commodityCatalog = input.commodityCatalog ?? commodities;
  const recipeCatalog = applyRecipeOverrides(
    input.recipeCatalog ?? productionRecipes,
    input.recipeOverrides ?? [],
  );
  const commodity = commodityCatalog.find((candidate) => candidate.name === commodityName);
  const recipe = recipeCatalog.find((candidate) => candidate.output === commodityName);

  if (commodity === undefined || recipe === undefined) {
    return undefined;
  }

  return { commodity, recipe };
}

function reject(reason: ProductionRejectionReason, detail: string): ProductionPlan {
  return { status: 'rejected', reason, detail };
}

function rejectEfficiency(detail: string): ProductionEfficiencyDecision {
  return { status: 'rejected', reason: 'policy-invalid', detail };
}

function validateMinEfficiency(value: number): string | undefined {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    return 'minEfficiency must be within (0, 1]';
  }
  return undefined;
}

function multiplyInventory(inventory: Inventory, quantity: number): Inventory {
  return Object.fromEntries(
    Object.entries(inventory).map(([itemName, itemQuantity]) => [
      itemName,
      itemQuantity * quantity,
    ]),
  );
}

function countRewards(
  probabilityPercent: number,
  quantity: number,
  rng: SeededRandom | undefined,
): number {
  if (probabilityPercent === 0 || rng === undefined) {
    return 0;
  }

  let rewards = 0;
  for (let index = 0; index < quantity; index += 1) {
    if (rollProbabilityPercent(probabilityPercent, rng)) {
      rewards += 1;
    }
  }
  return rewards;
}

function applyRecipeOverrides(
  recipes: readonly ProductionRecipe[],
  overrides: readonly ProductionRecipeOverride[],
): readonly ProductionRecipe[] {
  if (overrides.length === 0) {
    return recipes;
  }

  return recipes.map((recipe) => {
    const override = overrides.find((candidate) => candidate.output === recipe.output);
    return override === undefined ? recipe : { ...recipe, ...override };
  });
}
