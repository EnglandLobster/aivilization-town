import {
  buyFromPool,
  evaluateExternalExportPrice,
  evaluateExternalImportPrice,
  getSpotPrice,
  sellToPool,
  type AmmPool,
  type ExternalTradePolicy,
} from '@aivilization/economy';
import type { AgentId } from '@aivilization/sim-core';
import { isEnterpriseOperational, type WorldEnterpriseState } from '@aivilization/world';

export const EXTERNAL_TRADE_ACTION_PROPOSER_POLICY_VERSION = 'external-trade-action-proposer-v1';

/**
 * Worker-side decision policy for nominating enterprise external trades. It
 * does not alter settlement: economy still owns prices and world still owns
 * authorization, inventory, accounting, and event emission.
 */
export type ExternalTradeActionProposerPolicy = {
  readonly policyVersion: string;
  /** Strict relative advantage required over the currently visible town AMM. */
  readonly minimumRelativeAdvantageRatio: number;
};

export const DEFAULT_EXTERNAL_TRADE_ACTION_PROPOSER_POLICY: ExternalTradeActionProposerPolicy = {
  policyVersion: EXTERNAL_TRADE_ACTION_PROPOSER_POLICY_VERSION,
  minimumRelativeAdvantageRatio: 0,
};

export function createExternalTradeActionProposerPolicyManifest() {
  return {
    ...DEFAULT_EXTERNAL_TRADE_ACTION_PROPOSER_POLICY,
    actorEligibility: 'operational-enterprise-owner-only' as const,
    comparison:
      'external-total-versus-current-visible-regional-amm-total-for-equal-quantity' as const,
    selection:
      'largest-relative-advantage-then-owner-enterprise-id-commodity-export-before-import' as const,
  };
}

export function assertValidExternalTradeActionProposerPolicy(
  policy: ExternalTradeActionProposerPolicy,
): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('external trade action proposer policyVersion must not be empty');
  }
  if (
    !Number.isFinite(policy.minimumRelativeAdvantageRatio) ||
    policy.minimumRelativeAdvantageRatio < 0 ||
    policy.minimumRelativeAdvantageRatio >= 1
  ) {
    throw new Error(
      'external trade action proposer minimumRelativeAdvantageRatio must be in [0, 1)',
    );
  }
}

export type ExternalTradePlanningQuote = {
  readonly commodityName: string;
  readonly quantity: number;
  readonly exportTotal: number;
  readonly importTotal: number;
};

export type EnterpriseExternalTradeOpportunity = {
  readonly direction: 'export' | 'import';
  readonly enterpriseId: string;
  readonly commodityName: string;
  readonly quantity: number;
  readonly externalTotal: number;
  readonly townMarketTotal: number;
  readonly relativeAdvantageRatio: number;
};

/** Build quantity-specific external quotes from the authoritative economy rule. */
export function createExternalTradePlanningQuotes(input: {
  readonly marketPools: Readonly<Record<string, AmmPool>>;
  readonly balancesByCommodity: Readonly<Record<string, number>>;
  readonly quantity: number;
  readonly externalTradePolicy: ExternalTradePolicy;
}): readonly ExternalTradePlanningQuote[] {
  assertPositiveFinite(input.quantity, 'external trade planning quantity');
  const poolsByCommodity = indexVisiblePoolsByCommodity(input.marketPools);
  return [...poolsByCommodity.entries()]
    .map(([commodityName, pool]) => {
      const netExportBalance = input.balancesByCommodity[commodityName] ?? 0;
      return {
        commodityName,
        quantity: input.quantity,
        exportTotal: evaluateExternalExportPrice({
          spotPrice: getSpotPrice(pool),
          quantity: input.quantity,
          netExportBalance,
          policy: input.externalTradePolicy,
        }).total,
        importTotal: evaluateExternalImportPrice({
          spotPrice: getSpotPrice(pool),
          quantity: input.quantity,
          netExportBalance,
          policy: input.externalTradePolicy,
        }).total,
      };
    })
    .sort((left, right) => left.commodityName.localeCompare(right.commodityName));
}

/**
 * Select the best executable enterprise-side opportunity. Automatic proposals
 * are owner-only even though world also accepts explicitly-issued employee
 * commands: this prevents every employee from independently draining the same
 * enterprise inventory or cash during autonomous planning.
 */
