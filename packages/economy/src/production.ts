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
  readonly energy: number;
  readonly satiety: number;
  readonly availableLaborSeconds: number;
  readonly inventory: Inventory;
};

export type ProductionRejectionReason =
  | 'commodity-not-producible'
  | 'residential-tier-too-low'
  | 'insufficient-input'
  | 'insufficient-energy'
  | 'insufficient-satiety'
  | 'insufficient-labor';

export type ProductionPlan =
  | {
      readonly status: 'accepted';
      readonly produced: Inventory;
      readonly consumedInputs: Inventory;
      readonly energyCost: number;
      readonly satietyCost: number;
      readonly laborSeconds: number;
    }
  | {
      readonly status: 'rejected';
      readonly reason: ProductionRejectionReason;
      readonly detail: string;
    };

export type ProductionRecipeOverride = {
  readonly output: string;
} & Partial<Omit<ProductionRecipe, 'output'>>;

export function planProduction(input: {
  readonly commodityName: string;
  readonly quantity: number;
  readonly agent: ProductionAgentState;
  readonly rng?: SeededRandom;
  readonly commodityCatalog?: readonly CommodityConfig[];
  readonly recipeCatalog?: readonly ProductionRecipe[];
  readonly recipeOverrides?: readonly ProductionRecipeOverride[];
}): ProductionPlan {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return reject('commodity-not-producible', `quantity must be a positive integer`);
  }

  const commodityCatalog = input.commodityCatalog ?? commodities;
  const recipeCatalog = applyRecipeOverrides(
    input.recipeCatalog ?? productionRecipes,
    input.recipeOverrides ?? [],
  );
  const commodity = commodityCatalog.find((candidate) => candidate.name === input.commodityName);
  const recipe = recipeCatalog.find((candidate) => candidate.output === input.commodityName);

  if (commodity === undefined || recipe === undefined) {
    return reject('commodity-not-producible', `${input.commodityName} has no production recipe`);
  }

  if (
    commodity.minResidentialTier !== null &&
    input.agent.residentialTier < commodity.minResidentialTier
  ) {
    return reject(
      'residential-tier-too-low',
      `${input.commodityName} requires residential tier ${commodity.minResidentialTier}`,
    );
  }

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

  const energyCost = recipe.energyCost * input.quantity;
  if (input.agent.energy < energyCost) {
    return reject(
      'insufficient-energy',
      `energy requires ${energyCost}, available ${input.agent.energy}`,
    );
  }

  const satietyCost = recipe.satietyCost * input.quantity;
  if (input.agent.satiety < satietyCost) {
    return reject(
      'insufficient-satiety',
      `satiety requires ${satietyCost}, available ${input.agent.satiety}`,
    );
  }

  const laborSeconds = recipe.timeCostSeconds * input.quantity;
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
  };
}

function reject(reason: ProductionRejectionReason, detail: string): ProductionPlan {
  return { status: 'rejected', reason, detail };
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
