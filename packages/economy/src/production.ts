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
  readonly energy: number;
  readonly satiety: number;
  readonly availableLaborSeconds: number;
  readonly inventory: Inventory;
};

export type ProductionEfficiencyPolicy = {
  readonly minEfficiency: number;
  readonly educationScoreForMaxEfficiency: number;
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
          educationScore: input.agent.educationScore ?? 0,
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
  readonly educationScore: number;
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
  if (!Number.isFinite(input.educationScore) || input.educationScore < 0) {
    return rejectEfficiency('educationScore must be non-negative');
  }

  const educationProgress = Math.min(
    1,
    input.educationScore / input.policy.educationScoreForMaxEfficiency,
  );
  return {
    status: 'accepted',
    efficiency: input.policy.minEfficiency + (1 - input.policy.minEfficiency) * educationProgress,
  };
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
