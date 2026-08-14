import type { AmmPool, Inventory } from '@aivilization/economy';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import type {
  AgentId,
  CommandSource,
  ConversationId,
  CoreCommandType,
  EventEnvelope,
  HumanCommandAttribution,
  LoanId,
  LocationId,
  SimulationClock,
} from '@aivilization/sim-core';
import type {
  EducationExamResolutionReason,
  EducationExamResolutionStatus,
  EducationExamTargetLevel,
  EducationLevel,
  EducationTrack,
  PhysiologicalState,
  PhysiologicalAxis,
  PhysiologicalDistressState,
  RecruitmentApplicationResolutionStatus,
  RecruitmentResolutionReason,
  SocialRelationState,
} from '@aivilization/society';
import type { TownWeatherKind } from './weather';
import type { TownBulletin } from './bulletin';
import type { WorldSocialMatterState } from './matters';
import type { ConflictGrievance } from './conflict';

export const RUNTIME_AGENT_REGISTRATION_POLICY_VERSION = 'runtime-agent-registration-v3';
export const RUNTIME_AGENT_REGISTRATION_MAX_POPULATION = 100_000;
export const RUNTIME_AGENT_REGISTRATION_INITIAL_BALANCE = 100;
export const RUNTIME_AGENT_REGISTRATION_INITIAL_RESIDENTIAL_TIER = 1;
export const RUNTIME_AGENT_REGISTRATION_INITIAL_PHYSIOLOGY = {
  energy: 100,
  satiety: 100,
  health: 100,
} as const;

export type RuntimeAgentCreatorIdentityRule =
  | 'unverified-attribution-label'
  | 'authenticated-principal-subject';

export function createRuntimeAgentRegistrationPolicyManifest(
  input: {
    readonly creatorIdentityRule?: RuntimeAgentCreatorIdentityRule;
    readonly maxAgentsPerCreator?: number;
  } = {},
) {
  if (
    input.maxAgentsPerCreator !== undefined &&
    (!Number.isInteger(input.maxAgentsPerCreator) || input.maxAgentsPerCreator < 1)
  ) {
    throw new Error('maxAgentsPerCreator must be a positive integer');
  }
  return {
    policyVersion: RUNTIME_AGENT_REGISTRATION_POLICY_VERSION,
    identity: {
      allocation: 'caller-selected-validated-id',
      maximumLength: 128,
      allowedPattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
      duplicateRule: 'reject-with-authoritative-world-event',
    },
    maximumPopulationPerPartition: RUNTIME_AGENT_REGISTRATION_MAX_POPULATION,
    maximumAgentsPerCreator: input.maxAgentsPerCreator ?? null,
    creatorQuotaAuthority: 'world-command-replay',
    initialState: {
      locationId: null,
      physiology: { ...RUNTIME_AGENT_REGISTRATION_INITIAL_PHYSIOLOGY },
      educationScore: 0,
      balance: RUNTIME_AGENT_REGISTRATION_INITIAL_BALANCE,
      residentialTier: RUNTIME_AGENT_REGISTRATION_INITIAL_RESIDENTIAL_TIER,
      job: null,
      inventory: {},
    },
    moneySupplyRule: 'increase-by-initial-agent-balance',
    provenanceRule: 'manifest-seeded-versus-post-bootstrap-command',
    creatorIdentityRule: input.creatorIdentityRule ?? 'unverified-attribution-label',
  } as const;
}

export type AgentRegisteredPayload = {
  readonly registrationId: string;
  readonly policyVersion:
    | 'runtime-agent-registration-v1'
    | 'runtime-agent-registration-v2'
    | typeof RUNTIME_AGENT_REGISTRATION_POLICY_VERSION;
  readonly creatorId: string;
  readonly source: CommandSource;
  readonly displayName: string;
  readonly agentId: AgentId;
  readonly initialState: {
    readonly locationId: null;
    readonly physiology: PhysiologicalState;
    readonly educationScore: number;
    readonly balance: number;
    readonly residentialTier: number;
    readonly job: null;
    readonly inventory: Inventory;
  };
  readonly moneySupplyDelta: number;
  readonly humanAttribution?: HumanCommandAttribution;
};

export type AgentRegistrationRejectedPayload = {
  readonly registrationId: string;
  readonly policyVersion:
    | 'runtime-agent-registration-v1'
    | 'runtime-agent-registration-v2'
    | typeof RUNTIME_AGENT_REGISTRATION_POLICY_VERSION;
  readonly creatorId: string;
  readonly source: CommandSource;
  readonly displayName: string;
  readonly agentId: AgentId;
  readonly reason:
    | 'agent-id-already-exists'
    | 'population-capacity-reached'
    | 'creator-agent-quota-reached'
    | 'invalid-registration-payload';
  readonly detail?: string;
  readonly humanAttribution?: HumanCommandAttribution;
};

export type InventoryChangedPayload = {
  readonly agentId: AgentId;
  readonly itemName: string;
  readonly delta: number;
  readonly reason: string;
};

export type CommodityConsumedPayload = {
  readonly agentId: AgentId;
  readonly commodityName: string;
  readonly quantity: number;
  readonly utilityPoints: number;
  readonly kind: 'consumable' | 'durable';
  readonly durableLotId?: string;
  readonly expiresAt?: number;
  readonly policyVersion: string;
};

