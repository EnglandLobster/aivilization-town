import type {
  ExternalMarketLiquidityPolicy,
  ExternalTradePolicy,
  ProductionEfficiencyPolicy,
  ProductionRecipeOverride,
} from '@aivilization/economy';
import type { EnterprisePolicy } from '@aivilization/enterprise';
import type {
  ConsumptionPolicy,
  LifestylePolicy,
  PublicBudgetPolicy,
  TaxPolicy,
} from '@aivilization/society';

/** Policy port owned by the economic application boundary in world. */
export type WorldEconomicPolicies = {
  readonly production?: {
    readonly recipeOverrides?: readonly ProductionRecipeOverride[];
    readonly efficiency?: ProductionEfficiencyPolicy;
  };
  readonly tradeActivity?: {
    readonly durationSeconds: number;
  };
  readonly regionalMarkets?: {
    readonly enabled: boolean;
  };
  readonly tax?: TaxPolicy;
  readonly lifestyle?: LifestylePolicy;
  readonly consumption?: ConsumptionPolicy;
  readonly externalMarket?: ExternalMarketLiquidityPolicy;
  /**
   * Optional external-trade policy (town ↔ external sector import/export).
   * When present, AgentExportCommodity/AgentImportCommodity settle against the
   * trader's regional spot price adjusted by the rolling net-export balance,
   * and AdvanceSimulationTime decays the balances once per cadence. Omitted
   * rejects both commands and keeps the world external-trade-free,
   * byte-for-byte.
   */
  readonly externalTrade?: ExternalTradePolicy;
  readonly publicBudget?: PublicBudgetPolicy;
  readonly enterprise?: EnterprisePolicy;
};
