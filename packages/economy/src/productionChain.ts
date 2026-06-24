import type { CommodityConfig, ProductionRecipe } from '@aivilization/content';
import { addInventory, getInventoryQuantity, removeInventory, type Inventory } from './inventory';
import {
  evaluateProductionEfficiency,
  resolveProductionDefinition,
  scaleProductionCost,
  type ProductionAgentState,
  type ProductionCatalogInput,
  type ProductionDefinition,
  type ProductionEfficiencyPolicy,
  type ProductionRecipeOverride,
  type ProductionRejectionReason,
} from './production';

export type ProductionChainStep = {
  readonly commodityName: string;
  readonly quantity: number;
  readonly produced: Inventory;
  readonly consumedInputs: Inventory;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly laborSeconds: number;
  readonly productionEfficiency?: number;
};

export type ProductionChainRejectionReason = ProductionRejectionReason | 'cyclic-recipe';

export type ProductionChainPlan =
  | {
      readonly status: 'accepted';
      readonly targetCommodityName: string;
      readonly targetQuantity: number;
      readonly steps: readonly ProductionChainStep[];
      readonly inventoryAfter: Inventory;
      readonly inventoryDelta: Readonly<Record<string, number>>;
      readonly energyCost: number;
      readonly satietyCost: number;
      readonly laborSeconds: number;
    }
  | {
      readonly status: 'rejected';
      readonly reason: ProductionChainRejectionReason;
      readonly detail: string;
      readonly blockingCommodityName?: string;
    };

type ProductionChainInput = {
  readonly commodityName: string;
  readonly quantity: number;
  readonly agent: ProductionAgentState;
  readonly commodityCatalog?: readonly CommodityConfig[];
  readonly recipeCatalog?: readonly ProductionRecipe[];
  readonly recipeOverrides?: readonly ProductionRecipeOverride[];
  readonly productionEfficiency?: ProductionEfficiencyPolicy;
};

type PlanningState = {
  readonly agent: ProductionAgentState;
  readonly catalog: ProductionCatalogInput;
  readonly virtualInventory: Record<string, number>;
  readonly requiredProduction: Map<string, number>;
  readonly definitions: Map<string, ProductionDefinition>;
  readonly productionEfficiency?: number;
};

type ProductionChainAcceptedPlan = Extract<ProductionChainPlan, { readonly status: 'accepted' }>;
type ProductionChainRejectedPlan = Extract<ProductionChainPlan, { readonly status: 'rejected' }>;

export function planProductionChain(input: ProductionChainInput): ProductionChainPlan {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return reject(
      'commodity-not-producible',
      'quantity must be a positive integer',
      input.commodityName,
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
    return reject(efficiencyDecision.reason, efficiencyDecision.detail, input.commodityName);
  }

  const state: PlanningState = {
    agent: input.agent,
    catalog: {
      ...(input.commodityCatalog === undefined ? {} : { commodityCatalog: input.commodityCatalog }),
      ...(input.recipeCatalog === undefined ? {} : { recipeCatalog: input.recipeCatalog }),
      ...(input.recipeOverrides === undefined ? {} : { recipeOverrides: input.recipeOverrides }),
    },
    virtualInventory: { ...input.agent.inventory },
    requiredProduction: new Map(),
    definitions: new Map(),
    ...(efficiencyDecision === undefined
      ? {}
      : { productionEfficiency: efficiencyDecision.efficiency }),
  };
  const expansion = addProductionRequirement(state, input.commodityName, input.quantity, []);
  if (expansion !== undefined) {
    return expansion;
  }

  const sortedCommodities = sortRequiredCommodities(state);
  if ('status' in sortedCommodities) {
    return sortedCommodities;
  }

  const steps = sortedCommodities.map((commodityName) =>
    createProductionChainStep({
      commodityName,
      quantity: requireRequiredQuantity(state, commodityName),
      definition: requireDefinition(state, commodityName),
      ...(state.productionEfficiency === undefined
        ? {}
        : { productionEfficiency: state.productionEfficiency }),
    }),
  );
  const totals = sumStepResources(steps);
  const budgetRejection = firstBudgetRejection({
    totals,
    agent: input.agent,
    blockingCommodityName: input.commodityName,
  });
  if (budgetRejection !== undefined) {
    return budgetRejection;
  }

  const inventoryAfter = applyStepsToInventory(input.agent.inventory, steps);

  return {
    status: 'accepted',
    targetCommodityName: input.commodityName,
    targetQuantity: input.quantity,
    steps,
    inventoryAfter,
    inventoryDelta: calculateInventoryDelta(input.agent.inventory, inventoryAfter),
    energyCost: totals.energyCost,
    satietyCost: totals.satietyCost,
    laborSeconds: totals.laborSeconds,
  };
}