export type DurableGoodExpiredPayload = {
  readonly agentId: AgentId;
  readonly lotId: string;
  readonly commodityName: string;
  readonly quantity: number;
  readonly expiredAt: number;
};

export type PhysiologyChangedPayload = {
  readonly agentId: AgentId;
  readonly previous: PhysiologicalState;
  readonly next: PhysiologicalState;
  readonly reason: string;
};

export type PhysiologicalDistressChangedPayload =
  | {
      readonly agentId: AgentId;
      readonly status: 'active';
      readonly state: PhysiologicalDistressState;
      readonly evaluatedAt: number;
      readonly reason: 'started' | 'updated';
    }
  | {
      readonly agentId: AgentId;
      readonly status: 'cleared';
      readonly previousState: PhysiologicalDistressState;
      readonly evaluatedAt: number;
      readonly reason: 'recovered';
    };

export type SafetyNetGrantedPayload = {
  readonly agentId: AgentId;
  readonly policyVersion: string;
  readonly grantedAt: number;
  readonly distressDurationMs: number;
  readonly lowAxes: readonly PhysiologicalAxis[];
  readonly inventory: Inventory;
  readonly reason: 'persistent-physiological-distress';
};

export type EducationChangedPayload = {
  readonly agentId: AgentId;
  readonly previousEducationScore: number;
  readonly nextEducationScore: number;
  readonly reason: string;
};

export type EducationInvestmentPaidPayload = {
  readonly agentId: AgentId;
  readonly durationSeconds: number;
  readonly currencyCost: number;
  readonly previousBalance: number;
  readonly nextBalance: number;
  readonly consumedInventory: Inventory;
  readonly reason: string;
};

/**
 * An agent advanced one discrete education level. Under education-system-v2
 * both automatic promotion inside the compulsory stage (0→1, 1→2) and admitted
 * exam resolutions (中考/高考/考研放榜) settle this event; `track` is carried
 * only when the transition also assigns a track (admitted 中考 exam
 * resolutions) and is always absent on automatic promotions.
 */
export type EducationLevelChangedPayload = {
  readonly agentId: AgentId;
  readonly previousLevel: EducationLevel;
  readonly nextLevel: EducationLevel;
  readonly track?: EducationTrack;
  readonly reason: string;
};

/**
 * Tuition settlement for one study session at a compulsory education level.
 * `coveredAmount` is paid by the public treasury (transfer treasury → public
 * education service; moneySupply unchanged, same treatment as PublicBudgetSpent);
 * `selfPaidAmount` is charged from the agent's balance and leaves circulation
 * (burn, same treatment as the legacy EducationInvestmentPaid).
 */
export type EducationCompulsoryFeeCoveredPayload = {
  readonly agentId: AgentId;
  readonly level: EducationLevel;
  readonly durationSeconds: number;
  readonly coveredAmount: number;
  readonly selfPaidAmount: number;
  readonly reason: string;
};

/**
 * One exam application (中考/高考/考研) parked until the next exam-cycle
 * release. The score is snapshotted at submission so the ranking replays
 * exactly even if the agent keeps studying afterwards.
 */
export type EducationExamApplicationSubmittedPayload = {
  readonly applicationId: string;
  readonly cycleNumber: number;
  readonly agentId: AgentId;
  readonly targetLevel: EducationExamTargetLevel;
  readonly educationScore: number;
};

/**
 * 放榜 resolution of one exam application. `track` is carried only on admitted
 * 中考 (target level 3) resolutions; `cutoffScore` is the level group's lowest
 * admitted score (absent when the group admitted nobody).
 */
export type EducationExamResolvedPayload = {
  readonly applicationId: string;
  readonly cycleNumber: number;
  readonly agentId: AgentId;
  readonly targetLevel: EducationExamTargetLevel;
  readonly status: EducationExamResolutionStatus;
  readonly track?: EducationTrack;
  readonly cutoffScore?: number;
  readonly reason: EducationExamResolutionReason;
};

/**
 * Cycle-level exam summary recorded after every resolution of the cycle, so
 * read models can expose per-level admission rates and cutoffs without
 * re-deriving them from individual resolutions.
 */
export type EducationExamCycleCompletedPayload = {
  readonly cycleNumber: number;
  readonly cycleStartedAt: number;
  readonly cycleEndedAt: number;
  readonly policyVersion: string;
  readonly applicationCount: number;
  readonly admittedCount: number;
  readonly rejectedCount: number;
  readonly applicationsByLevel: Readonly<Record<string, number>>;
  readonly admittedByLevel: Readonly<Record<string, number>>;
  readonly cutoffScoresByLevel: Readonly<Record<string, number>>;
};

export const LEGACY_EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION =
  'exclusive-agent-activity-time-v1';
export const EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION = 'exclusive-agent-activity-time-v2';

export type AgentActivityKind =
  | 'travel'
  | 'education'
  | 'labor'
  | 'production'
  | 'trade'
  | 'sleep'
  | 'healthcare';

