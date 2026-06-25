import { commodities, jobTiers, occupations } from '@aivilization/content';
import {
  evaluateProductionEfficiency,
  getInventoryQuantity,
  getSpotPrice,
  resolveProductionDefinition,
  scaleProductionCost,
} from '@aivilization/economy';
import type {
  WorldDecisionContext,
  WorldDecisionOccupationRule,
  WorldDecisionProductionRule,
  WorldDecisionRulesContext,
} from '@aivilization/agent-runtime';
import type { AgentId } from '@aivilization/sim-core';
import {
  calculateApplicationQuota,
  calculateEffectiveKnowledgeThreshold,
} from '@aivilization/society';
import type {
  WorldAgentState,
  WorldCommandPolicies,
  WorldMarketPriceIndexState,
  WorldProjection,
} from '@aivilization/world';

export function createWorldDecisionContextFromProjection(input: {
  readonly projection: WorldProjection;
  readonly agentId: AgentId;
  readonly policies?: WorldCommandPolicies;
}): WorldDecisionContext {
  const agent = input.projection.agents[input.agentId];
  if (agent === undefined) {
    throw new Error(`cannot create world decision context for unknown agent ${input.agentId}`);
  }

  const latestPriceIndex = resolveLatestPriceIndex(input.projection.marketPriceIndices);
  const rules =
    input.policies === undefined
      ? undefined
      : createWorldDecisionRulesContext({
          projection: input.projection,
          agent,
          policies: input.policies,
        });
  return {
    agent: {
      agentId: agent.agentId,
      locationId: agent.locationId,
      physiology: { ...agent.physiology },
      educationScore: agent.educationScore,
      balance: agent.balance,
      residentialTier: agent.residentialTier,
      job: agent.job,
      inventory: copyPositiveSortedRecord(agent.inventory),
    },
    market: {
      spotPrices: Object.values(input.projection.marketPools)
        .map((pool) => ({
          commodity: pool.commodity,
          spotPrice: getSpotPrice(pool),
        }))
        .sort((left, right) => left.commodity.localeCompare(right.commodity)),
      ...(latestPriceIndex === undefined
        ? {}
        : {
            latestPriceIndex: {
              baselineAt: latestPriceIndex.baselineAt,
              recordedAt: latestPriceIndex.recordedAt,
              overall: latestPriceIndex.overall,
              ratios: copyPositiveSortedRecord(latestPriceIndex.ratios),
            },
          }),
    },
    ...(rules === undefined ? {} : { rules }),
  };
}

function resolveLatestPriceIndex(
  indices: readonly WorldMarketPriceIndexState[],
): WorldMarketPriceIndexState | undefined {
  return indices.reduce<WorldMarketPriceIndexState | undefined>(
    (latest, candidate) =>
      latest === undefined || candidate.recordedAt > latest.recordedAt ? candidate : latest,
    undefined,
  );
}

function copyPositiveSortedRecord(
  values: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function createWorldDecisionRulesContext(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly policies: WorldCommandPolicies;
}): WorldDecisionRulesContext {
  return {
    criticalThresholds: { ...input.policies.criticalThresholds },
    occupations: createOccupationRules(input),
    production: createProductionRules(input),
  };
}

function createOccupationRules(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly policies: WorldCommandPolicies;
}): readonly WorldDecisionOccupationRule[] {
  const jobApplication = input.policies.jobApplication;
  if (jobApplication === undefined) {
    return [];
  }

  const currentApplications = input.projection.jobApplications.filter(
    (application) => application.agentId === input.agent.agentId,
  ).length;
  const applicationLimit = calculateApplicationQuota({
    residentialTier: input.agent.residentialTier,
    quotaByResidentialTier: jobApplication.quotaByResidentialTier,
  });

  return occupations
    .map((occupation): WorldDecisionOccupationRule => {
      const jobTier = resolveJobTier(occupation.jobTier);
      const occupationThreshold = calculateEffectiveKnowledgeThreshold({
        educationScores: jobApplication.populationEducationScores,
        educationFloor: occupation.educationFloor,
        eligibilityShare: occupation.eligibilityShare,
      });
      const effectiveEducationThreshold = Math.max(occupationThreshold, jobTier.minEducationScore);
      const requiredResidentialTier = Math.max(
        occupation.minResidentialTier,
        jobTier.minResidentialTier,
      );
      const rejectionReasons = createOccupationRejectionReasons({
        agent: input.agent,
        effectiveEducationThreshold,
        requiredResidentialTier,
        prerequisiteCommodity: jobTier.prerequisiteCommodity,
        applicationLimit,
        currentApplications,
      });

      return {
        occupationName: occupation.name,
        jobTier: occupation.jobTier,
        baseWage: occupation.baseWage,
        effectiveEducationThreshold,
        requiredResidentialTier,
        prerequisiteCommodity: jobTier.prerequisiteCommodity,
        eligible: rejectionReasons.length === 0,
        rejectionReasons,
        applicationQuota: {
          residentialTier: input.agent.residentialTier,
          limit: applicationLimit,
          currentApplications,
          remaining: Math.max(0, applicationLimit - currentApplications),
        },
      };
    })
    .sort(
      (left, right) =>
        left.jobTier - right.jobTier || left.occupationName.localeCompare(right.occupationName),
    );
}

