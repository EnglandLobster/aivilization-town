import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import type { MemoryRecordId } from './records';

export type LongTermProfileSection =
  | 'beliefs'
  | 'habits'
  | 'values'
  | 'personality'
  | 'socialRecords';

export type LongTermMemoryPatch = {
  readonly id: string;
  readonly agentId: AgentId;
  readonly section: LongTermProfileSection;
  readonly key: string;
  readonly statement: string;
  readonly confidence: number;
  readonly provenanceRecordIds: readonly MemoryRecordId[];
  readonly proposedAt: SimulationTimestamp;
  readonly relationDelta?: number;
  readonly attitudeDelta?: number;
};

export type LongTermProfileEntry = {
  readonly key: string;
  readonly statement: string;
  readonly confidence: number;
  readonly updatedAt: SimulationTimestamp;
  readonly provenanceRecordIds: readonly MemoryRecordId[];
};

export type LongTermAgentProfile = {
  readonly agentId: AgentId;
  readonly beliefs: readonly LongTermProfileEntry[];
  readonly habits: readonly LongTermProfileEntry[];
  readonly values: readonly LongTermProfileEntry[];
  readonly personality: readonly LongTermProfileEntry[];
  readonly socialRecords: readonly LongTermProfileEntry[];
};