export type AgentActivityTimeCommittedPayload = {
  readonly agentId: AgentId;
  readonly activity: AgentActivityKind;
  readonly commandType: CoreCommandType;
  readonly policyVersion:
    | typeof LEGACY_EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION
    | typeof EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION;
  readonly settlementTiming: 'effects-at-commit' | 'effects-at-completion';
  readonly startedAt: number;
  readonly durationSeconds: number;
  readonly availableAt: number;
};

export type WagePaidPayload = {
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly amount: number;
  /**
   * Funding source of the wage. 'mint' (or omitted, for legacy events) means the
   * authority minted the wage and moneySupply increases; 'employer' means an
   * enterprise account paid (transfer, supply unchanged); 'treasury' means the
   * public treasury paid (transfer, supply unchanged).
   */
  readonly fundingSource?: 'mint' | 'employer' | 'treasury';
  readonly enterpriseId?: string;
};

export type EnterpriseFoundedPayload = {
  readonly enterpriseId: string;
  readonly name: string;
  readonly ownerAgentId: AgentId;
  readonly occupationName: string;
  readonly initialCapital: number;
  readonly ownerPreviousBalance: number;
  readonly ownerNextBalance: number;
  readonly maxEmployees: number;
  readonly policyVersion: string;
};

export type EnterpriseMemberJoinedPayload = {
  readonly enterpriseId: string;
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly previousJob: string | null;
  /**
   * Contracted wage copied from the enterprise job posting at join time.
   * Absent on legacy events; payroll falls back to the world wage regime.
   */
  readonly wageOffer?: number;
};

export type EnterpriseJobPostingUpdatedPayload = {
  readonly enterpriseId: string;
  readonly ownerAgentId: AgentId;
  readonly wageOffer: number;
  readonly openSlots: number;
};

export type EnterpriseEmployeeLeftPayload = {
  readonly enterpriseId: string;
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly previousJob: string | null;
};

export type EnterpriseEmployeeLaidOffPayload = {
  readonly enterpriseId: string;
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly previousJob: string | null;
};

/**
 * Wage-arrears memo for an enterprise payroll that could not pay in full (or
 * repaid earlier arrears). Carries no money movement itself: the paid part is
 * settled by the companion WagePaid event, emitted only when paidAmount > 0.
 */
export type EnterpriseWageArrearsUpdatedPayload = {
  readonly enterpriseId: string;
  readonly agentId: AgentId;
  readonly wageAmount: number;
  readonly paidAmount: number;
  readonly previousArrears: number;
  readonly nextArrears: number;
};

export type EnterpriseFundedPayload = {
  readonly enterpriseId: string;
  readonly funderAgentId: AgentId;
  readonly amount: number;
  readonly funderPreviousBalance: number;
  readonly funderNextBalance: number;
  readonly enterprisePreviousBalance: number;
  readonly enterpriseNextBalance: number;
};

export type EnterpriseInsolvencyStartedPayload = {
  readonly enterpriseId: string;
  readonly evaluatedAt: number;
  readonly balance: number;
  readonly minimumCashBalance: number;
  readonly policyVersion: string;
};

export type EnterpriseSolvencyRestoredPayload = {
  readonly enterpriseId: string;
  readonly evaluatedAt: number;
  readonly balance: number;
  readonly policyVersion: string;
};

export type EnterpriseBankruptcyDeclaredPayload = {
  readonly enterpriseId: string;
  readonly declaredAt: number;
  readonly balance: number;
  readonly insolvencyStartedAt: number;
  readonly policyVersion: string;
};

export type EnterpriseDividendPaidPayload = {
  readonly enterpriseId: string;
  readonly totalAmount: number;
  readonly payments: readonly {
    readonly agentId: AgentId;
    readonly amount: number;
  }[];
  readonly previousBalance: number;
  readonly nextBalance: number;
  readonly previousRetainedEarnings: number;
  readonly nextRetainedEarnings: number;
  readonly paidAt: number;
  readonly policyVersion: string;
};

export type EnterpriseClosedPayload = {
  readonly enterpriseId: string;
  readonly ownerAgentId: AgentId;
  readonly returnedBalance: number;
  readonly returnedInventory: Inventory;
  readonly employeeAgentIds: readonly AgentId[];
  readonly reason: 'owner-closed' | 'insolvent';
};

export type IncomeTaxChargedPayload = {
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly taxableAmount: number;
  readonly amount: number;
  readonly previousBalance: number;
  readonly nextBalance: number;
};

export type TradeTaxChargedPayload = {
  readonly agentId: AgentId;
  readonly commodityName: string;
  readonly saleProceeds: number;
  readonly amount: number;
  readonly previousBalance: number;
  readonly nextBalance: number;
  readonly enterpriseId?: string;
};

/**
 * Flat tax on an enterprise dividend payout, charged from the enterprise cash
 * account into the treasury (transfer; moneySupply unchanged). Emitted right
 * after the EnterpriseDividendPaid event it taxes.
 */
export type DividendTaxChargedPayload = {
  readonly enterpriseId: string;
  readonly dividendAmount: number;
  readonly amount: number;
  readonly enterprisePreviousBalance: number;
  readonly enterpriseNextBalance: number;
  readonly previousTreasury: number;
  readonly nextTreasury: number;
  readonly policyVersion: string;
};