function createOccupationRejectionReasons(input: {
  readonly agent: WorldAgentState;
  readonly effectiveEducationThreshold: number;
  readonly requiredResidentialTier: number;
  readonly prerequisiteCommodity: string | null;
  readonly applicationLimit: number;
  readonly currentApplications: number;
}): readonly string[] {
  const reasons: string[] = [];
  if (input.currentApplications >= input.applicationLimit) {
    reasons.push('application-quota-exhausted');
  }
  if (input.agent.residentialTier < input.requiredResidentialTier) {
    reasons.push('residential-tier-too-low');
  }
  if (input.agent.educationScore < input.effectiveEducationThreshold) {
    reasons.push('education-too-low');
  }
  if (
    input.prerequisiteCommodity !== null &&
    getInventoryQuantity(input.agent.inventory, input.prerequisiteCommodity) < 1
  ) {
    reasons.push('missing-prerequisite');
  }
  return reasons;
}

function createProductionRules(input: {
  readonly agent: WorldAgentState;
  readonly policies: WorldCommandPolicies;
}): readonly WorldDecisionProductionRule[] {
  return commodities
    .flatMap((commodity): readonly WorldDecisionProductionRule[] => {
      const definition = resolveProductionDefinition(commodity.name, {
        ...(input.policies.production?.recipeOverrides === undefined
          ? {}
          : { recipeOverrides: input.policies.production.recipeOverrides }),
      });
      if (definition === undefined) {
        return [];
      }

      const productionEfficiencyDecision =
        input.policies.production?.efficiency === undefined
          ? undefined
          : evaluateProductionEfficiency({
              agent: {
                residentialTier: input.agent.residentialTier,
                educationScore: input.agent.educationScore,
                energy: input.agent.physiology.energy,
                satiety: input.agent.physiology.satiety,
                health: input.agent.physiology.health,
              },
              policy: input.policies.production.efficiency,
            });
      const productionEfficiency =
        productionEfficiencyDecision?.status === 'accepted'
          ? productionEfficiencyDecision.efficiency
          : undefined;
      const energyCost = scaleProductionCost(definition.recipe.energyCost, productionEfficiency);
      const satietyCost = scaleProductionCost(definition.recipe.satietyCost, productionEfficiency);
      const timeCostSeconds = scaleProductionCost(
        definition.recipe.timeCostSeconds,
        productionEfficiency,
      );
      const rejectionReasons = createProductionRejectionReasons({
        agent: input.agent,
        rule: {
          minResidentialTier: definition.commodity.minResidentialTier,
          inputs: definition.recipe.inputs,
          energyCost,
          satietyCost,
        },
        productionEfficiencyRejected: productionEfficiencyDecision?.status === 'rejected',
      });

      return [
        {
          commodity: commodity.name,
          minResidentialTier: definition.commodity.minResidentialTier,
          inputs: copyPositiveSortedRecord(definition.recipe.inputs),
          energyCost,
          satietyCost,
          timeCostSeconds,
          producible: rejectionReasons.length === 0,
          rejectionReasons,
        },
      ];
    })
    .sort((left, right) => left.commodity.localeCompare(right.commodity));
}

function createProductionRejectionReasons(input: {
  readonly agent: WorldAgentState;
  readonly rule: {
    readonly minResidentialTier: number | null;
    readonly inputs: Readonly<Record<string, number>>;
    readonly energyCost: number;
    readonly satietyCost: number;
  };
  readonly productionEfficiencyRejected: boolean;
}): readonly string[] {
  const reasons: string[] = [];
  if (
    input.rule.minResidentialTier !== null &&
    input.agent.residentialTier < input.rule.minResidentialTier
  ) {
    reasons.push('residential-tier-too-low');
  }
  if (input.productionEfficiencyRejected) {
    reasons.push('policy-invalid');
  }
  if (hasMissingInputs({ inventory: input.agent.inventory, inputs: input.rule.inputs })) {
    reasons.push('insufficient-input');
  }
  if (input.agent.physiology.energy < input.rule.energyCost) {
    reasons.push('insufficient-energy');
  }
  if (input.agent.physiology.satiety < input.rule.satietyCost) {
    reasons.push('insufficient-satiety');
  }
  return reasons;
}

function hasMissingInputs(input: {
  readonly inventory: Readonly<Record<string, number>>;
  readonly inputs: Readonly<Record<string, number>>;
}): boolean {
  return Object.entries(input.inputs).some(
    ([itemName, requiredQuantity]) =>
      getInventoryQuantity(input.inventory, itemName) < requiredQuantity,
  );
}

function resolveJobTier(tier: number): (typeof jobTiers)[number] {
  const jobTier = jobTiers.find((candidate) => candidate.tier === tier);
  if (jobTier === undefined) {
    throw new Error(`missing job tier ${tier}`);
  }
  return jobTier;
}