function addProductionRequirement(
  state: PlanningState,
  commodityName: string,
  quantity: number,
  path: readonly string[],
): ProductionChainRejectedPlan | undefined {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return reject('commodity-not-producible', 'quantity must be a positive integer', commodityName);
  }
  if (path.includes(commodityName)) {
    return reject(
      'cyclic-recipe',
      `cyclic recipe dependency: ${[...path, commodityName].join(' -> ')}`,
      commodityName,
    );
  }

  const definition = resolveProductionDefinition(commodityName, state.catalog);
  if (definition === undefined) {
    return reject(
      'commodity-not-producible',
      `${commodityName} has no production recipe`,
      commodityName,
    );
  }
  if (
    definition.commodity.minResidentialTier !== null &&
    state.agent.residentialTier < definition.commodity.minResidentialTier
  ) {
    return reject(
      'residential-tier-too-low',
      `${commodityName} requires residential tier ${definition.commodity.minResidentialTier}`,
      commodityName,
    );
  }

  state.requiredProduction.set(
    commodityName,
    (state.requiredProduction.get(commodityName) ?? 0) + quantity,
  );
  state.definitions.set(commodityName, definition);

  for (const [inputName, inputQuantityPerUnit] of Object.entries(definition.recipe.inputs)) {
    const requiredQuantity = inputQuantityPerUnit * quantity;
    const availableQuantity = getInventoryQuantity(state.virtualInventory, inputName);
    const consumedQuantity = Math.min(availableQuantity, requiredQuantity);
    if (consumedQuantity > 0) {
      setInventoryQuantity(state.virtualInventory, inputName, availableQuantity - consumedQuantity);
    }

    const missingQuantity = requiredQuantity - consumedQuantity;
    if (missingQuantity > 0) {
      const nested = addProductionRequirement(state, inputName, missingQuantity, [
        ...path,
        commodityName,
      ]);
      if (nested !== undefined) {
        return nested;
      }
    }
  }

  return undefined;
}

function sortRequiredCommodities(
  state: PlanningState,
): readonly string[] | ProductionChainRejectedPlan {
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  for (const commodityName of state.requiredProduction.keys()) {
    const result = visitRequiredCommodity({
      commodityName,
      state,
      sorted,
      visited,
      visiting,
      path: [],
    });
    if (result !== undefined) {
      return result;
    }
  }

  return sorted;
}

function visitRequiredCommodity(input: {
  readonly commodityName: string;
  readonly state: PlanningState;
  readonly sorted: string[];
  readonly visited: Set<string>;
  readonly visiting: Set<string>;
  readonly path: readonly string[];
}): ProductionChainRejectedPlan | undefined {
  if (input.visited.has(input.commodityName)) {
    return undefined;
  }
  if (input.visiting.has(input.commodityName)) {
    return reject(
      'cyclic-recipe',
      `cyclic recipe dependency: ${[...input.path, input.commodityName].join(' -> ')}`,
      input.commodityName,
    );
  }

  input.visiting.add(input.commodityName);
  const definition = requireDefinition(input.state, input.commodityName);
  for (const inputName of Object.keys(definition.recipe.inputs)) {
    if (!input.state.requiredProduction.has(inputName)) {
      continue;
    }
    const nested = visitRequiredCommodity({
      commodityName: inputName,
      state: input.state,
      sorted: input.sorted,
      visited: input.visited,
      visiting: input.visiting,
      path: [...input.path, input.commodityName],
    });
    if (nested !== undefined) {
      return nested;
    }
  }

  input.visiting.delete(input.commodityName);
  input.visited.add(input.commodityName);
  input.sorted.push(input.commodityName);
  return undefined;
}

function createProductionChainStep(input: {
  readonly commodityName: string;
  readonly quantity: number;
  readonly definition: ProductionDefinition;
  readonly productionEfficiency?: number;
}): ProductionChainStep {
  return {
    commodityName: input.commodityName,
    quantity: input.quantity,
    produced: { [input.commodityName]: input.quantity },
    consumedInputs: multiplyInventory(input.definition.recipe.inputs, input.quantity),
    energyCost: scaleProductionCost(
      input.definition.recipe.energyCost * input.quantity,
      input.productionEfficiency,
    ),
    satietyCost: scaleProductionCost(
      input.definition.recipe.satietyCost * input.quantity,
      input.productionEfficiency,
    ),
    laborSeconds: scaleProductionCost(
      input.definition.recipe.timeCostSeconds * input.quantity,
      input.productionEfficiency,
    ),
    ...(input.productionEfficiency === undefined
      ? {}
      : { productionEfficiency: input.productionEfficiency }),
  };
}