export type SubsidyPaidPayload = {
  readonly agentId: AgentId;
  readonly amount: number;
  readonly previousBalance: number;
  readonly nextBalance: number;
  readonly reason: string;
  /**
   * Funding source of the subsidy. 'mint' (or omitted, for legacy events) means
   * the authority minted the subsidy and moneySupply increases; 'treasury'
   * means the public treasury paid (transfer, supply unchanged, treasury
   * debited by the same amount).
   */
  readonly fundingSource?: 'mint' | 'treasury';
};

export type PublicBudgetSpentPayload = {
  readonly policyVersion: string;
  readonly service: string;
  readonly amount: number;
  readonly previousTreasury: number;
  readonly nextTreasury: number;
  readonly settledAt: number;
  readonly fundingDestination: 'public-service-account';
};

/**
 * An agent deposits cash into the town bank (transfer agent → bank account;
 * moneySupply unchanged). The bank slice is created by the first credit event
 * when the scenario did not seed bank reserves.
 */
export type DepositMadePayload = {
  readonly agentId: AgentId;
  readonly amount: number;
  readonly previousBalance: number;
  readonly nextBalance: number;
  readonly bankPreviousBalance: number;
  readonly bankNextBalance: number;
  readonly policyVersion: string;
};

/** An agent withdraws from its deposit ledger (transfer bank → agent). */
export type WithdrawalMadePayload = {
  readonly agentId: AgentId;
  readonly amount: number;
  readonly previousBalance: number;
  readonly nextBalance: number;
  readonly bankPreviousBalance: number;
  readonly bankNextBalance: number;
  readonly policyVersion: string;
};

/** Loan approval is issuance (transfer bank → borrower of the principal). */
export type LoanIssuedPayload = {
  readonly loanId: LoanId;
  readonly borrowerAgentId: AgentId;
  readonly principal: number;
  readonly dailyInterestRate: number;
  readonly termDays: number;
  readonly issuedAt: number;
  readonly borrowerPreviousBalance: number;
  readonly borrowerNextBalance: number;
  readonly bankPreviousBalance: number;
  readonly bankNextBalance: number;
  readonly policyVersion: string;
};

/**
 * One daily loan settlement: the day's interest accrual plus the cash
 * auto-collected from the borrower (transfer borrower → bank; zero on a fully
 * missed day, in which case no accounting transfer is checked). Repayment
 * applies interest-first, then principal; `status: 'repaid'` closes the loan
 * and increments the borrower's repaid credit history.
 */
export type LoanRepaidPayload = {
  readonly loanId: LoanId;
  readonly borrowerAgentId: AgentId;
  readonly settledAt: number;
  readonly interestAccrued: number;
  readonly paidAmount: number;
  readonly interestPaid: number;
  readonly principalPaid: number;
  readonly missedPayments: number;
  readonly status: 'active' | 'repaid';
  readonly borrowerPreviousBalance: number;
  readonly borrowerNextBalance: number;
  readonly bankPreviousBalance: number;
  readonly bankNextBalance: number;
  readonly policyVersion: string;
};

/**
 * A loan crossed the missed-payment grace threshold at a daily settlement.
 * The partial payment collected that day (if any) still settles as a
 * transfer; the outstanding principal/interest stay on the book as the
 * bank's recorded loss and the borrower's defaulted credit history grows.
 */
export type LoanDefaultedPayload = {
  readonly loanId: LoanId;
  readonly borrowerAgentId: AgentId;
  readonly defaultedAt: number;
  readonly interestAccrued: number;
  readonly paidAmount: number;
  readonly interestPaid: number;
  readonly principalPaid: number;
  readonly missedPayments: number;
  readonly outstandingPrincipal: number;
  readonly outstandingInterest: number;
  readonly borrowerPreviousBalance: number;
  readonly borrowerNextBalance: number;
  readonly bankPreviousBalance: number;
  readonly bankNextBalance: number;
  readonly policyVersion: string;
};

/**
 * Daily deposit interest paid out of the bank cash account (transfers bank →
 * depositors), batched per accrual cadence. Deposit principal is unchanged.
 */
export type DepositInterestPaidPayload = {
  readonly paidAt: number;
  readonly payments: readonly {
    readonly agentId: AgentId;
    readonly amount: number;
    readonly previousBalance: number;
    readonly nextBalance: number;
  }[];
  readonly bankPreviousBalance: number;
  readonly bankNextBalance: number;
  readonly policyVersion: string;
};

export type CommodityProducedPayload = {
  readonly agentId: AgentId;
  readonly produced: Inventory;
  readonly consumedInputs: Inventory;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly laborSeconds: number;
  readonly productionEfficiency?: number;
  readonly enterpriseId?: string;
};

export type TradeExecutedPayload = {
  readonly agentId: AgentId;
  readonly side: 'buy' | 'sell';
  readonly commodityName: string;
  readonly commodityQuantity: number;
  readonly currencyQuantity: number;
  readonly poolAfter: AmmPool;
  readonly moneySupplyDelta: number;
  readonly effectivePrice?: number;
  readonly spotPriceBefore?: number;
  readonly spotPriceAfter?: number;
  readonly slippageRatio?: number;
  readonly invariantBefore?: number;
  readonly invariantAfter?: number;
  /**
   * Regional market this trade settled against. Only present when the
   * regional-markets switch is enabled; omitted keeps the legacy event shape
   * replayable against the single global pool.
   */
  readonly regionId?: string;
  readonly enterpriseId?: string;
};