export function resolveEnterpriseExternalTradeOpportunity(input: {
  readonly agentId: AgentId;
  readonly enterprises: Readonly<Record<string, WorldEnterpriseState>>;
  readonly marketPools: Readonly<Record<string, AmmPool>>;
  readonly externalQuotes: readonly ExternalTradePlanningQuote[];
  readonly quantity: number;
  readonly proposerPolicy?: ExternalTradeActionProposerPolicy;
  readonly direction?: 'export' | 'import';
  readonly commodityName?: string;
}): EnterpriseExternalTradeOpportunity | undefined {
  assertPositiveFinite(input.quantity, 'external trade opportunity quantity');
  const proposerPolicy = input.proposerPolicy ?? DEFAULT_EXTERNAL_TRADE_ACTION_PROPOSER_POLICY;
  assertValidExternalTradeActionProposerPolicy(proposerPolicy);

  const poolsByCommodity = indexVisiblePoolsByCommodity(input.marketPools);
  const quotesByCommodity = new Map(
    input.externalQuotes.map((quote) => [quote.commodityName, quote] as const),
  );
  const directions =
    input.direction === undefined ? (['export', 'import'] as const) : ([input.direction] as const);
  const opportunities: EnterpriseExternalTradeOpportunity[] = [];

  for (const enterprise of Object.values(input.enterprises)
    .filter(
      (candidate) => candidate.ownerAgentId === input.agentId && isEnterpriseOperational(candidate),
    )
    .sort((left, right) => left.enterpriseId.localeCompare(right.enterpriseId))) {
    const commodityNames =
      input.commodityName === undefined
        ? [...quotesByCommodity.keys()].sort((left, right) => left.localeCompare(right))
        : [input.commodityName];

    for (const commodityName of commodityNames) {
      const pool = poolsByCommodity.get(commodityName);
      const externalQuote = quotesByCommodity.get(commodityName);
      if (pool === undefined || externalQuote === undefined) {
        continue;
      }
      if (externalQuote.quantity !== input.quantity) {
        continue;
      }

      for (const direction of directions) {
        const opportunity = evaluateOpportunity({
          enterprise,
          pool,
          externalQuote,
          direction,
          commodityName,
          quantity: input.quantity,
          proposerPolicy,
        });
        if (opportunity !== undefined) {
          opportunities.push(opportunity);
        }
      }
    }
  }

  return opportunities.sort(compareOpportunities)[0];
}

function evaluateOpportunity(input: {
  readonly enterprise: WorldEnterpriseState;
  readonly pool: AmmPool;
  readonly externalQuote: ExternalTradePlanningQuote;
  readonly direction: 'export' | 'import';
  readonly commodityName: string;
  readonly quantity: number;
  readonly proposerPolicy: ExternalTradeActionProposerPolicy;
}): EnterpriseExternalTradeOpportunity | undefined {
  try {
    if (input.direction === 'export') {
      if ((input.enterprise.inventory[input.commodityName] ?? 0) < input.quantity) {
        return undefined;
      }
      const townMarketTotal = -sellToPool(input.pool, input.quantity).currencyDelta;
      return createOpportunityWhenAdvantageous({
        direction: input.direction,
        enterpriseId: input.enterprise.enterpriseId,
        commodityName: input.commodityName,
        quantity: input.quantity,
        externalTotal: input.externalQuote.exportTotal,
        townMarketTotal,
        proposerPolicy: input.proposerPolicy,
      });
    }

    const townMarketTotal = buyFromPool(input.pool, input.quantity).currencyDelta;
    if (input.enterprise.balance < input.externalQuote.importTotal) {
      return undefined;
    }
    return createOpportunityWhenAdvantageous({
      direction: input.direction,
      enterpriseId: input.enterprise.enterpriseId,
      commodityName: input.commodityName,
      quantity: input.quantity,
      externalTotal: input.externalQuote.importTotal,
      townMarketTotal,
      proposerPolicy: input.proposerPolicy,
    });
  } catch {
    // Invalid/oversized AMM quotes are not executable opportunities. World
    // remains the final authority and will independently validate any command.
    return undefined;
  }
}

function createOpportunityWhenAdvantageous(input: {
  readonly direction: 'export' | 'import';
  readonly enterpriseId: string;
  readonly commodityName: string;
  readonly quantity: number;
  readonly externalTotal: number;
  readonly townMarketTotal: number;
  readonly proposerPolicy: ExternalTradeActionProposerPolicy;
}): EnterpriseExternalTradeOpportunity | undefined {
  if (
    !Number.isFinite(input.externalTotal) ||
    input.externalTotal <= 0 ||
    !Number.isFinite(input.townMarketTotal) ||
    input.townMarketTotal <= 0
  ) {
    return undefined;
  }
  const advantageAmount =
    input.direction === 'export'
      ? input.externalTotal - input.townMarketTotal
      : input.townMarketTotal - input.externalTotal;
  const relativeAdvantageRatio = advantageAmount / input.townMarketTotal;
  if (!(relativeAdvantageRatio > input.proposerPolicy.minimumRelativeAdvantageRatio + 1e-12)) {
    return undefined;
  }
  return {
    direction: input.direction,
    enterpriseId: input.enterpriseId,
    commodityName: input.commodityName,
    quantity: input.quantity,
    externalTotal: input.externalTotal,
    townMarketTotal: input.townMarketTotal,
    relativeAdvantageRatio,
  };
}

function indexVisiblePoolsByCommodity(
  marketPools: Readonly<Record<string, AmmPool>>,
): ReadonlyMap<string, AmmPool> {
  const result = new Map<string, AmmPool>();
  for (const [, pool] of Object.entries(marketPools).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!result.has(pool.commodity)) {
      result.set(pool.commodity, pool);
    }
  }
  return result;
}

function compareOpportunities(
  left: EnterpriseExternalTradeOpportunity,
  right: EnterpriseExternalTradeOpportunity,
): number {
  const difference = right.relativeAdvantageRatio - left.relativeAdvantageRatio;
  if (Math.abs(difference) > 1e-12) {
    return difference;
  }
  return (
    left.enterpriseId.localeCompare(right.enterpriseId) ||
    left.commodityName.localeCompare(right.commodityName) ||
    (left.direction === right.direction ? 0 : left.direction === 'export' ? -1 : 1)
  );
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive finite`);
  }
}