function sumStepResources(
  steps: readonly ProductionChainStep[],
): Pick<ProductionChainAcceptedPlan, 'energyCost' | 'satietyCost' | 'laborSeconds'> {
  return steps.reduce(
    (totals, step) => ({
      energyCost: totals.energyCost + step.energyCost,
      satietyCost: totals.satietyCost + step.satietyCost,
      laborSeconds: totals.laborSeconds + step.laborSeconds,
    }),
    { energyCost: 0, satietyCost: 0, laborSeconds: 0 },
  );
}

function firstBudgetRejection(input: {
  readonly totals: Pick<ProductionChainAcceptedPlan, 'energyCost' | 'satietyCost' | 'laborSeconds'>;
  readonly agent: ProductionAgentState;
  readonly blockingCommodityName: string;
}): ProductionChainRejectedPlan | undefined {
  if (input.agent.energy < input.totals.energyCost) {
    return reject(
      'insufficient-energy',
      `energy requires ${input.totals.energyCost}, available ${input.agent.energy}`,
      input.blockingCommodityName,
    );
  }
  if (input.agent.satiety < input.totals.satietyCost) {
    return reject(
      'insufficient-satiety',
      `satiety requires ${input.totals.satietyCost}, available ${input.agent.satiety}`,
      input.blockingCommodityName,
    );
  }
  if (input.agent.availableLaborSeconds < input.totals.laborSeconds) {
    return reject(
      'insufficient-labor',
      `labor requires ${input.totals.laborSeconds}, available ${input.agent.availableLaborSeconds}`,
      input.blockingCommodityName,
    );
  }
  return undefined;
}

function applyStepsToInventory(
  initialInventory: Inventory,
  steps: readonly ProductionChainStep[],
): Inventory {
  return steps.reduce((inventory, step) => {
    const afterConsumption = Object.entries(step.consumedInputs).reduce(
      (nextInventory, [itemName, quantity]) => removeInventory(nextInventory, itemName, quantity),
      inventory,
    );

    return Object.entries(step.produced).reduce(
      (nextInventory, [itemName, quantity]) => addInventory(nextInventory, itemName, quantity),
      afterConsumption,
    );
  }, initialInventory);
}

function calculateInventoryDelta(
  before: Inventory,
  after: Inventory,
): Readonly<Record<string, number>> {
  const delta: Record<string, number> = {};
  for (const itemName of sortedUnique([...Object.keys(before), ...Object.keys(after)])) {
    const quantityDelta =
      getInventoryQuantity(after, itemName) - getInventoryQuantity(before, itemName);
    if (quantityDelta !== 0) {
      delta[itemName] = quantityDelta;
    }
  }
  return delta;
}

function multiplyInventory(inventory: Inventory, quantity: number): Inventory {
  return Object.fromEntries(
    Object.entries(inventory).map(([itemName, itemQuantity]) => [
      itemName,
      itemQuantity * quantity,
    ]),
  );
}

function setInventoryQuantity(
  inventory: Record<string, number>,
  itemName: string,
  quantity: number,
): void {
  if (quantity === 0) {
    delete inventory[itemName];
    return;
  }
  inventory[itemName] = quantity;
}

function requireRequiredQuantity(state: PlanningState, commodityName: string): number {
  const quantity = state.requiredProduction.get(commodityName);
  if (quantity === undefined) {
    throw new Error(`missing production requirement ${commodityName}`);
  }
  return quantity;
}

function requireDefinition(state: PlanningState, commodityName: string): ProductionDefinition {
  const definition = state.definitions.get(commodityName);
  if (definition === undefined) {
    throw new Error(`missing production definition ${commodityName}`);
  }
  return definition;
}

function reject(
  reason: ProductionChainRejectionReason,
  detail: string,
  blockingCommodityName?: string,
): ProductionChainRejectedPlan {
  return {
    status: 'rejected',
    reason,
    detail,
    ...(blockingCommodityName === undefined ? {} : { blockingCommodityName }),
  };
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