export type ResourceTransferredPayload = {
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly commodityName: string;
  readonly quantity: number;
  readonly note?: string;
};

export type MarketPriceIndexRecordedPayload = {
  readonly baselineAt: number;
  readonly food: number;
  readonly nonFood: number;
  readonly overall: number;
  readonly foodCount: number;
  readonly nonFoodCount: number;
  readonly ratios: Readonly<Record<string, number>>;
};

/**
 * Per-tick observability snapshot of the town's economic composition, recorded
 * by the worker market-metrics channel after agent actions settle. Purely a
 * read-model fact: every field is derived from authoritative projection state
 * at `recordedAt` and the event never changes economic state on replay.
 *
 * `composition` splits where currency sits: the first four sectors are the
 * circulating accounts whose sum tracks `moneySupply` (agent, enterprise,
 * treasury, town-bank cash); `ammPoolCurrency` is the currency locked in AMM
 * pools and `ammPoolCommodityValue` the same pools' commodity reserves valued
 * at each pool's spot price; `externalNetInflow` is the cumulative net
 * currency the external market injected into domestic pools
 * (`externalMarket.currencyReserveNetImports`, 0 before any rebalance).
 *
 * `enterprises.bankruptTotal` is the cumulative count of enterprises ever
 * declared bankrupt (the projection keeps the tally because a closed
 * enterprise's status no longer records the reason). `gini` measures
 * inequality over agent net worth (balance + inventory valued at town-wide
 * spot prices); 0 when no agents exist. `deposits` and `loansOutstanding`
 * (principal + accrued interest of active loans) read the town bank, 0 when
 * no bank exists.
 */
export type EconomicCompositionRecordedPayload = {
  readonly recordedAt: number;
  readonly moneySupply: number;
  readonly composition: {
    readonly agents: number;
    readonly enterprises: number;
    readonly treasury: number;
    readonly bank: number;
    readonly ammPoolCurrency: number;
    readonly ammPoolCommodityValue: number;
    readonly externalNetInflow: number;
  };
  readonly enterprises: {
    readonly total: number;
    readonly active: number;
    readonly insolvent: number;
    readonly bankruptTotal: number;
  };
  readonly gini: number;
  readonly deposits: number;
  readonly loansOutstanding: number;
  /**
   * Agent headcount per discrete education level ('0'..'5') at `recordedAt`,
   * recorded by the worker market-metrics channel when an enabled
   * education-system policy is available. Agents without a durable
   * `educationLevel` (legacy registrations) fall back to deriving the level
   * from `educationScore` via the policy thresholds, matching the E1
   * fallback semantics. Optional so events recorded before the
   * education-system observability stage stay replay-compatible.
   */
  readonly educationDistribution?: Readonly<Record<string, number>>;
};

export type ExternalMarketRebalancedPayload = {
  readonly policyVersion: string;
  readonly commodityName: string;
  readonly regionId?: string;
  readonly poolAfter: AmmPool;
  readonly commodityReserveDelta: number;
  readonly currencyReserveDelta: number;
  readonly settledAt: number;
};

/** Who an external trade settled for: an agent's own account or an enterprise's. */
export type ExternalTradeActor = { readonly agentId: AgentId } | { readonly enterpriseId: string };

/**
 * One settled external trade with the external sector. An export credits the
 * trader from the external sector (injection: moneySupply rises by
 * `totalCurrency`) and ships the commodity out of the trader's inventory; an
 * import debits the trader into the external sector (burn: moneySupply falls)
 * and delivers the commodity. `balanceBefore`/`balanceAfter` carry the rolling
 * per-commodity net-export balance (positive = net exports) around the trade.
 */
export type ExternalTradeExecutedPayload = {
  readonly trader: ExternalTradeActor;
  readonly direction: 'export' | 'import';
  readonly commodityName: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly totalCurrency: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  readonly spotPrice: number;
  readonly policyVersion: string;
};

/**
 * One decay cadence of every rolling external-trade balance
 * (`balance × (1 − decayRatio)`), settled by AdvanceSimulationTime at each
 * crossed policy cadence boundary. Pure state update: no funds or goods move.
 */
export type ExternalTradeBalancesDecayedPayload = {
  readonly policyVersion: string;
  readonly balancesBefore: Readonly<Record<string, number>>;
  readonly balancesAfter: Readonly<Record<string, number>>;
  readonly decayedAt: number;
};

export type JobApplicationSubmittedPayload = {
  readonly applicationId: string;
  readonly cycleNumber: number;
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly residentialTier: number;
  readonly educationScore: number;
  /**
   * Effective education score (raw + vocational-track tier bonus) the
   * recruitment cycle ranks this application with. Recorded at submission so
   * replay never recomputes it; absent on legacy applications, which rank by
   * the raw educationScore.
   */
  readonly effectiveEducationScore?: number;
};

export type JobApplicationResolvedPayload = {
  readonly applicationId: string;
  readonly cycleNumber: number;
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly status: RecruitmentApplicationResolutionStatus;
  readonly reason: RecruitmentResolutionReason;
};

