import type { AmmPool, Inventory } from '@aivilization/economy';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import type {
  AgentId,
  CommandSource,
  ConversationId,
  CoreCommandType,
  EventEnvelope,
  HumanCommandAttribution,
  LocationId,
  SimulationClock,
} from '@aivilization/sim-core';
import type {
  PhysiologicalState,
  PhysiologicalAxis,
  PhysiologicalDistressState,
  RecruitmentApplicationResolutionStatus,
  RecruitmentResolutionReason,
  SocialRelationState,
} from '@aivilization/society';

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
};

export type SubsidyPaidPayload = {
  readonly agentId: AgentId;
  readonly amount: number;
  readonly previousBalance: number;
  readonly nextBalance: number;
  readonly reason: string;
};

export type CommodityProducedPayload = {
  readonly agentId: AgentId;
  readonly produced: Inventory;
  readonly consumedInputs: Inventory;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly laborSeconds: number;
  readonly productionEfficiency?: number;
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

export type JobApplicationSubmittedPayload = {
  readonly applicationId: string;
  readonly cycleNumber: number;
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly residentialTier: number;
  readonly educationScore: number;
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

export type WorldEventPayloadByType = {
  readonly AgentRegistered: AgentRegisteredPayload;
  readonly AgentRegistrationRejected: AgentRegistrationRejectedPayload;
  readonly CommodityProduced: CommodityProducedPayload;
  readonly TradeExecuted: TradeExecutedPayload;
  readonly ResourceTransferred: ResourceTransferredPayload;
  readonly MarketPriceIndexRecorded: MarketPriceIndexRecordedPayload;
  readonly JobApplicationSubmitted: JobApplicationSubmittedPayload;
  readonly JobApplicationResolved: JobApplicationResolvedPayload;
  readonly JobAssigned: JobAssignedPayload;
  readonly RecruitmentCycleCompleted: RecruitmentCycleCompletedPayload;
  readonly ResidentialTierUpgraded: ResidentialTierUpgradedPayload;
  readonly ResidentialUpkeepCharged: ResidentialUpkeepChargedPayload;
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
  readonly AgentActivityTimeCommitted: AgentActivityTimeCommittedPayload;
  readonly WagePaid: WagePaidPayload;
  readonly SubsidyPaid: SubsidyPaidPayload;
  readonly ActionRejected: ActionRejectedPayload;
  readonly ShortTermMemoryRecorded: ShortTermMemoryRecordedPayload;
  readonly SimulationTimeAdvanced: SimulationTimeAdvancedPayload;
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
