/**
 * Regional land value index: a smoothed, deterministic pricing signal derived
 * from observable regional facts (population and market liquidity), inspired
 * by Cities: Skylines II where land value is an exogenous projection of local
 * attractiveness that feeds rent pricing. The index itself carries no money
 * flow; it only modulates housing upkeep rates via ResidentialUpkeepPolicy.
 *
 * The evaluator is a pure function: previous index + cadence inputs + policy
 * -> next index. The world integration layer is responsible for adapting
 * projection facts into RegionalLandValueInputs and for persisting results as
 * events so replays stay deterministic.
 */
export type LandValuePolicy = {
  readonly policyVersion: string;
  /** Simulation milliseconds between land value re-evaluations. */
  readonly updateCadenceMs: number;
  /** Base index every region starts from and decays toward. */
  readonly baseline: number;
  /** Weight on sqrt(agentCount) — diminishing returns for population. */
  readonly populationWeight: number;
  /** Weight on log1p(marketLiquidity) — diminishing returns for liquidity. */
  readonly liquidityWeight: number;
  /** Lerp factor toward the raw target per cadence, in (0, 1]. */
  readonly smoothingFactor: number;
  /** Inclusive clamp bounds for the index. */
  readonly minIndex: number;
  readonly maxIndex: number;
  readonly source?: string;
};

export type RegionalLandValueInputs = {
  /** Number of agents currently located in the region. */
  readonly agentCount: number;
  /**
   * Coin-side reserves summed over the region's AMM pools; 0 when the region
   * has no regional market pools.
   */
  readonly marketLiquidity: number;
  /** Non-negative contribution from the authority-settled service view. */
  readonly serviceQualityContribution?: number;
};

export type RegionalLandValueEvaluation = {
  /** Smoothed index after this cadence step. */
  readonly nextIndex: number;
  /** Unsmoothed clamped target for this cadence's inputs. */
  readonly rawIndex: number;
};

export function evaluateRegionalLandValue(input: {
  readonly previousIndex: number;
  readonly inputs: RegionalLandValueInputs;
  readonly policy: LandValuePolicy;
}): RegionalLandValueEvaluation {
  assertValidLandValuePolicy(input.policy);
  assertNonNegativeFinite(input.previousIndex, 'previousIndex');
  assertNonNegativeInteger(input.inputs.agentCount, 'agentCount');
  assertNonNegativeFinite(input.inputs.marketLiquidity, 'marketLiquidity');
  if (input.inputs.serviceQualityContribution !== undefined) {
    assertNonNegativeFinite(input.inputs.serviceQualityContribution, 'serviceQualityContribution');
  }

  const { policy } = input;
  const raw = clamp(
    policy.baseline +
      policy.populationWeight * Math.sqrt(input.inputs.agentCount) +
      policy.liquidityWeight * Math.log1p(input.inputs.marketLiquidity) +
      (input.inputs.serviceQualityContribution ?? 0),
    policy.minIndex,
    policy.maxIndex,
  );
  const next = input.previousIndex + (raw - input.previousIndex) * policy.smoothingFactor;
  return { nextIndex: next, rawIndex: raw };
}

export function assertValidLandValuePolicy(policy: LandValuePolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('land value policyVersion must not be empty');
  }
  if (!Number.isFinite(policy.updateCadenceMs) || policy.updateCadenceMs <= 0) {
    throw new Error('updateCadenceMs must be positive');
  }
  assertNonNegativeFinite(policy.baseline, 'baseline');
  assertNonNegativeFinite(policy.populationWeight, 'populationWeight');
  assertNonNegativeFinite(policy.liquidityWeight, 'liquidityWeight');
  if (
    !Number.isFinite(policy.smoothingFactor) ||
    policy.smoothingFactor <= 0 ||
    policy.smoothingFactor > 1
  ) {
    throw new Error('smoothingFactor must be in (0, 1]');
  }
  assertNonNegativeFinite(policy.minIndex, 'minIndex');
  assertNonNegativeFinite(policy.maxIndex, 'maxIndex');
  if (policy.minIndex > policy.maxIndex) {
    throw new Error('minIndex must not exceed maxIndex');
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