export type JobAssignedPayload = {
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly previousJob: string | null;
  readonly applicationId?: string;
  readonly cycleNumber?: number;
};

export type RecruitmentCycleCompletedPayload = {
  readonly cycleNumber: number;
  readonly cycleStartedAt: number;
  readonly cycleEndedAt: number;
  readonly policyVersion: string;
  readonly applicationCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
};

export type ResidentialTierUpgradedPayload = {
  readonly agentId: AgentId;
  readonly previousResidentialTier: number;
  readonly nextResidentialTier: number;
  readonly currencyCost: number;
  readonly consumedInventory: Inventory;
};

export type ResidentialUpkeepChargedPayload = {
  readonly agentId: AgentId;
  readonly residentialTier: number;
  readonly amount: number;
  readonly unpaidAmount: number;
  readonly previousBalance: number;
  readonly nextBalance: number;
  readonly reason: string;
};

export type ResidentialUpkeepArrearsUpdatedPayload = {
  readonly agentId: AgentId;
  readonly previousArrears: number;
  readonly nextArrears: number;
  readonly reason: string;
};

/**
 * Regional land value index fact, emitted by the world at each land value
 * cadence boundary. The index is a deterministic function of the previous
 * index and the recorded regional inputs (population, market liquidity)
 * smoothed per the land value policy; it only modulates housing upkeep
 * pricing and never moves currency by itself. Payload carries the inputs and
 * policy version so the pricing basis stays auditable and replayable.
 */
export type RegionalLandValueUpdatedPayload = {
  readonly regionId: string;
  readonly previousIndex: number;
  readonly nextIndex: number;
  readonly rawIndex: number;
  readonly agentCount: number;
  readonly marketLiquidity: number;
  readonly policyVersion: string;
  readonly settledAt: number;
  readonly reason: 'land-value-cadence';
};

export type ResidentialTierDowngradedPayload = {
  readonly agentId: AgentId;
  readonly previousResidentialTier: number;
  readonly nextResidentialTier: number;
  readonly arrearsCleared: number;
  readonly reason: string;
};

export type AgentTimeEffectsSettledPayload = {
  readonly agentId: AgentId;
  readonly previousSettledAt: number;
  readonly nextSettledAt: number;
};

export type MedicalTreatmentChargedPayload = {
  readonly agentId: AgentId;
  readonly amount: number;
  readonly previousBalance: number;
  readonly nextBalance: number;
  readonly reason: string;
};

export type SocialInteractionCompletedPayload = {
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly summary: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly outcomePolicyVersion?: string;
  readonly outcomeSignals?: readonly string[];
  readonly outcomeSignalSeverities?: readonly {
    readonly signal: string;
    readonly severity: number;
  }[];
  readonly nextRelation: SocialRelationState;
};

export type AgentLocationChangedPayload = {
  readonly agentId: AgentId;
  readonly previousLocationId: LocationId | null;
  readonly nextLocationId: LocationId;
  readonly reason: string;
  readonly spatialPolicyVersion?: string;
  readonly routeLocationIds?: readonly LocationId[];
  readonly baseTravelDurationSeconds?: number;
  readonly congestionMultiplier?: number;
  readonly travelDurationSeconds?: number;
};

export type AgentTravelStartedPayload = {
  readonly agentId: AgentId;
  readonly fromLocationId: LocationId;
  readonly toLocationId: LocationId;
  readonly routeLocationIds: readonly LocationId[];
  readonly spatialPolicyVersion: string;
  readonly baseTravelDurationSeconds: number;
  readonly congestionMultiplier: number;
  readonly travelDurationSeconds: number;
  readonly departedAt: number;
  readonly arrivesAt: number;
  readonly reason: string;
};

export type LocationObservedPayload = {
  readonly agentId: AgentId;
  readonly locationId: LocationId;
  readonly locationName: string;
  readonly observedAgentIds: readonly AgentId[];
  readonly activityAffinities: readonly string[];
  readonly focus?: string;
};

export type ConversationTurnPayload = {
  readonly turnIndex: number;
  readonly speakerAgentId: AgentId;
  readonly utterance: string;
  readonly intent?: string;
};

export type ConversationRecordedPayload = {
  readonly conversationId: ConversationId;
  readonly initiatorAgentId: AgentId;
  readonly participantAgentIds: readonly AgentId[];
  readonly locationId: LocationId;
  readonly topic: string;
  readonly turns: readonly ConversationTurnPayload[];
};

export type ActionRejectedPayload = {
  readonly agentId: AgentId;
  readonly commandType: CoreCommandType;
  readonly reason: string;
};

export type ShortTermMemoryRecordedPayload = {
  readonly record: ShortTermMemoryRecord;
};

export type SimulationTimeAdvancedPayload = {
  readonly previous: SimulationClock;
  readonly next: SimulationClock;
  readonly deltaMs: number;
};

/**
 * Simulation-wide weather transition settled by the AdvanceSimulationTime
 * handler under the town-weather policy. `transitionedAt` is the simulation
 * time (not wall time) at which the new weather takes effect.
 */
export type WeatherChangedPayload = {
  readonly policyVersion: string;
  readonly from: TownWeatherKind;
  readonly to: TownWeatherKind;
  readonly transitionedAt: number;
};

