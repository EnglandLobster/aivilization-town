import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import { proposeSocialLongTermMemoryPatches } from './consolidation';
import type { LongTermAgentProfile, LongTermMemoryPatch } from './profile';
import type { ShortTermMemoryRecord } from './records';
import type {
  MemorySynthesisWorldDecisionContext,
  MemorySynthesisWorldDecisionContextTrace,
} from './worldContext';
import {
  proposeSocialInteractionReflections,
  type SocialInteractionReflectionRecord,
} from './socialReflection';

export type SocialModelSynthesisUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
};

export type SocialModelSynthesisAttemptTrace = {
  readonly attemptIndex: number;
  readonly status: string;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: SocialModelSynthesisUsage;
};

export type SocialModelSynthesisTrace = {
  readonly status: 'accepted' | 'fallback' | 'deterministic';
  readonly source: 'llm' | 'deterministic-fallback' | 'deterministic';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly patches?: readonly SocialModelSynthesisPatchTrace[];
  readonly reflections?: readonly SocialModelSynthesisReflectionTrace[];
  readonly attempts?: readonly SocialModelSynthesisAttemptTrace[];
  readonly usage?: SocialModelSynthesisUsage;
  readonly worldDecisionContext?: MemorySynthesisWorldDecisionContextTrace;
};

export type SocialModelSynthesisPatchTrace = {
  readonly key: string;
  readonly confidence: number;
  readonly provenanceRecordIds: readonly string[];
  readonly relationDelta?: number;
  readonly attitudeDelta?: number;
};

export type SocialModelSynthesisReflectionTrace = {
  readonly targetAgentId: AgentId;
  readonly confidence: number;
  readonly evidenceRecordIds: readonly string[];
};

export type SocialModelSynthesizerInput = {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly generatedAt: SimulationTimestamp;
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: MemorySynthesisWorldDecisionContext;
};

export type SocialModelSynthesisResult = {
  readonly patches: readonly LongTermMemoryPatch[];
  readonly socialReflections: readonly SocialInteractionReflectionRecord[];
  readonly trace: SocialModelSynthesisTrace;
};

export type SocialModelSynthesizer = (
  input: SocialModelSynthesizerInput,
) => SocialModelSynthesisResult | Promise<SocialModelSynthesisResult>;

export function createDeterministicSocialModelSynthesizer(): SocialModelSynthesizer {
  return (input) => createDeterministicSocialModelSynthesisResult(input);
}

export function createDeterministicSocialModelSynthesisResult(
  input: SocialModelSynthesizerInput,
): SocialModelSynthesisResult {
  const patches = proposeSocialLongTermMemoryPatches({
    agentId: input.agentId,
    records: input.records,
    proposedAt: input.generatedAt,
  });
  const socialReflections = proposeSocialInteractionReflections({
    agentId: input.agentId,
    records: input.records,
    generatedAt: input.generatedAt,
  });

  return {
    patches,
    socialReflections,
    trace: {
      status: 'deterministic',
      source: 'deterministic',
      message: 'Deterministic social model synthesis',
    },
  };
}
