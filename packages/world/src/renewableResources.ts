import {
  assertValidRenewableResourcePolicy,
  evaluateRenewableResourceExtraction,
  evaluateRenewableResourceRegeneration,
  type RenewableResourcePolicy,
} from '@aivilization/economy';
import type { WorldProjection } from './projection';
import { resolveAgentRegion } from './regionalMarkets';

export type WorldRenewableResourceAvailability = {
  readonly regionId: string;
  readonly commodityName: string;
  readonly availableStock: number;
  readonly carryingCapacity: number;
  readonly regenerationPerCadence: number;
  readonly regenerationCadenceMs: number;
  readonly cadenceCount: number;
  readonly lastRegenerationAt: number;
  readonly nextRegenerationAt: number;
  readonly policyVersion: string;
  readonly regeneration?: ReturnType<typeof evaluateRenewableResourceRegeneration>;
};

/**
 * Resolves the same catch-up stock used by authoritative production settlement.
 * Read models call this function too, so an Agent never plans against a
 * different resource formula from the command handler.
 */
export function resolveWorldRenewableResourceAvailability(input: {
  readonly projection: WorldProjection;
  readonly agentLocationId: string | null;
  readonly commodityName: string;
  readonly policy: RenewableResourcePolicy;
}): WorldRenewableResourceAvailability | undefined {
  assertValidRenewableResourcePolicy(input.policy);
  const resource = input.policy.resources.find(
    (candidate) => candidate.commodityName === input.commodityName,
  );
  if (resource === undefined) {
    return undefined;
  }
  const regionId = resolveAgentRegion({
    projection: input.projection,
    agentLocationId: input.agentLocationId,
  });
  const current = input.projection.renewableResources?.[regionId]?.[input.commodityName];
  if (current !== undefined && current.policyVersion !== input.policy.policyVersion) {
    throw new Error(
      `renewable resource ${regionId}/${input.commodityName} requires an explicit policy migration from ${current.policyVersion} to ${input.policy.policyVersion}`,
    );
  }
  const previousLastRegenerationAt = current?.lastRegenerationAt ?? 0;
  const settledThrough =
    Math.floor(input.projection.clock.now / input.policy.regenerationCadenceMs) *
    input.policy.regenerationCadenceMs;
  const cadenceCount = Math.max(
    0,
    Math.floor(
      (settledThrough - previousLastRegenerationAt) / input.policy.regenerationCadenceMs,
    ),
  );
  let availableStock = current?.stock ?? resource.initialStock;
  let regeneration: ReturnType<typeof evaluateRenewableResourceRegeneration> | undefined;
  for (let cadence = 0; cadence < cadenceCount; cadence += 1) {
    const decision = evaluateRenewableResourceRegeneration({
      resource,
      currentStock: availableStock,
      policyVersion: input.policy.policyVersion,
    });
    regeneration =
      regeneration === undefined
        ? decision
        : {
            ...decision,
            previousStock: regeneration.previousStock,
            regeneratedStock: decision.nextStock - regeneration.previousStock,
          };
    availableStock = decision.nextStock;
  }
  const lastRegenerationAt =
    cadenceCount === 0 ? previousLastRegenerationAt : settledThrough;
  return {
    regionId,
    commodityName: input.commodityName,
    availableStock,
    carryingCapacity: resource.carryingCapacity,
    regenerationPerCadence: resource.regenerationPerCadence,
    regenerationCadenceMs: input.policy.regenerationCadenceMs,
    cadenceCount,
    lastRegenerationAt,
    nextRegenerationAt: lastRegenerationAt + input.policy.regenerationCadenceMs,
    policyVersion: input.policy.policyVersion,
    ...(regeneration === undefined ? {} : { regeneration }),
  };
}

export function evaluateWorldRenewableResourceProduction(input: {
  readonly projection: WorldProjection;
  readonly agentLocationId: string | null;
  readonly commodityName: string;
  readonly outputQuantity: number;
  readonly policy: RenewableResourcePolicy;
}):
  | (WorldRenewableResourceAvailability & {
      readonly extraction: ReturnType<typeof evaluateRenewableResourceExtraction>;
    })
  | undefined {
  const availability = resolveWorldRenewableResourceAvailability(input);
  if (availability === undefined) {
    return undefined;
  }
  return {
    ...availability,
    extraction: evaluateRenewableResourceExtraction({
      commodityName: input.commodityName,
      outputQuantity: input.outputQuantity,
      currentStock: availability.availableStock,
      policy: input.policy,
    }),
  };
}