/**
 * A bulletin accepted for the town board but not yet effective: residents
 * become aware of it (BulletinPosted) once simulation time reaches
 * bulletin.effectiveAt.
 */
export type BulletinScheduledPayload = {
  readonly bulletin: TownBulletin;
  readonly humanAttribution?: HumanCommandAttribution;
};

/**
 * A bulletin effective on the town board. Emitted either directly by the
 * post/issue command (immediate bulletins) or by AdvanceSimulationTime when
 * the clock crosses a scheduled bulletin's effectiveAt.
 */
export type BulletinPostedPayload = {
  readonly bulletin: TownBulletin;
  readonly humanAttribution?: HumanCommandAttribution;
};

/** A social matter enters the board (help-request: open; commitment: latent). */
export type MatterRaisedPayload = {
  readonly matter: WorldSocialMatterState;
};

export type MatterRespondedPayload = {
  readonly matterId: string;
  readonly responderAgentId: AgentId;
  readonly decision: 'accept' | 'reject' | 'defer' | 'withdraw';
  readonly respondedAt: number;
};

export type MatterAssignedPayload = {
  readonly matterId: string;
  readonly assigneeAgentId: AgentId;
  readonly assignedAt: number;
};

/** World-verified partial fulfillment progress (e.g. a partial delivery). */
export type MatterProgressedPayload = {
  readonly matterId: string;
  readonly deliveredQuantity: number;
  readonly transferEventId: string;
};

export type MatterClosedPayload = {
  readonly matterId: string;
  readonly closure: 'fulfilled' | 'breached' | 'expired' | 'withdrawn';
  readonly closedAt: number;
  readonly fulfillmentEventId?: string;
};

/** A co-located verbal confrontation (town-conflict switch). */
export type ConfrontationRecordedPayload = {
  readonly conflictId: string;
  readonly initiatorAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly locationId: LocationId;
  readonly statement: string;
  readonly witnessAgentIds: readonly AgentId[];
  readonly recordedAt: number;
};

/** A world-adjudicated attack: grievance, hit, and damage are all rule-based. */
export type AttackRecordedPayload = {
  readonly conflictId: string;
  readonly attackerAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly locationId: LocationId;
  readonly grievance: ConflictGrievance;
  readonly damage: number;
  readonly targetPreviousHealth: number;
  readonly targetNextHealth: number;
  readonly attackerEnergyCost: number;
  readonly witnessAgentIds: readonly AgentId[];
  readonly recordedAt: number;
};

/** A third party mediating a conflict pair (town-conflict switch). */
export type InterventionRecordedPayload = {
  readonly conflictId: string;
  readonly intervenerAgentId: AgentId;
  readonly attackerAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly locationId: LocationId;
  readonly statement: string;
  readonly witnessAgentIds: readonly AgentId[];
  readonly recordedAt: number;
};

/**
 * An Agent whose durable ownership moved to another execution partition. In the
 * departing partition's stream this event ends the Agent's local presence: the
 * projection stops tracking it, while the durable cognitive history stays for
 * audit and replay. Emitted by simulation-wide authority settlement, never by a
 * partition-local command.
 */
export type AgentOwnershipDepartedPayload = {
  readonly agentId: AgentId;
  readonly toPartitionKey: string;
  readonly transferOperationId: string;
};

/**
 * An Agent whose durable ownership arrived from another execution partition,
 * carrying its authoritative world state at transfer time. In the receiving
 * partition's stream this event begins the Agent's local presence; the matching
 * cognitive state (memory, profile, objectives, plans) is hydrated by the
 * runtime materializer from the authority-held snapshot.
 */
export type AgentOwnershipArrivedPayload = {
  readonly agentId: AgentId;
  readonly fromPartitionKey: string;
  readonly transferOperationId: string;
  readonly agentState: {
    readonly locationId: LocationId | null;
    readonly physiology: PhysiologicalState;
    readonly educationScore: number;
    readonly balance: number;
    readonly residentialTier: number;
    readonly job: string | null;
    readonly inventory: Inventory;
  };
};

