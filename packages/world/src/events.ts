import type { AmmPool, Inventory } from '@aivilization/economy';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import type { AgentId, CoreCommandType, EventEnvelope } from '@aivilization/sim-core';
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

export type SocialInteractionCompletedPayload = {
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly summary: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly nextRelation: SocialRelationState;
};

export type ActionRejectedPayload = {
  readonly agentId: AgentId;
  readonly commandType: CoreCommandType;
  readonly reason: string;
};

export type ShortTermMemoryRecordedPayload = {
  readonly record: ShortTermMemoryRecord;
};

export type WorldEventPayloadByType = {
  readonly CommodityProduced: CommodityProducedPayload;
  readonly TradeExecuted: TradeExecutedPayload;
  readonly JobApplicationSubmitted: JobApplicationSubmittedPayload;
  readonly JobAssigned: JobAssignedPayload;
  readonly SocialInteractionCompleted: SocialInteractionCompletedPayload;
  readonly InventoryChanged: InventoryChangedPayload;
  readonly PhysiologyChanged: PhysiologyChangedPayload;
  readonly EducationChanged: EducationChangedPayload;
  readonly WagePaid: WagePaidPayload;
  readonly ActionRejected: ActionRejectedPayload;
  readonly ShortTermMemoryRecorded: ShortTermMemoryRecordedPayload;
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
