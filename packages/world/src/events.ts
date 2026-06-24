import type { AmmPool, Inventory } from '@aivilization/economy';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import type {
  AgentId,
  ConversationId,
  CoreCommandType,
  EventEnvelope,
  LocationId,
  SimulationClock,
} from '@aivilization/sim-core';
import type { PhysiologicalState, SocialRelationState } from '@aivilization/society';

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

export type EducationChangedPayload = {
  readonly agentId: AgentId;
  readonly previousEducationScore: number;
  readonly nextEducationScore: number;
  readonly reason: string;
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
};

export type TradeExecutedPayload = {
  readonly agentId: AgentId;
  readonly side: 'buy' | 'sell';
  readonly commodityName: string;
  readonly commodityQuantity: number;
  readonly currencyQuantity: number;
  readonly poolAfter: AmmPool;
  readonly moneySupplyDelta: number;
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
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly residentialTier: number;
  readonly educationScore: number;
};

export type JobAssignedPayload = {
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly previousJob: string | null;
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

export type SocialInteractionCompletedPayload = {
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly summary: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly nextRelation: SocialRelationState;
};

export type AgentLocationChangedPayload = {
  readonly agentId: AgentId;
  readonly previousLocationId: LocationId | null;
  readonly nextLocationId: LocationId;
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
  readonly CommodityProduced: CommodityProducedPayload;
  readonly TradeExecuted: TradeExecutedPayload;
  readonly MarketPriceIndexRecorded: MarketPriceIndexRecordedPayload;
  readonly JobApplicationSubmitted: JobApplicationSubmittedPayload;
  readonly JobAssigned: JobAssignedPayload;
  readonly ResidentialTierUpgraded: ResidentialTierUpgradedPayload;
  readonly ResidentialUpkeepCharged: ResidentialUpkeepChargedPayload;
  readonly SocialInteractionCompleted: SocialInteractionCompletedPayload;
  readonly AgentLocationChanged: AgentLocationChangedPayload;
  readonly LocationObserved: LocationObservedPayload;
  readonly ConversationRecorded: ConversationRecordedPayload;
  readonly InventoryChanged: InventoryChangedPayload;
  readonly PhysiologyChanged: PhysiologyChangedPayload;
  readonly EducationChanged: EducationChangedPayload;
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