export type WorldEventPayloadByType = {
  readonly AgentRegistered: AgentRegisteredPayload;
  readonly AgentRegistrationRejected: AgentRegistrationRejectedPayload;
  readonly CommodityProduced: CommodityProducedPayload;
  readonly TradeExecuted: TradeExecutedPayload;
  readonly ResourceTransferred: ResourceTransferredPayload;
  readonly CommodityConsumed: CommodityConsumedPayload;
  readonly DurableGoodExpired: DurableGoodExpiredPayload;
  readonly MarketPriceIndexRecorded: MarketPriceIndexRecordedPayload;
  readonly EconomicCompositionRecorded: EconomicCompositionRecordedPayload;
  readonly ExternalMarketRebalanced: ExternalMarketRebalancedPayload;
  readonly ExternalTradeExecuted: ExternalTradeExecutedPayload;
  readonly ExternalTradeBalancesDecayed: ExternalTradeBalancesDecayedPayload;
  readonly JobApplicationSubmitted: JobApplicationSubmittedPayload;
  readonly JobApplicationResolved: JobApplicationResolvedPayload;
  readonly JobAssigned: JobAssignedPayload;
  readonly RecruitmentCycleCompleted: RecruitmentCycleCompletedPayload;
  readonly ResidentialTierUpgraded: ResidentialTierUpgradedPayload;
  readonly ResidentialTierDowngraded: ResidentialTierDowngradedPayload;
  readonly ResidentialUpkeepCharged: ResidentialUpkeepChargedPayload;
  readonly ResidentialUpkeepArrearsUpdated: ResidentialUpkeepArrearsUpdatedPayload;
  readonly RegionalLandValueUpdated: RegionalLandValueUpdatedPayload;
  readonly AgentTimeEffectsSettled: AgentTimeEffectsSettledPayload;
  readonly MedicalTreatmentCharged: MedicalTreatmentChargedPayload;
  readonly SocialInteractionCompleted: SocialInteractionCompletedPayload;
  readonly AgentTravelStarted: AgentTravelStartedPayload;
  readonly AgentLocationChanged: AgentLocationChangedPayload;
  readonly LocationObserved: LocationObservedPayload;
  readonly ConversationRecorded: ConversationRecordedPayload;
  readonly InventoryChanged: InventoryChangedPayload;
  readonly PhysiologyChanged: PhysiologyChangedPayload;
  readonly PhysiologicalDistressChanged: PhysiologicalDistressChangedPayload;
  readonly SafetyNetGranted: SafetyNetGrantedPayload;
  readonly EducationInvestmentPaid: EducationInvestmentPaidPayload;
  readonly EducationChanged: EducationChangedPayload;
  readonly EducationLevelChanged: EducationLevelChangedPayload;
  readonly EducationCompulsoryFeeCovered: EducationCompulsoryFeeCoveredPayload;
  readonly EducationExamApplicationSubmitted: EducationExamApplicationSubmittedPayload;
  readonly EducationExamResolved: EducationExamResolvedPayload;
  readonly EducationExamCycleCompleted: EducationExamCycleCompletedPayload;
  readonly AgentActivityTimeCommitted: AgentActivityTimeCommittedPayload;
  readonly WagePaid: WagePaidPayload;
  readonly EnterpriseFounded: EnterpriseFoundedPayload;
  readonly EnterpriseMemberJoined: EnterpriseMemberJoinedPayload;
  readonly EnterpriseFunded: EnterpriseFundedPayload;
  readonly EnterpriseInsolvencyStarted: EnterpriseInsolvencyStartedPayload;
  readonly EnterpriseSolvencyRestored: EnterpriseSolvencyRestoredPayload;
  readonly EnterpriseBankruptcyDeclared: EnterpriseBankruptcyDeclaredPayload;
  readonly EnterpriseDividendPaid: EnterpriseDividendPaidPayload;
  readonly EnterpriseClosed: EnterpriseClosedPayload;
  readonly EnterpriseJobPostingUpdated: EnterpriseJobPostingUpdatedPayload;
  readonly EnterpriseEmployeeLeft: EnterpriseEmployeeLeftPayload;
  readonly EnterpriseEmployeeLaidOff: EnterpriseEmployeeLaidOffPayload;
  readonly EnterpriseWageArrearsUpdated: EnterpriseWageArrearsUpdatedPayload;
  readonly IncomeTaxCharged: IncomeTaxChargedPayload;
  readonly TradeTaxCharged: TradeTaxChargedPayload;
  readonly DividendTaxCharged: DividendTaxChargedPayload;
  readonly SubsidyPaid: SubsidyPaidPayload;
  readonly PublicBudgetSpent: PublicBudgetSpentPayload;
  readonly DepositMade: DepositMadePayload;
  readonly WithdrawalMade: WithdrawalMadePayload;
  readonly LoanIssued: LoanIssuedPayload;
  readonly LoanRepaid: LoanRepaidPayload;
  readonly LoanDefaulted: LoanDefaultedPayload;
  readonly DepositInterestPaid: DepositInterestPaidPayload;
  readonly ActionRejected: ActionRejectedPayload;
  readonly ShortTermMemoryRecorded: ShortTermMemoryRecordedPayload;
  readonly SimulationTimeAdvanced: SimulationTimeAdvancedPayload;
  readonly WeatherChanged: WeatherChangedPayload;
  readonly BulletinScheduled: BulletinScheduledPayload;
  readonly BulletinPosted: BulletinPostedPayload;
  readonly MatterRaised: MatterRaisedPayload;
  readonly MatterResponded: MatterRespondedPayload;
  readonly MatterAssigned: MatterAssignedPayload;
  readonly MatterProgressed: MatterProgressedPayload;
  readonly MatterClosed: MatterClosedPayload;
  readonly ConfrontationRecorded: ConfrontationRecordedPayload;
  readonly AttackRecorded: AttackRecordedPayload;
  readonly InterventionRecorded: InterventionRecordedPayload;
  readonly AgentOwnershipDeparted: AgentOwnershipDepartedPayload;
  readonly AgentOwnershipArrived: AgentOwnershipArrivedPayload;
};

export type WorldEventType = keyof WorldEventPayloadByType;

export type WorldEventOf<TType extends WorldEventType> = EventEnvelope<
  TType,
  WorldEventPayloadByType[TType]
>;

export type WorldEvent = {
  readonly [TType in WorldEventType]: WorldEventOf<TType>;
}[WorldEventType];

export type AgentInventorySnapshot = Inventory;
