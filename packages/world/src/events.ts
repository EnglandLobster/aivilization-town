import type { Inventory } from '@aivilization/economy';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import type { AgentId, CoreCommandType, EventEnvelope } from '@aivilization/sim-core';
import type { PhysiologicalState } from '@aivilization/society';

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

export type ActionRejectedPayload = {
  readonly agentId: AgentId;
  readonly commandType: CoreCommandType;
  readonly reason: string;
};

export type ShortTermMemoryRecordedPayload = {
  readonly record: ShortTermMemoryRecord;
};

export type WorldEventPayloadByType = {
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
